/* Show separate connection states for the web API and processing workers. */
import type { HealthResponse, WorkerAvailability } from "../types";
import { describeWorkerAvailability } from "../utils/workerAvailability";

type SystemStatusProps = {
  // null means the initial health request has not succeeded.
  backendHealth: HealthResponse | null;
  message: string;
  workerAvailability: WorkerAvailability | null;
};

export function SystemStatus({
  backendHealth,
  message,
  workerAvailability,
}: SystemStatusProps) {
  // Keep display wording outside JSX conditionals so each state is easy to read
  // and the same rules can be checked by a small automated test.
  const workerDisplay = describeWorkerAvailability(workerAvailability);

  return (
    <section className="panel">
      <h2>System Status</h2>

      <div className="system-status-list">
        <div className="system-status-row">
          <div>
            <strong>Web service</strong>
            <p>
              {backendHealth
                ? `${backendHealth.service} is ${backendHealth.status}.`
                : message}
            </p>
          </div>
          <span
            className={
              backendHealth ? "status-pill online" : "status-pill offline"
            }
          >
            {backendHealth ? "Connected" : "Disconnected"}
          </span>
        </div>

        <div className="system-status-row">
          <div>
            <strong>Audio processing</strong>
            <p>
              {backendHealth
                ? workerDisplay.message
                : "Worker status is unavailable while the web service is offline."}
            </p>
          </div>
          <span
            className={
              backendHealth ? workerDisplay.className : "status-pill unknown"
            }
          >
            {backendHealth ? workerDisplay.label : "Unknown"}
          </span>
        </div>
      </div>
    </section>
  );
}
