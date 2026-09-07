/* Verify private WebSocket subscriptions, live progress, and result links. */
import {
  cancelJobIfActive,
  createSession,
  fetchDownloadUrls,
  submitTestJob,
} from "./client.mjs";
import {
  expireTestJobs,
  restoreNormalWorker,
  startMockWorkers,
  waitForActiveWorkerCount,
} from "./docker.mjs";
import { assertProcessingEnvironmentIsIdle } from "./safety.mjs";
import { connectJobWebSocket } from "./websocket-client.mjs";

let ownerSession;
let jobId;
let ownerSocket;
let otherSocket;
let testFailure;

try {
  // This program temporarily changes the worker service to mock mode. Refuse to
  // begin if doing that could interrupt a real audio-processing job.
  assertProcessingEnvironmentIsIdle();

  /*
   * Mock mode exercises PostgreSQL, Kafka, outbox events, WebSockets, and MinIO
   * without spending several minutes on Demucs. Eight seconds leaves enough
   * time to observe several progress messages before completion.
   */
  startMockWorkers({ count: 1, delaySeconds: 8 });
  await waitForActiveWorkerCount(1);

  // These are two cryptographically separate visitor identities. Neither test
  // session is the browser session currently open in the user's frontend.
  ownerSession = await createSession();
  const otherSession = await createSession();

  // Only ownerSession uploads the object and creates this database job.
  const createdJob = await submitTestJob(ownerSession, 1);
  jobId = createdJob.id;
  console.log(`Created private WebSocket verification job ${jobId}.`);

  // Connect with the unrelated session first and attempt to watch the owner's job.
  otherSocket = await connectJobWebSocket(otherSession);
  const deniedSubscriptionStart = otherSocket.subscribe(jobId);
  const deniedMessage = await otherSocket.waitForMessage(
    (message) => message.type === "error",
    "an ownership rejection",
    { startIndex: deniedSubscriptionStart },
  );

  // The backend deliberately uses the same response for missing and unowned jobs.
  // This prevents a guessed UUID from revealing whether another user's job exists.
  if (deniedMessage.error !== "Job not found") {
    throw new Error(
      `Unexpected unauthorized-subscription response: ${deniedMessage.error}`,
    );
  }

  // A security failure must never be followed by a subscription or private job data.
  const messagesAfterDeniedSubscription = otherSocket.messages.slice(
    deniedSubscriptionStart,
  );
  const privateMessageWasLeaked = messagesAfterDeniedSubscription.some(
    (message) =>
      message.type === "subscribed" || message.type === "job_update",
  );

  if (privateMessageWasLeaked) {
    throw new Error("An unrelated session received private job information");
  }

  otherSocket.close();
  otherSocket = null;

  // Repeat the subscription with the session that actually owns the job.
  ownerSocket = await connectJobWebSocket(ownerSession);
  const ownerSubscriptionStart = ownerSocket.subscribe(jobId);
  await ownerSocket.waitForMessage(
    (message) => message.type === "subscribed" && message.jobId === jobId,
    "the owner's subscription confirmation",
    { startIndex: ownerSubscriptionStart },
  );

  // Wait for the terminal update. Intermediate updates continue accumulating in
  // ownerSocket.messages while this Promise sleeps.
  const completionMessage = await ownerSocket.waitForMessage(
    (message) =>
      message.type === "job_update" &&
      message.job.id === jobId &&
      message.job.status === "COMPLETED",
    "the completed job update",
    {
      startIndex: ownerSubscriptionStart,
      timeoutMilliseconds: 60_000,
    },
  );

  const jobUpdates = ownerSocket.messages
    .slice(ownerSubscriptionStart)
    .filter(
      (message) =>
        message.type === "job_update" && message.job.id === jobId,
    );
  const observedProgressValues = [
    ...new Set(jobUpdates.map((message) => message.job.progress)),
  ];

  // Completion alone could have come from the initial database snapshot. Seeing
  // an earlier value and 100 proves that state changed while the socket remained
  // subscribed and that Kafka-driven notifications reached the backend.
  const observedActiveProgress = observedProgressValues.some(
    (progress) => progress < 100,
  );

  if (!observedActiveProgress || completionMessage.job.progress !== 100) {
    throw new Error(
      `Expected changing progress ending at 100; observed ${observedProgressValues.join(", ")}`,
    );
  }

  // Request links only after the live completion message. This validates the
  // final part of the resume claim without printing temporary signed URLs.
  const downloadResponse = await fetchDownloadUrls(ownerSession, jobId);
  const downloadEntries = Object.entries(downloadResponse.downloadUrls || {});

  if (downloadEntries.length === 0) {
    throw new Error("Completed job returned no result download links");
  }

  if (
    downloadEntries.some(
      ([stemName, url]) => !stemName || typeof url !== "string" || !url.startsWith("http"),
    )
  ) {
    throw new Error("Completed job returned an invalid result download link");
  }

  console.log("\nWebSocket security and delivery report");
  console.log("Unrelated session rejected: yes");
  console.log("Owner subscription accepted: yes");
  console.log(`Distinct progress values received: ${observedProgressValues.length}`);
  console.log(`Final progress: ${completionMessage.job.progress}%`);
  console.log(`Temporary result links created: ${downloadEntries.length}`);
  console.log("Result: WebSocket verification passed");
} catch (error) {
  testFailure = error;
  console.error(`WebSocket verification failed: ${error.message}`);
} finally {
  // Close network clients before changing containers so normal shutdown is not
  // mistaken for a WebSocket failure by a still-running check.
  ownerSocket?.close();
  otherSocket?.close();

  if (ownerSession && jobId) {
    await cancelJobIfActive(ownerSession, jobId);
  }

  try {
    // Move private test objects to their cleanup deadline. The normal cleanup
    // service removes them instead of leaving verification files in MinIO.
    expireTestJobs(jobId ? [jobId] : []);
  } catch (error) {
    console.error(`Could not expire WebSocket-test storage: ${error.message}`);
  }

  try {
    // Return the developer environment to one real Demucs worker even when an
    // assertion failed halfway through this verification.
    restoreNormalWorker();
  } catch (error) {
    console.error(`Could not restore the normal worker: ${error.message}`);
    testFailure ||= error;
  }
}

if (testFailure) {
  throw testFailure;
}
