/* Hold small per-replica counters that reset whenever this process restarts. */

type HttpStatusGroup = "2xx" | "3xx" | "4xx" | "5xx";

const httpResponseCounts: Record<HttpStatusGroup, number> = {
  "2xx": 0,
  "3xx": 0,
  "4xx": 0,
  "5xx": 0,
};

let httpRequestsTotal = 0;
let activeWebSocketConnections = 0;

export function recordHttpResponse(statusCode: number) {
  httpRequestsTotal += 1;

  // Integer division groups 201 as 2xx, 404 as 4xx, and so on.
  const statusGroup = `${Math.floor(statusCode / 100)}xx`;

  if (statusGroup in httpResponseCounts) {
    httpResponseCounts[statusGroup as HttpStatusGroup] += 1;
  }
}

export function getHttpMetricsSnapshot() {
  // Return a new nested object so callers cannot mutate the module's counters.
  return {
    requestsTotal: httpRequestsTotal,
    responses: { ...httpResponseCounts },
    activeWebSocketConnections,
  };
}

export function recordWebSocketOpened() {
  activeWebSocketConnections += 1;
}

export function recordWebSocketClosed() {
  // max protects the metric if a future error path reports close more than once.
  activeWebSocketConnections = Math.max(0, activeWebSocketConnections - 1);
}

export function resetHttpMetricsForTests() {
  // This export is intentionally named for tests; production code never resets
  // counters except naturally when a container process starts again.
  httpRequestsTotal = 0;
  activeWebSocketConnections = 0;

  for (const statusGroup of Object.keys(httpResponseCounts) as HttpStatusGroup[]) {
    httpResponseCounts[statusGroup] = 0;
  }
}
