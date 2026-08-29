/* Convert unsuccessful HTTP responses into safe, readable user messages. */
import type { ApiErrorResponse } from "../types";

export async function getApiErrorMessage(
  response: Response,
  fallback: string,
) {
  try {
    // Error responses are expected to contain { error: "..." }. Parsing can
    // itself fail for an empty or non-JSON response, so a readable fallback is
    // always returned from the catch branch.
    const data = (await response.json()) as ApiErrorResponse;
    // Logical OR chooses the server's non-empty message or the supplied default.
    const message = data.error || fallback;

    /*
     * A 500-level status means the server failed unexpectedly. Include its
     * correlation ID so the person using the website can report the exact
     * failure. Normal validation errors such as an unsupported file type do not
     * show an ID because the user already has a specific, actionable message.
     * The body is preferred, while the response header is a safe fallback.
     */
    if (response.status >= 500) {
      const requestId =
        data.requestId || response.headers.get("X-Request-ID");

      if (requestId) {
        return `${message} (Request ID: ${requestId})`;
      }
    }

    return message;
  } catch {
    // Parsing failure should not hide the original API operation's useful fallback.
    return fallback;
  }
}
