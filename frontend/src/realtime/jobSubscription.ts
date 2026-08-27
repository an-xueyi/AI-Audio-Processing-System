/*
 * Maintain a reliable realtime connection for one processing job.
 *
 * The preferred communication method is WebSocket because the backend can push
 * changes immediately. This module also reconnects after a failure and falls
 * back to repeated HTTP requests when WebSocket communication is unavailable.
 */
import { fetchJob } from "../api/audioProcessing";
import { WS_BASE_URL } from "../config";
import type { Job, JobStatus, JobWebSocketMessage } from "../types";

// Give the server ten seconds to open a WebSocket before treating the attempt as
// stuck. Numeric separators make 10_000 easier to read; its value is 10000 ms.
const connectionTimeoutMs = 10_000;

// Poll the ordinary HTTP job endpoint every two seconds only as a backup.
const fallbackPollingIntervalMs = 2_000;

// Each failed WebSocket attempt uses the next delay. Waiting longer over time
// avoids sending rapid connection attempts while the backend is unavailable.
const reconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 10_000];

// A terminal status means processing will never move to another active status.
// ReadonlySet communicates that this function only checks the collection and
// should never add or remove statuses while the application is running.
const terminalStatuses: ReadonlySet<JobStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

type JobSubscriptionOptions = {
  // The backend job UUID that this connection should watch.
  jobId: string;
  // Called when a changed Job object should be placed into React state. The
  // callback may be synchronous or may return a Promise for additional work.
  onJobUpdate: (job: Job) => void | Promise<void>;
  // Called when connection information should be shown to the user.
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
  // Each variable begins with a neutral value because no connection or timer
  // exists at the moment this subscription function starts.
  let socket: WebSocket | null = null;

  // Browsers return a numeric timer ID from window.setTimeout/setInterval. We
  // save each ID so that its scheduled work can be cancelled later.
  let reconnectTimer: number | null = null;
  let connectionTimer: number | null = null;
  let fallbackPollingTimer: number | null = null;

  // Count consecutive reconnection attempts so scheduleReconnect can select an
  // increasingly long delay from reconnectDelaysMs.
  let reconnectAttempt = 0;

  // stopped becomes true during cleanup. Delayed callbacks check this value and
  // refuse to create a new connection after React has left the job screen.
  let stopped = false;

  // Once the job is terminal, neither reconnection nor polling is useful.
  let terminalJobReached = false;

  // Store the previous job as JSON text to suppress duplicate updates. An empty
  // string guarantees that the first real job payload is always delivered.
  let previousJobPayload = "";

  /** Cancel one timeout when its timer ID currently exists. */
  function clearTimer(timer: number | null) {
    // null represents "no timer." This guard prevents passing a nonexistent ID
    // to the browser timer API and makes the helper safe to call during cleanup.
    if (timer !== null) {
      // clearTimeout prevents the callback registered by setTimeout from running.
      // It is safe to call even if that timeout has already fired.
      window.clearTimeout(timer);
    }
  }

  /** Stop the repeating HTTP fallback and mark it as inactive. */
  function stopFallbackPolling() {
    // Only a non-null ID can refer to a running polling interval.
    if (fallbackPollingTimer !== null) {
      // clearInterval prevents all future repetitions of pollJobStatus.
      window.clearInterval(fallbackPollingTimer);

      // Resetting the variable is important: startFallbackPolling checks for
      // null to decide whether it is allowed to create a new interval later.
      fallbackPollingTimer = null;
    }
  }

  /** Forward a changed job to React and stop watching terminal jobs. */
  async function deliverJobUpdate(job: Job) {
    // JSON.stringify converts the complete object into stable text. Two job
    // objects received at different times can be compared by their contents
    // even though they are different JavaScript object instances.
    const payload = JSON.stringify(job);

    // When every serialized field is unchanged, React does not need another
    // state update and the user does not need to see the same message again.
    if (payload === previousJobPayload) {
      // return exits this function immediately without running later statements.
      return;
    }

    // Remember this version before invoking the callback so another update can
    // be compared against the latest payload.
    previousJobPayload = payload;

    // await supports both callback forms declared above: it waits for an async
    // callback, while a callback returning void completes immediately.
    await onJobUpdate(job);

    // Set.has returns true when the current status is one of the three terminal
    // values declared at the top of this file.
    if (terminalStatuses.has(job.status)) {
      // This flag blocks scheduleReconnect and startFallbackPolling from doing
      // more network work after processing has permanently ended.
      terminalJobReached = true;

      // Stop any HTTP backup requests that may have started during an outage.
      stopFallbackPolling();

      // Optional chaining (`?.`) calls close only if socket is not null. Code
      // 1000 is the standard normal-closure code; the text explains the reason.
      socket?.close(1000, "Job finished");
    }
  }

  /** Request the current job through HTTP when realtime delivery is unavailable. */
  async function pollJobStatus() {
    try {
      // The inner await waits for fetchJob to return a Job from the backend. The
      // outer await then waits for deliverJobUpdate to process that Job.
      await deliverJobUpdate(await fetchJob(jobId));
    } catch (error) {
      // A catch value is unknown in JavaScript: code may throw an Error, a string,
      // or another value. instanceof safely checks whether `.message` exists.
      onStatusMessage(
        error instanceof Error
          ? error.message
          : "Could not recover the job status.",
      );
    }
  }

  function startFallbackPolling() {
    // Do nothing if polling already exists or the job has permanently finished.
    // The OR operator means either condition is enough to enter this branch.
    if (fallbackPollingTimer !== null || terminalJobReached) {
      return;
    }

    /*
     * WebSockets are the primary path because the server can push an update as
     * soon as a worker changes the job. After three failed reconnections, HTTP
     * polling becomes a backup. It is less efficient, but it keeps the page
     * useful when a network or proxy blocks WebSockets.
     */
    // Update the visible status before starting network requests so the user
    // understands that updates are now arriving through the slower backup path.
    onStatusMessage(
      "Realtime connection is unavailable. Using status polling.",
    );
    // Fetch immediately instead of waiting two seconds for the first interval.
    // `void` intentionally ignores the Promise because errors are handled inside
    // pollJobStatus itself.
    void pollJobStatus();

    // setInterval repeatedly executes this callback until clearInterval is called.
    // Saving the returned ID allows stopFallbackPolling to cancel it later.
    fallbackPollingTimer = window.setInterval(() => {
      void pollJobStatus();
    }, fallbackPollingIntervalMs);
  }

  function scheduleReconnect() {
    // A scheduled reconnect is unwanted after explicit cleanup or completion.
    if (stopped || terminalJobReached) {
      return;
    }

    // Each failure waits longer before the next attempt. Capping the array index
    // keeps later attempts at 10 seconds instead of growing without a limit.
    const delayIndex = Math.min(
      reconnectAttempt,
      reconnectDelaysMs.length - 1,
    );
    // Array lookup could theoretically be undefined. `?? 10_000` supplies a
    // safe ten-second fallback only when the lookup is null or undefined.
    const delay = reconnectDelaysMs[delayIndex] ?? 10_000;

    // Increase the count after choosing this attempt's delay so the next failure
    // advances to the next value in reconnectDelaysMs.
    reconnectAttempt += 1;

    // After three failures, start HTTP polling while WebSocket retries continue
    // in the background. A successful subscription will stop the polling again.
    if (reconnectAttempt >= 3) {
      startFallbackPolling();
    }

    onStatusMessage(
      `Realtime connection lost. Reconnecting in ${delay / 1000} seconds.`,
    );
    // setTimeout calls openSocket once after delay milliseconds. Passing the
    // function itself avoids opening the socket immediately.
    reconnectTimer = window.setTimeout(openSocket, delay);
  }

  /** Parse one server message and perform the action named by its `type`. */
  function handleServerMessage(event: MessageEvent<string>) {
    // This variable will contain one shape from the JobWebSocketMessage union
    // after the JSON text has been parsed successfully.
    let message: JobWebSocketMessage;

    try {
      // WebSocket messages arrive as text here. JSON.parse reconstructs the
      // JavaScript object represented by that text.
      message = JSON.parse(event.data) as JobWebSocketMessage;
    } catch {
      // Invalid JSON cannot be inspected safely, so report it and stop handling
      // only this message. The WebSocket itself can remain connected.
      onStatusMessage("Received an invalid realtime update.");
      return;
    }

    // connection_ready means the transport is ready, but the server does not yet
    // know which job this browser wants. Send a small subscription command.
    if (message.type === "connection_ready") {
      // JSON.stringify converts the command object to WebSocket text. Optional
      // chaining avoids an exception if the socket closed between these events.
      socket?.send(JSON.stringify({ type: "subscribe", jobId }));
      return;
    }

    // subscribed confirms that the backend verified ownership and registered
    // this socket as a listener for the requested job.
    if (message.type === "subscribed") {
      // A successful connection resets backoff so a future outage starts again
      // with the shortest one-second reconnection delay.
      reconnectAttempt = 0;
      stopFallbackPolling();
      onStatusMessage("Connected to realtime job updates.");
      return;
    }

    // job_update carries a complete current Job object from PostgreSQL.
    if (message.type === "job_update") {
      // The message handler itself is synchronous, so deliberately start the
      // async delivery function without returning its Promise to the browser API.
      void deliverJobUpdate(message.job);
      return;
    }

    // Server-side validation or subscription failures arrive as error messages.
    if (message.type === "error") {
      onStatusMessage(message.error);
    }
  }

  /** Create one WebSocket and register all browser event handlers on it. */
  function openSocket() {
    // A delayed reconnect callback may execute after cleanup or completion. This
    // second guard ensures it cannot reopen a connection in that situation.
    if (stopped || terminalJobReached) {
      return;
    }

    // Constructing WebSocket begins an asynchronous connection attempt to the
    // backend endpoint; it does not wait for the connection to become ready.
    socket = new WebSocket(`${WS_BASE_URL}/ws/jobs`);

    // Start a separate timeout that closes a connection attempt which never
    // reaches its open event.
    connectionTimer = window.setTimeout(() => {
      // Code 4000 is an application-defined close code used for this timeout.
      socket?.close(4000, "Connection timed out");
    }, connectionTimeoutMs);

    // onopen runs after the WebSocket handshake succeeds.
    socket.onopen = () => {
      // The connection succeeded, so its failure timeout is no longer needed.
      clearTimer(connectionTimer);
      connectionTimer = null;
    };

    // Assign the named parser above as the handler for every incoming message.
    socket.onmessage = handleServerMessage;

    // The browser's error event usually has little useful detail. Closing the
    // socket funnels recovery through the single onclose/reconnect path.
    socket.onerror = () => socket?.close();

    // onclose runs for server closure, network failure, timeout, or local close.
    socket.onclose = () => {
      clearTimer(connectionTimer);
      connectionTimer = null;

      // scheduleReconnect checks terminalJobReached and stopped, so normal job
      // completion and React cleanup do not actually produce another socket.
      scheduleReconnect();
    };
  }

  // Open the first connection immediately when this subscription is created.
  openSocket();

  // Return cleanup to the React hook. React calls it when the watched job changes
  // or when the component using the hook is removed from the page.
  return () => {
    // Set this first so a close event cannot schedule another connection.
    stopped = true;

    // Cancel one-time connection and reconnection callbacks that have not fired.
    clearTimer(connectionTimer);
    clearTimer(reconnectTimer);

    // Cancel the repeating HTTP backup if it is active.
    stopFallbackPolling();

    // readyState OPEN means send is currently legal. Informing the server lets it
    // remove the job subscription before the network connection finishes closing.
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "unsubscribe" }));
    }

    // Close an existing socket normally. Optional chaining also handles the case
    // where cleanup occurs before any socket object was assigned.
    socket?.close(1000, "Subscription ended");
  };
}
