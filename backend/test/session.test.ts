/* Verify that browser ownership cookies are reusable but cannot be forged. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

// session.ts validates its secret while the module loads, so configure the test
// process before using a dynamic import to evaluate that module.
process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
process.env.COOKIE_SECURE = "false";

const { establishSession, readSessionId } = await import(
  "../src/auth/session.js"
);

function createResponseRecorder() {
  let setCookieHeader = "";

  // establishSession uses only setHeader. This focused fake avoids starting an
  // Express server while preserving the real cookie-generation implementation.
  const response = {
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "set-cookie") {
        setCookieHeader = value;
      }
    },
  } as unknown as Response;

  return {
    response,
    readSetCookieHeader: () => setCookieHeader,
  };
}

test("a newly issued signed cookie can be verified and reused", () => {
  const firstRecorder = createResponseRecorder();
  const firstRequest = { headers: {} } as Request;
  const firstSession = establishSession(firstRequest, firstRecorder.response);
  const cookiePair = firstRecorder.readSetCookieHeader().split(";", 1)[0];

  assert.ok(cookiePair);
  assert.equal(firstSession.isNew, true);
  assert.equal(readSessionId(cookiePair), firstSession.sessionId);

  const secondRecorder = createResponseRecorder();
  const secondRequest = {
    headers: { cookie: cookiePair },
  } as Request;
  const secondSession = establishSession(secondRequest, secondRecorder.response);

  assert.equal(secondSession.isNew, false);
  assert.equal(secondSession.sessionId, firstSession.sessionId);
});

test("changing the signed session ID invalidates the cookie", () => {
  const recorder = createResponseRecorder();
  const session = establishSession({ headers: {} } as Request, recorder.response);
  const cookiePair = recorder.readSetCookieHeader().split(";", 1)[0];
  const forgedCookie = cookiePair?.replace(
    session.sessionId,
    "00000000-0000-4000-8000-000000000000",
  );

  assert.ok(forgedCookie);
  assert.equal(readSessionId(forgedCookie), null);
});

