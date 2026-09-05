/* Convert worker counts into concise labels and explanations for the UI. */
import type { WorkerAvailability } from "../types";

export type WorkerAvailabilityDisplay = {
  className: string;
  label: string;
  message: string;
};

export function describeWorkerAvailability(
  availability: WorkerAvailability | null,
): WorkerAvailabilityDisplay {
  if (!availability) {
    return {
      className: "status-pill unknown",
      label: "Checking",
      message: "Processing-worker availability is being checked.",
    };
  }

  if (availability.status === "offline") {
    return {
      className: "status-pill offline",
      label: "Offline",
      // A queued job is not lost. Kafka retains it until a worker reconnects.
      message:
        "No processing worker is online. New jobs will wait safely in the queue.",
    };
  }

  if (availability.status === "busy") {
    return {
      className: "status-pill busy",
      label: "Busy",
      message:
        "All online processing workers are busy. New jobs will wait in the queue.",
    };
  }

  const workerWord = availability.idleWorkers === 1 ? "worker is" : "workers are";

  return {
    className: "status-pill online",
    label: "Available",
    message: `${availability.idleWorkers} processing ${workerWord} ready.`,
  };
}
