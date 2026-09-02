/* Create or refresh the signed browser session used to own jobs and uploads. */
import { Router } from "express";
import { establishSession, sessionMaxAgeSeconds } from "../auth/session.js";

const router = Router();

router.post("/", (req, res) => {
  const session = establishSession(req, res);

  // 201 means a new session resource was created. Returning 200 for an existing
  // valid cookie tells the client that its session was simply refreshed.
  res.status(session.isNew ? 201 : 200).json({
    // This means anonymous browser ownership is ready. Account authentication is
    // reported separately by GET /api/auth/me.
    sessionReady: true,
    expiresInSeconds: sessionMaxAgeSeconds,
  });
});

export default router;
