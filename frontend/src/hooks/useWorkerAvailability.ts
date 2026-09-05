/* Keep the page informed about online, busy, or disconnected workers. */
import { useEffect, useState } from "react";
import { fetchWorkerAvailability } from "../api/audioProcessing";
import type { WorkerAvailability } from "../types";

// Fifteen seconds is frequent enough for a useful status display without asking
// PostgreSQL to count worker heartbeats on every React render or animation frame.
const availabilityRefreshMilliseconds = 15_000;

export function useWorkerAvailability(backendConnected: boolean) {
  // null means the browser has not received a current availability response.
  const [workerAvailability, setWorkerAvailability] =
    useState<WorkerAvailability | null>(null);

  useEffect(() => {
    // There is no useful worker request to make while the backend itself cannot
    // be reached. The return statement below hides any older successful value.
    if (!backendConnected) {
      return;
    }

    // React may remove this component while a request is still in flight. This
    // flag prevents that old response from changing state after cleanup.
    let isActive = true;

    async function refreshWorkerAvailability() {
      try {
        const availability = await fetchWorkerAvailability();

        if (isActive) {
          setWorkerAvailability(availability);
        }
      } catch {
        if (isActive) {
          // Unknown is different from offline: only the backend may declare that
          // no recent worker heartbeat exists. A failed request proves neither.
          setWorkerAvailability(null);
        }
      }
    }

    // Fetch immediately, then repeat so starting the local worker updates an
    // already-open browser page without requiring the user to refresh it.
    void refreshWorkerAvailability();
    const refreshTimer = window.setInterval(
      () => void refreshWorkerAvailability(),
      availabilityRefreshMilliseconds,
    );

    return () => {
      // Stop future requests and make any current response harmless on unmount.
      isActive = false;
      window.clearInterval(refreshTimer);
    };
  }, [backendConnected]);

  // Do not display a cached worker result after the backend disconnects. Keeping
  // this as a derived return value also avoids an extra state-setting render.
  return backendConnected ? workerAvailability : null;
}
