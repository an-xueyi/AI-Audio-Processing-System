import { Router } from "express";
import { establishSession, sessionMaxAgeSeconds } from "../auth/session.js";

const router = Router();

router.post("/", (req, res) => {
  const session = establishSession(req, res);

  res.status(session.isNew ? 201 : 200).json({
    authenticated: true,
    expiresInSeconds: sessionMaxAgeSeconds,
  });
});

export default router;

