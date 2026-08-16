import type { HealthResponse } from "../types";

type SystemStatusProps = {
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
        <span
          className={
            backendHealth ? "status-pill online" : "status-pill offline"
          }
        >
          {backendHealth ? "Connected" : "Disconnected"}
        </span>
      </div>
      <p>
        {backendHealth
          ? `${backendHealth.service} is ${backendHealth.status}`
          : message}
      </p>
    </section>
  );
}
