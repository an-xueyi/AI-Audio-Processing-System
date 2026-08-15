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

  next();
}

