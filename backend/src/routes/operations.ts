/* Build the internal diagnostics endpoint that Nginx blocks from the public. */
import { Router } from "express";
import { getHttpMetricsSnapshot } from "../observability/metrics.js";
import { getDurableOperationsSnapshot } from "../services/operationsService.js";

export function createOperationsRouter(instanceId: string): Router {
  // A factory receives this backend replica's ID from server.ts instead of
  // reading process state again and creating a different definition here.
  const router = Router();

  router.get("/operations", async (_req, res) => {
    /*
     * Nginx returns 404 for public /internal/ requests. A trusted operator may
     * call this route from the private network to inspect process, queue, job,
     * cleanup, and worker counts without receiving private user records.
     */
    const durable = await getDurableOperationsSnapshot();

    res.json({
      status: "ok",
      service: "backend",
      instanceId,
      uptimeSeconds: Math.round(process.uptime()),
      process: getHttpMetricsSnapshot(),
      durable,
    });
  });

  return router;
}
