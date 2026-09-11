/* Prove that duplicate and excessive jobs are rejected through the public API. */
import {
  cancelJobIfActive,
  createJobForUpload,
  createSession,
  requestUploadPermission,
  submitTestJob,
  uploadBytesToStorage,
} from "./client.mjs";
import {
  expireTestJobs,
  restoreNormalWorker,
  startMockWorkers,
  waitForActiveWorkerCount,
} from "./docker.mjs";
import { assertProcessingEnvironmentIsIdle } from "./safety.mjs";

let session;
let jobIds = [];
let testFailure;

function expectHttpConflict(error, expectedMessagePart) {
  // Integration HTTP helpers represent unsuccessful responses as Error objects.
  // Check both status and safe server wording so a generic 500 cannot pass.
  if (
    !(error instanceof Error) ||
    !error.message.includes("HTTP 409") ||
    !error.message.includes(expectedMessagePart)
  ) {
    throw new Error(
      `Expected HTTP 409 containing "${expectedMessagePart}", received: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

try {
  // Scaling workers or changing processing mode is disruptive. Refuse to begin
  // when a real current job, busy worker, outbox event, or Kafka message exists.
  assertProcessingEnvironmentIsIdle();

  // A long mock delay keeps the first two jobs active while capacity is checked.
  // It replaces Demucs calculation only; API, storage, SQL, Kafka, and job claims
  // still use the real application services.
  startMockWorkers({ count: 1, delaySeconds: 45 });
  await waitForActiveWorkerCount(1);
  session = await createSession();

  const firstFileName = `admission-test-${Date.now()}.mp3`;
  const firstAudioBytes = Buffer.from(
    `ID3\nAdmission integration test\n${Date.now()}\n`,
    "utf8",
  );
  const firstPermission = await requestUploadPermission(session, {
    fileName: firstFileName,
    contentType: "audio/mpeg",
    fileSize: firstAudioBytes.length,
  });
  await uploadBytesToStorage(firstPermission, {
    contentType: "audio/mpeg",
    audioBytes: firstAudioBytes,
  });
  const firstJob = await createJobForUpload(session, {
    originalFileName: firstFileName,
    inputObjectKey: firstPermission.objectKey,
  });
  jobIds.push(firstJob.id);

  try {
    // Repeat the identical control request. The backend must not create another
    // database row or Kafka event for the same uploaded object key.
    await createJobForUpload(session, {
      originalFileName: firstFileName,
      inputObjectKey: firstPermission.objectKey,
    });
    throw new Error("Duplicate job creation unexpectedly succeeded");
  } catch (error) {
    expectHttpConflict(error, "already has a processing job");
  }

  // A different upload may become the owner's second active job.
  const secondJob = await submitTestJob(session, 2);
  jobIds.push(secondJob.id);

  try {
    // The third workflow should stop at the presign request. No signed URL means
    // the browser never transfers bytes that cannot currently enter the queue.
    await requestUploadPermission(session, {
      fileName: `admission-over-limit-${Date.now()}.mp3`,
      contentType: "audio/mpeg",
      fileSize: 32,
    });
    throw new Error("Upload permission above the active-job limit succeeded");
  } catch (error) {
    expectHttpConflict(error, "2 active jobs");
  }

  console.log("\nJob admission report");
  console.log("First active job accepted: yes");
  console.log("Duplicate job rejected with HTTP 409: yes");
  console.log("Second active job accepted: yes");
  console.log("Third upload stopped before byte transfer: yes");
  console.log("Result: job admission verification passed");
} catch (error) {
  testFailure = error;
  console.error(`Job admission verification failed: ${error.message}`);
} finally {
  // Cancel only jobs created by this private integration session before changing
  // the temporary worker configuration or expiring their storage.
  if (session) {
    await Promise.all(jobIds.map((jobId) => cancelJobIfActive(session, jobId)));
  }

  try {
    expireTestJobs(jobIds);
  } catch (error) {
    console.error(`Could not expire admission-test storage: ${error.message}`);
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
