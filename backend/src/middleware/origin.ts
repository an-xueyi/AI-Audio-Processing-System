/* Reject state-changing API requests sent from an unapproved browser origin. */
import type { NextFunction, Request, Response } from "express";
import { isAllowedOrigin } from "../config/security.js";

export function requireAllowedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({
      error: "Request origin is not allowed",
    });
  }

  // Calling next hands the same request to the next middleware or route. A
  // middleware that sends a response above deliberately does not call next.
  next();
}
