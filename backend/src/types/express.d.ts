/*
 * Extend Express's Request type with data installed by authentication
 * middleware. This is a compile-time declaration only; requireSession performs
 * the runtime assignment before protected routes read req.sessionId.
 */
declare global {
  namespace Express {
    interface Request {
      sessionId: string;
      // Every request receives this server-generated correlation ID before routes.
      requestId: string;
    }
  }
}

// Exporting an empty object makes this file a module, which is required for the
// global declaration merge above to be accepted by TypeScript.
export {};
