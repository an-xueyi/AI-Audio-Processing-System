/* Prove that several real API jobs are distributed and completed exactly once. */
import {
  cancelJobIfActive,
  createSession,
  sleep,
  submitTestJobs,
  waitForJobs,
} from "./client.mjs";
import {
  expireTestJobs,
  readJobAttempts,
  readWorkerEvents,
  restoreNormalWorker,
  startMockWorkers,
  waitForActiveWorkerCount,
} from "./docker.mjs";
import { assertProcessingEnvironmentIsIdle } from "./safety.mjs";

function readJobCount() {
  const configuredValue = process.env.INTEGRATION_JOB_COUNT || "9";
  const count = Number(configuredValue);

  if (!Number.isInteger(count) || count < 3 || count > 30) {
    throw new Error("INTEGRATION_JOB_COUNT must be an integer from 3 to 30");
  }

  return count;
}

const jobCount = readJobCount();
let session;
let jobIds = [];
let testFailure;

try {
  assertProcessingEnvironmentIsIdle();
  // Nine short jobs are enough to exercise all three workers in normal Kafka
  // hashing while keeping the complete local run quick and inexpensive.
  startMockWorkers({ count: 3, delaySeconds: 6 });
  await waitForActiveWorkerCount(3);

  session = await createSession();
  const createdJobs = await submitTestJobs(session, jobCount);
  jobIds = createdJobs.map((job) => job.id);
  console.log(`Submitted ${jobIds.length} jobs through the public API.`);

  const completedJobs = await waitForJobs(session, jobIds);
  const nonCompletedJobs = completedJobs.filter(
    (job) => job.status !== "COMPLETED",
  );

  if (nonCompletedJobs.length > 0) {
    throw new Error(
      `Terminal jobs were not completed: ${nonCompletedJobs
        .map((job) => `${job.id}=${job.status}`)
        .join(", ")}`,
    );
  }

  // Give synchronous Kafka commit logs a brief moment to reach Docker output.
  await sleep(500);
  const events = readWorkerEvents(jobIds);
  const completions = events.filter((event) => event.event === "job_completed");
  const commits = events.filter(
    (event) => event.event === "kafka_offset_committed",
  );
  const workerIds = new Set(completions.map((event) => event.workerId));
  const attempts = readJobAttempts(jobIds);

  for (const jobId of jobIds) {
    const completionCount = completions.filter(
      (event) => event.jobId === jobId,
    ).length;
    const commitCount = commits.filter((event) => event.jobId === jobId).length;

    if (completionCount !== 1) {
      throw new Error(`Job ${jobId} has ${completionCount} completion events`);
    }

    if (commitCount !== 1) {
      throw new Error(`Job ${jobId} has ${commitCount} offset commits`);
    }

    if (attempts.get(jobId) !== 1) {
      throw new Error(`Job ${jobId} did not complete in exactly one attempt`);
    }
  }

  if (workerIds.size < 2) {
    throw new Error("Kafka did not distribute test jobs to multiple workers");
  }

  console.log("\nDistributed processing report");
  console.log(`Workers that completed jobs: ${workerIds.size}`);
  console.log(`Jobs submitted: ${jobIds.length}`);
  console.log(`Jobs completed: ${completedJobs.length}`);
  console.log(`Jobs with one completion event: ${jobIds.length}`);
  console.log(`Kafka offsets committed: ${commits.length}`);
  console.log("Result: distributed processing verification passed");
} catch (error) {
  testFailure = error;
  console.error(`Distributed processing verification failed: ${error.message}`);
} finally {
  // Stop active temporary work before expiring its private storage. Each test
  // session is separate from the user's browser and never appears in its history.
  if (session) {
    await Promise.all(jobIds.map((jobId) => cancelJobIfActive(session, jobId)));
  }

  try {
    expireTestJobs(jobIds);
  } catch (error) {
    console.error(`Could not expire test storage: ${error.message}`);
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
