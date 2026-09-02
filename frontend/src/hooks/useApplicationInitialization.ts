/* Initialize browser identity, backend health, and refresh-recovery state. */
import { useEffect, useState } from "react";
import {
  createBrowserSession,
  fetchBackendHealth,
} from "../api/audioProcessing";
import type { HealthResponse, Job, User } from "../types";
import { isActiveJob } from "../utils/jobs";

type InitializationOptions = {
  loadAuthentication: () => Promise<User | null>;
  loadJobHistory: () => Promise<Job[]>;
  selectJob: (job: Job) => void;
  setMessage: (message: string) => void;
};

export function useApplicationInitialization({
  loadAuthentication,
  loadJobHistory,
  selectJob,
  setMessage,
}: InitializationOptions) {
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Effects perform network work after React places the interface on screen.
    let isActive = true;

    async function initializeApplication() {
      try {
        // Every browser starts with anonymous ownership. An existing audio_auth
        // cookie may then upgrade that owner to a permanent account in /auth/me.
        await createBrowserSession();
        await loadAuthentication();

        // Health and account identity are independent requests, but doing health
        // second keeps the startup sequence easy to inspect in browser DevTools.
        const health = await fetchBackendHealth();

        if (isActive) {
          setBackendHealth(health);
        }

        try {
          const recoveredJobs = await loadJobHistory();

          if (!isActive) {
            return;
          }

          setSessionReady(true);
          const recoveredActiveJob = recoveredJobs.find(isActiveJob);

          if (recoveredActiveJob) {
            selectJob(recoveredActiveJob);
            setMessage(
              `Recovered ${recoveredActiveJob.original_file_name} at ` +
                `${recoveredActiveJob.progress}%.`,
            );
          } else {
            setMessage("Backend is connected.");
          }
        } catch (error) {
          // A history outage should not disable new uploads when the API itself
          // is healthy and the ownership cookie has already been established.
          if (isActive) {
            setSessionReady(true);
            setMessage(
              error instanceof Error
                ? error.message
                : "Backend connected, but job history could not be loaded.",
            );
          }
        }
      } catch {
        if (isActive) {
          setSessionReady(false);
          setMessage("Could not connect to backend.");
        }
      }
    }

    // useEffect must return cleanup, not a Promise, so start async work with void.
    void initializeApplication();

    return () => {
      // Ignore responses that finish after unmount or StrictMode's test cycle.
      isActive = false;
    };
  }, [loadAuthentication, loadJobHistory, selectJob, setMessage]);

  return { backendHealth, sessionReady };
}
