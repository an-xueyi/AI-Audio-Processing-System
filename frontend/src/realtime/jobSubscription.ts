import { fetchJob } from "../api/audioProcessing";
import { WS_BASE_URL } from "../config";
import type { Job, JobStatus, JobWebSocketMessage } from "../types";

const connectionTimeoutMs = 10_000;
const fallbackPollingIntervalMs = 2_000;
const reconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 10_000];
const terminalStatuses: ReadonlySet<JobStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

type JobSubscriptionOptions = {
  jobId: string;
  onJobUpdate: (job: Job) => void | Promise<void>;
  onStatusMessage: (message: string) => void;
};

export function startJobSubscription({
  jobId,
  onJobUpdate,
  onStatusMessage,
}: JobSubscriptionOptions) {
  /*
   * All connection state belongs to one job subscription. The cleanup function
   * returned at the bottom changes stopped to true, clears every timer, and
   * closes the socket. React calls that cleanup when the component no longer
   * watches this job, preventing old sockets from updating the new screen.
   */
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let connectionTimer: number | null = null;
  let fallbackPollingTimer: number | null = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let terminalJobReached = false;
  let previousJobPayload = "";

  function clearTimer(timer: number | null) {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }

  function stopFallbackPolling() {
    if (fallbackPollingTimer !== null) {
      window.clearInterval(fallbackPollingTimer);
      fallbackPollingTimer = null;
    }
  }

  async function deliverJobUpdate(job: Job) {
    const payload = JSON.stringify(job);

    if (payload === previousJobPayload) {
      return;
    }

    previousJobPayload = payload;
    await onJobUpdate(job);

    if (terminalStatuses.has(job.status)) {
      terminalJobReached = true;
      stopFallbackPolling();
      socket?.close(1000, "Job finished");
    }
  }

  async function pollJobStatus() {
    try {
      await deliverJobUpdate(await fetchJob(jobId));
    } catch (error) {
      onStatusMessage(
        error instanceof Error
          ? error.message
          : "Could not recover the job status.",
      );
    }
  }

  function startFallbackPolling() {
    if (fallbackPollingTimer !== null || terminalJobReached) {
      return;
    }

    /*
     * WebSockets are the primary path because the server can push an update as
     * soon as a worker changes the job. After three failed reconnections, HTTP
     * polling becomes a backup. It is less efficient, but it keeps the page
     * useful when a network or proxy blocks WebSockets.
     */
    onStatusMessage(
      "Realtime connection is unavailable. Using status polling.",
    );
    void pollJobStatus();
    fallbackPollingTimer = window.setInterval(() => {
      void pollJobStatus();
    }, fallbackPollingIntervalMs);
  }

  function scheduleReconnect() {
    if (stopped || terminalJobReached) {
      return;
    }

    // Each failure waits longer before the next attempt. Capping the array index
    // keeps later attempts at 10 seconds instead of growing without a limit.
    const delayIndex = Math.min(
      reconnectAttempt,
      reconnectDelaysMs.length - 1,
    );
    const delay = reconnectDelaysMs[delayIndex] ?? 10_000;
    reconnectAttempt += 1;

    if (reconnectAttempt >= 3) {
      startFallbackPolling();
    }

    onStatusMessage(
      `Realtime connection lost. Reconnecting in ${delay / 1000} seconds.`,
    );
    reconnectTimer = window.setTimeout(openSocket, delay);
  }

  function handleServerMessage(event: MessageEvent<string>) {
    let message: JobWebSocketMessage;

    try {
      message = JSON.parse(event.data) as JobWebSocketMessage;
    } catch {
      onStatusMessage("Received an invalid realtime update.");
      return;
    }

    if (message.type === "connection_ready") {
      socket?.send(JSON.stringify({ type: "subscribe", jobId }));
      return;
    }

    if (message.type === "subscribed") {
      reconnectAttempt = 0;
      stopFallbackPolling();
      onStatusMessage("Connected to realtime job updates.");
      return;
    }

    if (message.type === "job_update") {
      void deliverJobUpdate(message.job);
      return;
    }

    if (message.type === "error") {
      onStatusMessage(message.error);
    }
  }

  function openSocket() {
    if (stopped || terminalJobReached) {
      return;
    }

    socket = new WebSocket(`${WS_BASE_URL}/ws/jobs`);
    connectionTimer = window.setTimeout(() => {
      socket?.close(4000, "Connection timed out");
    }, connectionTimeoutMs);

    socket.onopen = () => {
      clearTimer(connectionTimer);
      connectionTimer = null;
    };
    socket.onmessage = handleServerMessage;
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      clearTimer(connectionTimer);
      connectionTimer = null;
      scheduleReconnect();
    };
  }

  openSocket();

  return () => {
    stopped = true;
    clearTimer(connectionTimer);
    clearTimer(reconnectTimer);
    stopFallbackPolling();

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "unsubscribe" }));
    }

    socket?.close(1000, "Subscription ended");
  };
}
