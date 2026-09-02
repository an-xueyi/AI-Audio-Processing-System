/* Read, set, and clear the opaque cookie used for authenticated user sessions. */
import { parseCookie, stringifySetCookie } from "cookie";
import type { Response } from "express";
import { sessionCookieSecure } from "../config/security.js";
import { sessionMaxAgeSeconds } from "./session.js";

const authenticationCookieName = "audio_auth";

function formatAuthenticationCookie(value: string, maxAge: number) {
  return stringifySetCookie({
    name: authenticationCookieName,
    value,
    // HttpOnly prevents application JavaScript from reading or copying the token.
    httpOnly: true,
    maxAge,
    path: "/",
    // Lax blocks most cross-site requests from automatically carrying the cookie.
    sameSite: "lax",
    // Production HTTPS enables Secure through COOKIE_SECURE=true.
    secure: sessionCookieSecure,
  });
}

export function readAuthenticationToken(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  // Cookie parses the complete header and returns only this application's value.
  return parseCookie(cookieHeader)[authenticationCookieName] ?? null;
}

export function setAuthenticationCookie(res: Response, token: string) {
  // append preserves any anonymous-session Set-Cookie header already on response.
  res.append(
    "Set-Cookie",
    formatAuthenticationCookie(token, sessionMaxAgeSeconds),
  );
}

export function clearAuthenticationCookie(res: Response) {
  // Max-Age=0 instructs the browser to remove the cookie immediately.
  res.append("Set-Cookie", formatAuthenticationCookie("", 0));
}
