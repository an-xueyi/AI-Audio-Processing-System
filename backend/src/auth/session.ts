/* Create, sign, read, and enforce the browser's stateless ownership session. */
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Request, Response } from "express";
import { sessionCookieSecure } from "../config/security.js";

// This is the name visible in the browser's cookie storage and Cookie header.
const sessionCookieName = "audio_session";

// Cookie maxAge uses seconds: seven days * 24 hours * 60 minutes * 60 seconds.
export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

// Read the private signing key once while the module starts.
const configuredSessionSecret = process.env.SESSION_SECRET;

// Stop startup immediately if the secret is missing or too short. Running with a
// weak default would let an attacker guess signatures and impersonate sessions.
if (!configuredSessionSecret || configuredSessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters");
}

const sessionSecret: string = configuredSessionSecret;

/*
 * This application uses a signed, stateless session instead of storing browser
 * sessions in one backend container's memory. The cookie contains a random ID
 * plus a signature created with SESSION_SECRET. Any backend replica that knows
 * the same secret can verify the cookie, so a request may move between replicas
 * without signing the user out. The signature proves that the ID was created by
 * this application; it does not encrypt the ID or place private data in it.
 */
function createSignature(sessionId: string): string {
  // HMAC combines the session ID with the private secret. The same input and
  // secret always produce the same signature, but the secret cannot be recovered
  // from that signature.
  return createHmac("sha256", sessionSecret)
    // Add the session ID bytes to the HMAC calculation.
    .update(sessionId)
    // Finish the calculation and represent its binary bytes as URL-safe text.
    .digest("base64url");
}

function encodeSession(sessionId: string): string {
  // The period separates the readable random ID from its verification signature.
  return `${sessionId}.${createSignature(sessionId)}`;
}

function decodeSession(value: string): string | null {
  // Search from the end so the value is split at the signature separator.
  const separatorIndex = value.lastIndexOf(".");

  // -1 means no period was found, so this cannot be an encoded session.
  if (separatorIndex === -1) {
    return null;
  }

  // slice extracts text before and after the separator without including it.
  const sessionId = value.slice(0, separatorIndex);
  const suppliedSignature = value.slice(separatorIndex + 1);

  // Recompute what the signature must be for the supplied session ID.
  const expectedSignature = createSignature(sessionId);

  // timingSafeEqual compares bytes, so both strings are converted to Buffers.
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  // timingSafeEqual performs the comparison in a way that does not reveal how
  // many characters matched through tiny timing differences. Equal lengths are
  // required by the Node.js API, so length is checked before calling it.
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  // A valid signature is followed by a format check for the 36-character UUID.
  // The ternary returns the ID on success and null for malformed text.
  return /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null;
}

export function readSessionId(cookieHeader: string | undefined): string | null {
  // Requests without a Cookie header cannot contain an existing session.
  if (!cookieHeader) {
    return null;
  }

  // parseCookie turns "name=value; other=value" text into a keyed object.
  const cookies = parseCookie(cookieHeader);
  const value = cookies[sessionCookieName];

  // Decode only when this application's named cookie exists.
  return value ? decodeSession(value) : null;
}

export function establishSession(req: Request, res: Response) {
  // Reuse a valid existing ID so refreshing the session does not lose ownership
  // of earlier uploads and jobs.
  const existingSessionId = readSessionId(req.headers.cookie);

  // Logical OR selects the existing ID or creates a cryptographically random UUID.
  const sessionId = existingSessionId || randomUUID();

  // Set-Cookie instructs the browser to store this value. stringifySetCookie
  // formats the object below into a standards-compliant HTTP header string.
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: sessionCookieName,
      value: encodeSession(sessionId),
      // JavaScript running in the browser cannot read an HttpOnly cookie. The
      // browser still sends it automatically with API and WebSocket requests.
      httpOnly: true,
      // Refresh the cookie's lifetime to seven days from this response.
      maxAge: sessionMaxAgeSeconds,
      // Path / makes the cookie available to every backend route and WebSocket.
      path: "/",
      // lax blocks most cross-site cookie sends while allowing normal navigation.
      sameSite: "lax",
      secure: sessionCookieSecure,
    }),
  );

  return {
    // The route uses this Boolean to choose HTTP 201 for new or 200 for refreshed.
    isNew: existingSessionId === null,
    sessionId,
  };
}
