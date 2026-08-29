/* Verify that unexpected API failures include a useful support identifier. */
import assert from "node:assert/strict";
import test from "node:test";
import { getApiErrorMessage } from "../src/api/apiErrors";

test("a server failure displays the request ID returned in JSON", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Internal server error",
      requestId: "request-json-123",
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" },
    },
  );

  assert.equal(
    await getApiErrorMessage(response, "Request failed"),
    "Internal server error (Request ID: request-json-123)",
  );
});

test("a server failure can use the request ID response header", async () => {
  const response = new Response(JSON.stringify({ error: "Service failed" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "request-header-456",
    },
  });

  assert.equal(
    await getApiErrorMessage(response, "Request failed"),
    "Service failed (Request ID: request-header-456)",
  );
});

test("a normal validation error stays concise", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Unsupported audio type",
      requestId: "unused-request-id",
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );

  assert.equal(
    await getApiErrorMessage(response, "Request failed"),
    "Unsupported audio type",
  );
});
