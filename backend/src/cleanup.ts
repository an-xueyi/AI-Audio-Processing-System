/* Run storage cleanup as a dedicated long-lived Docker service. */
import {
  cleanupBatchSize,
  cleanupClaimTimeoutMinutes,
  cleanupIntervalSeconds,
} from "./config/retention.js";
import { pool } from "./db.js";
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
  console.log(`Received ${signal}. Storage cleanup will stop safely.`);
  shutdownRequested = true;
  finishCurrentDelay?.();
}

async function runCleanupLoop() {
  console.log(
    `Storage cleanup started: batch=${cleanupBatchSize}, ` +
      `interval=${cleanupIntervalSeconds}s`,
  );

  while (!shutdownRequested) {
    try {
      // One cycle claims and processes at most cleanupBatchSize jobs.
      const result = await cleanupExpiredStorageBatch(
        cleanupBatchSize,
        cleanupClaimTimeoutMinutes,
      );

      if (result.claimed > 0) {
        console.log(
          `Cleanup cycle finished: claimed=${result.claimed}, ` +
            `deleted=${result.deleted}, failed=${result.failed}`,
        );
      }
    } catch (error) {
      // Infrastructure failure ends only this cycle. The next interval retries,
      // allowing PostgreSQL or MinIO to recover without restarting the process.
      console.error("Storage cleanup cycle failed:", error);
    }

    if (!shutdownRequested) {
      await waitForNextCycle(cleanupIntervalSeconds * 1_000);
    }
  }

  // No new queries will begin after this point, so the shared pool can close.
  await pool.end();
  console.log("Storage cleanup stopped");
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

void runCleanupLoop().catch((error) => {
  console.error("Storage cleanup stopped unexpectedly:", error);
  process.exit(1);
});

