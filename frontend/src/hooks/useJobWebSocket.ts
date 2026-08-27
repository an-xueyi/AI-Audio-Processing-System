/* Connect React state to the lower-level reconnecting WebSocket subscription. */
import { useCallback, useEffect, useRef, useState } from "react";
import { startJobSubscription } from "../realtime/jobSubscription";
import type { Job } from "../types";

type JobWebSocketOptions = {
  // Parent-provided callbacks receive job data and human-readable connection state.
  onJobUpdate: (job: Job) => void | Promise<void>;
  onStatusMessage: (message: string) => void;
};

export function useJobWebSocket({
  onJobUpdate,
  onStatusMessage,
}: JobWebSocketOptions) {
  const [subscribedJobId, setSubscribedJobId] = useState<string | null>(null);
  // A ref is a mutable container that survives renders without causing a new
  // render. It lets the existing socket call the newest callback functions.
  const callbacksRef = useRef({ onJobUpdate, onStatusMessage });

  useEffect(() => {
    // Refresh the ref whenever either prop callback changes. This effect does not
    // open or close a connection because refs update independently of render state.
    callbacksRef.current = { onJobUpdate, onStatusMessage };
  }, [onJobUpdate, onStatusMessage]);

  useEffect(() => {
    // null explicitly means no job should have an active subscription.
    if (!subscribedJobId) {
      return;
    }

    // startJobSubscription returns a cleanup function. React calls it before
    // changing job IDs or unmounting, which closes timers and the old socket.
    return startJobSubscription({
      jobId: subscribedJobId,
      // Small wrappers read callbacksRef at call time, guaranteeing that messages
      // reach the latest parent callbacks without restarting the connection.
      onJobUpdate: (job) => callbacksRef.current.onJobUpdate(job),
      onStatusMessage: (message) =>
        callbacksRef.current.onStatusMessage(message),
    });
  }, [subscribedJobId]);

  const subscribeToJob = useCallback((jobId: string) => {
    // Updating this state triggers the effect above, which opens the connection.
    setSubscribedJobId(jobId);
  }, []);

  const unsubscribeFromJob = useCallback(() => {
    // Setting null triggers the previous effect cleanup and opens no replacement.
    setSubscribedJobId(null);
  }, []);

  return { subscribeToJob, unsubscribeFromJob };
}
