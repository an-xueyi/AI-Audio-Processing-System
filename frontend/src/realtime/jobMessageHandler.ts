/*
 * Convert raw WebSocket messages into small, named application callbacks.
 *
 * The browser receives every WebSocket message as JSON text. Keeping the JSON
 * parsing and message-type decisions in this file lets jobSubscription.ts focus
 * on connection lifetime, reconnection timers, and HTTP fallback polling.
 */
import type { Job, JobWebSocketMessage } from "../types";

type JobMessageHandlerOptions = {
  // Ask the backend to begin sending updates for the selected job.
  sendSubscription: () => void;
  // Tell the connection owner that the backend accepted the subscription.
  onSubscribed: () => void;
  // Forward a complete job received from the backend.
  onJobUpdate: (job: Job) => void;
  // Display either a backend error or a local message-parsing error.
  onError: (message: string) => void;
};

/** Build the function assigned to a WebSocket's `onmessage` property. */
export function createJobMessageHandler({
  sendSubscription,
  onSubscribed,
  onJobUpdate,
  onError,
}: JobMessageHandlerOptions) {
  // The returned function runs once for every text message sent by the server.
  return (event: MessageEvent<string>) => {
    // This variable will contain one member of the JobWebSocketMessage union
    // after the JSON text has been parsed successfully.
    let message: JobWebSocketMessage;

    try {
      // JSON.parse reconstructs the JavaScript object represented by the text.
      // The type assertion tells TypeScript which known message shapes to use.
      message = JSON.parse(event.data) as JobWebSocketMessage;
    } catch {
      // Invalid JSON cannot be inspected safely. Report this one bad message
      // without closing an otherwise healthy WebSocket connection.
      onError("Received an invalid realtime update.");
      return;
    }

    // connection_ready means the transport is open. The browser can now tell
    // the backend which job it wants to watch.
    if (message.type === "connection_ready") {
      sendSubscription();
      return;
    }

    // subscribed confirms that the backend verified access to the requested job
    // and registered this WebSocket as one of that job's listeners.
    if (message.type === "subscribed") {
      onSubscribed();
      return;
    }

    // job_update contains the complete, newest database representation of a job.
    if (message.type === "job_update") {
      onJobUpdate(message.job);
      return;
    }

    // Backend validation or authorization failures use the error message type.
    if (message.type === "error") {
      onError(message.error);
    }
  };
}
