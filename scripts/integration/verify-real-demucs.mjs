/* Run one valid audio file through the complete real Demucs worker pipeline. */
import {
  cancelJobIfActive,
  createSession,
  fetchDownloadUrls,
  submitAudioBytes,
} from "./client.mjs";
import {
  expireTestJobs,
  restoreNormalWorker,
  waitForActiveWorkerCount,
} from "./docker.mjs";
import { assertProcessingEnvironmentIsIdle } from "./safety.mjs";
import { connectJobWebSocket } from "./websocket-client.mjs";

// htdemucs_6s is expected to produce exactly these six named source estimates.
const expectedStemNames = [
  "vocals",
  "piano",
  "guitar",
  "drums",
  "bass",
  "other",
];

function createSyntheticWav({ durationSeconds = 3, sampleRate = 44_100 } = {}) {
  // PCM stores one signed 16-bit integer for each channel at every sample time.
  const channelCount = 2;
  const bytesPerSample = 2;
  const frameCount = durationSeconds * sampleRate;
  const dataByteLength = frameCount * channelCount * bytesPerSample;
  // A standard uncompressed WAV header occupies 44 bytes before sample data.
  const wav = Buffer.alloc(44 + dataByteLength);

  // RIFF is the outer file container. Integers use little-endian byte order,
  // which is the ordinary representation for PCM WAV files.
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataByteLength, 4);
  wav.write("WAVE", 8, "ascii");

  // The fmt chunk describes stereo, 44.1 kHz, signed 16-bit PCM samples.
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channelCount, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  wav.writeUInt16LE(channelCount * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);

  // The data chunk contains the actual left/right waveform values.
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataByteLength, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    // Different frequency mixtures in the two channels create a valid, nonzero
    // signal without downloading or committing copyrighted music.
    const left =
      Math.sin(2 * Math.PI * 220 * time) * 0.2 +
      Math.sin(2 * Math.PI * 440 * time) * 0.1;
    const right =
      Math.sin(2 * Math.PI * 330 * time) * 0.2 +
      Math.sin(2 * Math.PI * 660 * time) * 0.1;
    const frameOffset = 44 + frame * channelCount * bytesPerSample;

    // Multiplying by 32767 converts the -1..1 signal range into signed PCM16.
    wav.writeInt16LE(Math.round(left * 32_767), frameOffset);
    wav.writeInt16LE(
      Math.round(right * 32_767),
      frameOffset + bytesPerSample,
    );
  }

  return wav;
}

function assertWavFile(stemName, bytes) {
  // Forty-four bytes is the minimum ordinary PCM header size. Demucs output is
  // much larger, but this boundary gives a clear structural failure message.
  if (bytes.length <= 44) {
    throw new Error(`${stemName} result is empty or missing WAV sample data`);
  }

  // RIFF and WAVE are fixed ASCII signatures at offsets 0 and 8.
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`${stemName} result does not have a valid WAV signature`);
  }
}

let session;
let jobId;
let jobSocket;
let testFailure;

try {
  // Replacing a worker is disruptive, so stop before touching containers if a
  // genuine job or unconsumed Kafka message is present.
  assertProcessingEnvironmentIsIdle();

  // Explicitly restore the normal worker configuration so a previous mock test
  // or shell environment variable cannot accidentally bypass the AI model.
  restoreNormalWorker();
  await waitForActiveWorkerCount(1);

  session = await createSession();
  const audioBytes = createSyntheticWav();
  const createdJob = await submitAudioBytes(session, {
    fileName: `real-demucs-test-${Date.now()}.wav`,
    contentType: "audio/wav",
    audioBytes,
  });
  jobId = createdJob.id;
  console.log(`Created real Demucs verification job ${jobId}.`);

  /*
   * A long CPU inference should not send one HTTP request every second. Keep one
   * WebSocket open and let the backend push changes only when the job advances.
   * This follows the real frontend behavior and avoids consuming the API rate
   * limit while Demucs is calculating.
   */
  jobSocket = await connectJobWebSocket(session);
  const subscriptionStart = jobSocket.subscribe(jobId);
  await jobSocket.waitForMessage(
    (message) => message.type === "subscribed" && message.jobId === jobId,
    "the real Demucs job subscription",
    { startIndex: subscriptionStart },
  );

  // CPU inference can be slow on Docker for Apple Silicon. Fifteen minutes is a
  // failure boundary, not an expected duration for this three-second input.
  const completionMessage = await jobSocket.waitForMessage(
    (message) =>
      message.type === "job_update" &&
      message.job.id === jobId &&
      ["COMPLETED", "FAILED", "CANCELLED"].includes(message.job.status),
    "a terminal real Demucs job update",
    {
      startIndex: subscriptionStart,
      timeoutMilliseconds: 15 * 60 * 1000,
    },
  );
  const completedJob = completionMessage.job;

  if (completedJob.status !== "COMPLETED") {
    throw new Error(
      `Real Demucs job ended as ${completedJob.status}: ` +
        (completedJob.error_message || "no worker error was reported"),
    );
  }

  const resultNames = Object.keys(completedJob.result_object_keys || {});
  const missingStemNames = expectedStemNames.filter(
    (stemName) => !resultNames.includes(stemName),
  );

  if (missingStemNames.length > 0) {
    throw new Error(`Demucs did not produce: ${missingStemNames.join(", ")}`);
  }

  const downloadResponse = await fetchDownloadUrls(session, jobId);

  // Download each private result through the same temporary URLs used by the
  // frontend's embedded audio controls. Promise.all performs independent reads
  // concurrently and waits until every stem has been checked.
  await Promise.all(
    expectedStemNames.map(async (stemName) => {
      const url = downloadResponse.downloadUrls?.[stemName];

      if (!url) {
        throw new Error(`No temporary download URL was returned for ${stemName}`);
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `${stemName} download failed with HTTP ${response.status}`,
        );
      }

      assertWavFile(stemName, Buffer.from(await response.arrayBuffer()));
    }),
  );

  console.log("\nReal Demucs report");
  console.log(`Input bytes uploaded directly: ${audioBytes.length}`);
  console.log(`Expected stems produced: ${expectedStemNames.length}`);
  console.log(`Valid WAV results downloaded: ${expectedStemNames.length}`);
  console.log("Result: real Demucs end-to-end verification passed");
} catch (error) {
  testFailure = error;
  console.error(`Real Demucs verification failed: ${error.message}`);
} finally {
  // Close the realtime client before changing or expiring its selected job.
  jobSocket?.close();

  if (session && jobId) {
    // A failed or timed-out check should not leave expensive processing active.
    await cancelJobIfActive(session, jobId);
  }

  try {
    // Make the generated source and result files eligible for normal cleanup.
    expireTestJobs(jobId ? [jobId] : []);
  } catch (error) {
    console.error(`Could not expire real-Demucs test storage: ${error.message}`);
  }
}

if (testFailure) {
  throw testFailure;
}
