/* Resolve every protected request to either a user or an anonymous owner. */
import type { NextFunction, Request, Response } from "express";
import {
  findUserByActiveSession,
  type AuthenticatedUser,
} from "./accountService.js";
import { readAuthenticationToken } from "./authCookie.js";
import { hashAuthenticationToken } from "./authToken.js";
import { readSessionId } from "./session.js";

export type RequestPrincipal = {
  // anonymousOwnerId remains available so login can adopt pre-account jobs.
  anonymousOwnerId: string;
  // ownerId is the value all job and upload authorization checks must use.
  ownerId: string;
  // user is null for a visitor and populated for a valid authenticated session.
  user: AuthenticatedUser | null;
};

export async function resolveRequestPrincipal(
  cookieHeader: string | undefined,
): Promise<RequestPrincipal | null> {
  // The anonymous signed cookie is the baseline identity for every browser.
  const anonymousOwnerId = readSessionId(cookieHeader);

  if (!anonymousOwnerId) {
    return null;
  }

  const authenticationToken = readAuthenticationToken(cookieHeader);

  if (authenticationToken) {
    // Hash the opaque cookie before lookup because raw tokens are never stored.
    const user = await findUserByActiveSession(
      hashAuthenticationToken(authenticationToken),
    );

    if (user) {
      // A logged-in user's permanent UUID replaces the temporary owner UUID.
      return { anonymousOwnerId, ownerId: user.id, user };
    }
  }

  // Missing, expired, or revoked account sessions safely fall back to visitor
  // ownership. They never grant access to the account's jobs.
  return {
    anonymousOwnerId,
    ownerId: anonymousOwnerId,
    user: null,
  };
}

export async function requirePrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const principal = await resolveRequestPrincipal(req.headers.cookie);

    if (!principal) {
      return res.status(401).json({
        error: "A valid browser session is required",
      });
    }

    // Attach server-verified identity to the request. Routes never accept owner
    // IDs from request JSON, query strings, or URL parameters.
    req.ownerId = principal.ownerId;
    req.anonymousOwnerId = principal.anonymousOwnerId;
    req.authenticatedUser = principal.user;
    next();
  } catch (error) {
    // Passing errors to Express keeps logging and safe client responses centralized.
    next(error);
  }
}
