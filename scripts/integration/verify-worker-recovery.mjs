/* Prove that an uncommitted job survives forced worker-container removal. */
import {
  cancelJobIfActive,
  createSession,
  submitTestJob,
  waitForJobs,
} from "./client.mjs";
import {
  expireTestJobs,
  forceRemoveWorker,
  queryDatabase,
  readJobAttempts,
  removeWorkerRegistryRow,
  restoreNormalWorker,
  startMockWorkers,
  waitForActiveWorkerCount,
  waitForBusyWorker,
  waitForReplacementWorker,
} from "./docker.mjs";
import { assertProcessingEnvironmentIsIdle } from "./safety.mjs";

function removedWorkerIsStale(workerId) {
  // Worker IDs come from the trusted registry, but validation keeps the SQL
  // interpolation below restricted to Docker's hexadecimal container IDs.
  if (!/^[0-9a-f]{12,64}$/i.test(workerId)) {
    throw new Error(`Unexpected worker ID in stale check: ${workerId}`);
  }

  const result = queryDatabase(
    `SELECT last_heartbeat_at < NOW() - (
       heartbeat_timeout_seconds * INTERVAL '1 second'
     )
     FROM worker_instances
     WHERE worker_id = '${workerId}';`,
  );

  return result === "t";
}

let session;
let jobId;
let removedWorkerId;
let replacementWorkerId;
let testFailure;

try {
  assertProcessingEnvironmentIsIdle();
  /*
   * A 30-second mock is long enough to locate and remove its worker. The job
   * lease uses the smallest production-accepted timeout, 60 seconds, so the
   * complete recovery remains observable without waiting five minutes.
   */
  startMockWorkers({
    count: 3,
    delaySeconds: 30,
    leaseSeconds: 60,
    jobHeartbeatSeconds: 10,
  });
  await waitForActiveWorkerCount(3);

  session = await createSession();
  const createdJob = await submitTestJob(session, 1);
  jobId = createdJob.id;
  console.log(`Created recovery job ${jobId}.`);

  removedWorkerId = await waitForBusyWorker(jobId);
  console.log(`Force-removing busy worker ${removedWorkerId}.`);
  forceRemoveWorker(removedWorkerId);

  // Kafka redelivers the uncommitted message quickly, but PostgreSQL prevents
  // takeover until the dead worker's durable job lease becomes stale.
  replacementWorkerId = await waitForReplacementWorker(
    jobId,
    removedWorkerId,
  );
  console.log(`Replacement worker ${replacementWorkerId} claimed the job.`);

  if (!removedWorkerIsStale(removedWorkerId)) {
    throw new Error("Removed worker did not become stale in the registry");
  }

  const [finalJob] = await waitForJobs(session, [jobId], {
    timeoutMilliseconds: 180_000,
  });

  if (finalJob.status !== "COMPLETED") {
    throw new Error(`Recovered job ended as ${finalJob.status}`);
  }

  const attempts = readJobAttempts([jobId]).get(jobId);

  if (attempts !== 2) {
    throw new Error(`Expected two processing attempts but PostgreSQL recorded ${attempts}`);
  }

  console.log("\nWorker recovery report");
  console.log(`Job recovered: ${jobId}`);
  console.log(`Removed worker: ${removedWorkerId}`);
  console.log(`Replacement worker: ${replacementWorkerId}`);
  console.log(`Processing attempts: ${attempts}`);
  console.log("Removed worker became stale: yes");
  console.log("Recovered job completed: yes");
  console.log("Result: worker recovery verification passed");
} catch (error) {
  testFailure = error;
  console.error(`Worker recovery verification failed: ${error.message}`);
} finally {
  if (session && jobId) {
    await cancelJobIfActive(session, jobId);
  }

  try {
    expireTestJobs(jobId ? [jobId] : []);
  } catch (error) {
    console.error(`Could not expire recovery-test storage: ${error.message}`);
  }

  try {
    // A forced removal cannot unregister itself. Delete only the validated ID
    // captured by this test so normal diagnostics do not retain test debris.
    removeWorkerRegistryRow(removedWorkerId);
  } catch (error) {
    console.error(`Could not remove stale test worker: ${error.message}`);
  }

  try {
    restoreNormalWorker();
  } catch (error) {
    console.error(`Could not restore the normal worker: ${error.message}`);
    testFailure ||= error;
  }
}

if (testFailure) {
  throw testFailure;
}
