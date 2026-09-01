/* Use the same public HTTP workflow as the browser without frontend UI code. */
import { randomUUID } from "node:crypto";

const defaultApiBaseUrl = "http://localhost:4000";
const defaultOrigin = "http://localhost:5173";
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function sleep(milliseconds) {
  // setTimeout uses a callback. Promise converts it into an operation callers
  // can await between status requests without blocking the Node process.
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readResponseJson(response, operation) {
  // Read text first because an unsuccessful proxy response might contain HTML
  // instead of JSON. The original text remains available for a useful error.
  const responseText = await response.text();
  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const serverMessage =
      typeof data.error === "string" ? data.error : responseText.trim();
    throw new Error(
      `${operation} failed with HTTP ${response.status}: ` +
        (serverMessage || "No response message"),
    );
  }

  return data;
}

function apiHeaders(sessionCookie, includeJson = false) {
  // Origin exercises the same backend origin policy used by the real frontend.
  const headers = { Origin: defaultOrigin };

  if (sessionCookie) {
    // Node does not retain cookies automatically, so send the signed cookie that
    // createSession extracted from the backend's Set-Cookie response.
    headers.Cookie = sessionCookie;
  }

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

export async function createSession(apiBaseUrl = defaultApiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/api/session`, {
    method: "POST",
    headers: apiHeaders(),
  });

  await readResponseJson(response, "Session creation");

  // A Cookie request header contains only name=value. Attributes such as
  // HttpOnly, SameSite, and Path belong to Set-Cookie and are removed here.
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.split(";", 1)[0];

  if (!sessionCookie) {
    throw new Error("Session creation did not return a signed cookie");
  }

  return { apiBaseUrl, sessionCookie };
}

function createSmallAudioObject(index) {
  // Mock workers never decode the file, but this still uses an allowed MP3 name
  // and MIME type. A unique body prevents storage tools from treating uploads as
  // identical while remaining only a few bytes in size.
  return Buffer.from(
    `ID3\nDistributed integration test ${index}\n${randomUUID()}\n`,
    "utf8",
  );
}

export async function submitTestJob(session, index) {
  const fileName = `distributed-test-${Date.now()}-${index}.mp3`;
  const contentType = "audio/mpeg";
  const audioBytes = createSmallAudioObject(index);

  // Ask Express for temporary direct-to-storage upload permission. Only file
  // metadata crosses the backend in this request.
  const presignResponse = await fetch(
    `${session.apiBaseUrl}/api/uploads/presign`,
    {
      method: "POST",
      headers: apiHeaders(session.sessionCookie, true),
      body: JSON.stringify({
        fileName,
        contentType,
        fileSize: audioBytes.length,
      }),
    },
  );
  const permission = await readResponseJson(
    presignResponse,
    "Presigned upload permission",
  );

  // Send bytes directly to MinIO through the signed URL. The URL is deliberately
  // never printed because it grants temporary write authorization.
  const uploadResponse = await fetch(permission.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: audioBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Direct storage upload failed with HTTP ${uploadResponse.status}`);
  }

  // The small control request references the already uploaded private object.
  const jobResponse = await fetch(`${session.apiBaseUrl}/api/jobs`, {
    method: "POST",
    headers: apiHeaders(session.sessionCookie, true),
    body: JSON.stringify({
      originalFileName: fileName,
      inputObjectKey: permission.objectKey,
    }),
  });

  return readResponseJson(jobResponse, "Job creation");
}

export async function submitTestJobs(session, count) {
  // Promise.all starts independent upload workflows concurrently, resembling
  // several users submitting files rather than one serial test loop.
  return Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      submitTestJob(session, index + 1),
    ),
  );
}

export async function fetchJob(session, jobId) {
  const response = await fetch(`${session.apiBaseUrl}/api/jobs/${jobId}`, {
    headers: apiHeaders(session.sessionCookie),
  });
  return readResponseJson(response, `Job ${jobId} lookup`);
}

export async function waitForJobs(
  session,
  jobIds,
  { timeoutMilliseconds = 180_000, pollMilliseconds = 500 } = {},
) {
  const deadline = Date.now() + timeoutMilliseconds;
  const finalJobs = new Map();
  const previousStatuses = new Map();

  while (finalJobs.size < jobIds.length && Date.now() < deadline) {
    const unfinishedIds = jobIds.filter((jobId) => !finalJobs.has(jobId));
    const snapshots = await Promise.all(
      unfinishedIds.map((jobId) => fetchJob(session, jobId)),
    );

    for (const job of snapshots) {
      if (previousStatuses.get(job.id) !== job.status) {
        // Status transitions are safe to print; filenames and object keys are not.
        console.log(`Job ${job.id}: ${job.status} (${job.progress}%)`);
        previousStatuses.set(job.id, job.status);
      }

      if (terminalStatuses.has(job.status)) {
        finalJobs.set(job.id, job);
      }
    }

    if (finalJobs.size < jobIds.length) {
      await sleep(pollMilliseconds);
    }
  }

  if (finalJobs.size !== jobIds.length) {
    const unfinishedIds = jobIds.filter((jobId) => !finalJobs.has(jobId));
    throw new Error(`Timed out waiting for jobs: ${unfinishedIds.join(", ")}`);
  }

  return jobIds.map((jobId) => finalJobs.get(jobId));
}

export async function cancelJobIfActive(session, jobId) {
  try {
    const job = await fetchJob(session, jobId);

    if (terminalStatuses.has(job.status)) {
      return;
    }

    const response = await fetch(
      `${session.apiBaseUrl}/api/jobs/${jobId}/cancel`,
      {
        method: "POST",
        headers: apiHeaders(session.sessionCookie),
      },
    );

    // A 409 means the job became terminal between lookup and cancellation.
    if (!response.ok && response.status !== 409) {
      await readResponseJson(response, `Job ${jobId} cancellation`);
    }
  } catch (error) {
    // Cleanup is best-effort and must not hide the integration test's real error.
    console.error(`Could not cancel test job ${jobId}: ${error.message}`);
  }
}
