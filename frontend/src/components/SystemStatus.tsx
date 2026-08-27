/* Show whether the initial backend health request succeeded. */
import type { HealthResponse } from "../types";

type SystemStatusProps = {
  // null means the initial health request has not succeeded.
  backendHealth: HealthResponse | null;
  message: string;
};

export function SystemStatus({
  backendHealth,
  message,
}: SystemStatusProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <h2>System Status</h2>
        {/* The selected CSS class controls both the label and status color. */}
        <span
          className={
            backendHealth ? "status-pill online" : "status-pill offline"
          }
        >
          {/* The ternary chooses one label from the presence of health data. */}
          {backendHealth ? "Connected" : "Disconnected"}
        </span>
      </div>
      <p>
        {/* On success show structured health; otherwise show the current message. */}
        {backendHealth
          ? `${backendHealth.service} is ${backendHealth.status}`
          : message}
      </p>
    </section>
  );
}
