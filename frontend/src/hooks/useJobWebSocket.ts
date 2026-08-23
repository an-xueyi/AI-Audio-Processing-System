import { useCallback, useEffect, useRef, useState } from "react";
import { startJobSubscription } from "../realtime/jobSubscription";
import type { Job } from "../types";

type JobWebSocketOptions = {
  onJobUpdate: (job: Job) => void | Promise<void>;
  onStatusMessage: (message: string) => void;
};

export function useJobWebSocket({
  onJobUpdate,
  onStatusMessage,
}: JobWebSocketOptions) {
  const [subscribedJobId, setSubscribedJobId] = useState<string | null>(null);
  const callbacksRef = useRef({ onJobUpdate, onStatusMessage });

  useEffect(() => {
    callbacksRef.current = { onJobUpdate, onStatusMessage };
  }, [onJobUpdate, onStatusMessage]);

  useEffect(() => {
    if (!subscribedJobId) {
      return;
    }

    return startJobSubscription({
      jobId: subscribedJobId,
      onJobUpdate: (job) => callbacksRef.current.onJobUpdate(job),
      onStatusMessage: (message) =>
        callbacksRef.current.onStatusMessage(message),
    });
  }, [subscribedJobId]);

  const subscribeToJob = useCallback((jobId: string) => {
    setSubscribedJobId(jobId);
  }, []);

  const unsubscribeFromJob = useCallback(() => {
    setSubscribedJobId(null);
  }, []);

  return { subscribeToJob, unsubscribeFromJob };
}
