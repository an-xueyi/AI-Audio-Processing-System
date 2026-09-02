/*
 * Extend Express's Request type with data installed by authentication and
 * observability middleware. This is a compile-time declaration only;
 * requirePrincipal performs the runtime identity assignments.
 */
import type { AuthenticatedUser } from "../auth/accountService.js";

declare global {
  namespace Express {
    interface Request {
      // Permanent user UUID when logged in, otherwise the anonymous browser UUID.
      ownerId: string;
      // The signed anonymous UUID remains available while a user is logged in so
      // registration/login can transfer earlier browser-owned jobs to the account.
      anonymousOwnerId: string;
      // null distinguishes a valid anonymous visitor from an authenticated user.
      authenticatedUser: AuthenticatedUser | null;
      // Every request receives this server-generated correlation ID before routes.
      requestId: string;
    }
  }
}

// Exporting an empty object makes this file a module, which is required for the
// global declaration merge above to be accepted by TypeScript.
export {};
