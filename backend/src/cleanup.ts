/* Run storage cleanup as a dedicated long-lived Docker service. */
import {
  cleanupBatchSize,
  cleanupClaimTimeoutMinutes,
  cleanupIntervalSeconds,
} from "./config/retention.js";
import { pool } from "./db.js";
import { logger } from "./observability/logger.js";
import { cleanupExpiredStorageBatch } from "./services/storageCleanup.js";

let shutdownRequested = false;
let finishCurrentDelay: (() => void) | null = null;

function waitForNextCycle(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finishCurrentDelay = null;
      resolve();
    }, milliseconds);

    // Saving this function lets SIGTERM interrupt a long wait immediately.
    finishCurrentDelay = () => {
      clearTimeout(timer);
      finishCurrentDelay = null;
      resolve();
    };
  });
}

function requestShutdown(signal: string) {
  logger.info("storage_cleanup_shutdown_requested", { signal });
  shutdownRequested = true;
  finishCurrentDelay?.();
}

async function runCleanupLoop() {
  logger.info("storage_cleanup_started", {
    batchSize: cleanupBatchSize,
    claimTimeoutMinutes: cleanupClaimTimeoutMinutes,
    intervalSeconds: cleanupIntervalSeconds,
  });

  while (!shutdownRequested) {
    try {
      // One cycle claims and processes at most cleanupBatchSize jobs.
      const result = await cleanupExpiredStorageBatch(
        cleanupBatchSize,
        cleanupClaimTimeoutMinutes,
      );

      if (result.claimed > 0) {
        logger.info("storage_cleanup_cycle_completed", result);
      }
    } catch (error) {
      // Infrastructure failure ends only this cycle. The next interval retries,
      // allowing PostgreSQL or MinIO to recover without restarting the process.
      logger.error("storage_cleanup_cycle_failed", { error });
    }

    if (!shutdownRequested) {
      await waitForNextCycle(cleanupIntervalSeconds * 1_000);
    }
  }

  // No new queries will begin after this point, so the shared pool can close.
  await pool.end();
  logger.info("storage_cleanup_stopped");
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

void runCleanupLoop().catch((error) => {
  logger.error("storage_cleanup_stopped_unexpectedly", { error });
  process.exit(1);
});
