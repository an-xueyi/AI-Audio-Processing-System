/* Return public, secret-free information about audio-processing capacity. */
import { Router } from "express";
import { getWorkerAvailability } from "../services/operationsService.js";

// A Router groups endpoints that share the /api/system prefix in server.ts.
const router = Router();

router.get("/availability", async (_req, res) => {
  // The service counts only recent heartbeats. It does not return worker IDs,
  // machine names, current job IDs, database addresses, or credentials.
  const availability = await getWorkerAvailability();

  // HTTP 200 is returned even when no worker is online. The backend is healthy;
  // "offline" is useful application state rather than an HTTP server failure.
  res.json(availability);
});

export default router;
