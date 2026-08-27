import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import type { NextFunction, Request, Response } from "express";
import { sessionCookieSecure } from "../config/security.js";

const sessionCookieName = "audio_session";
export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

const configuredSessionSecret = process.env.SESSION_SECRET;

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
  return createHmac("sha256", sessionSecret)
    .update(sessionId)
    .digest("base64url");
}

function encodeSession(sessionId: string): string {
  return `${sessionId}.${createSignature(sessionId)}`;
}

function decodeSession(value: string): string | null {
  const separatorIndex = value.lastIndexOf(".");

  if (separatorIndex === -1) {
    return null;
  }

  const sessionId = value.slice(0, separatorIndex);
  const suppliedSignature = value.slice(separatorIndex + 1);
  const expectedSignature = createSignature(sessionId);
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

  return /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null;
}

export function readSessionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = parseCookie(cookieHeader);
  const value = cookies[sessionCookieName];
  return value ? decodeSession(value) : null;
}

export function establishSession(req: Request, res: Response) {
  const existingSessionId = readSessionId(req.headers.cookie);
  const sessionId = existingSessionId || randomUUID();

  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: sessionCookieName,
      value: encodeSession(sessionId),
      // JavaScript running in the browser cannot read an HttpOnly cookie. The
      // browser still sends it automatically with API and WebSocket requests.
      httpOnly: true,
      maxAge: sessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: sessionCookieSecure,
    }),
  );

  return {
    isNew: existingSessionId === null,
    sessionId,
  };
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const sessionId = readSessionId(req.headers.cookie);

  if (!sessionId) {
    return res.status(401).json({
      error: "A valid session is required",
    });
  }

  req.sessionId = sessionId;
  next();
}
