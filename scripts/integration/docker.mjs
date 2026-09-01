/* Operate the local Compose test environment and inspect durable test evidence. */
import { sleep } from "./client.mjs";
import { compose, runCommand } from "./commands.mjs";

export function startMockWorkers({
  count,
  delaySeconds,
  leaseSeconds = 300,
  jobHeartbeatSeconds = 30,
}) {
  console.log(`Starting ${count} mock workers...`);
  compose(
    ["up", "-d", "--build", "--scale", `worker=${count}`, "worker"],
    {
      capture: false,
      environment: {
        PROCESSING_MODE: "mock",
        MOCK_PROCESSING_DELAY_SECONDS: String(delaySeconds),
        JOB_LEASE_TIMEOUT_SECONDS: String(leaseSeconds),
        JOB_HEARTBEAT_INTERVAL_SECONDS: String(jobHeartbeatSeconds),
      },
    },
  );
}

export function restoreNormalWorker() {
  console.log("Restoring one normal Demucs worker...");

  /*
   * Production workers receive a one-hour graceful-stop window so Demucs can
   * finish safely. Temporary integration workers must not make test cleanup wait
   * that long. Their jobs have already been completed or cancelled, so remove
   * only worker-service containers directly and clear their presence rows.
   */
  const workerContainerIds = compose([
    "ps",
    "--all",
    "--quiet",
    "worker",
  ]).split("\n").filter(Boolean);

  if (workerContainerIds.length > 0) {
    runCommand(
      "docker",
      ["container", "rm", "--force", ...workerContainerIds],
      { capture: false },
    );
  }

  queryDatabase("DELETE FROM worker_instances;");

  compose(["up", "-d", "--scale", "worker=1", "worker"], {
    capture: false,
    // Explicit values override a caller's shell environment as well as the test.
    environment: {
      PROCESSING_MODE: "demucs",
      DEMUCS_MODEL: "htdemucs_6s",
      MOCK_PROCESSING_DELAY_SECONDS: "3.5",
      JOB_LEASE_TIMEOUT_SECONDS: "300",
      JOB_HEARTBEAT_INTERVAL_SECONDS: "30",
    },
  });
}

let postgresIdentity;

function getPostgresIdentity() {
  if (!postgresIdentity) {
    // User and database names are not passwords. Reading them from the container
    // avoids hard-coding local configuration in committed test scripts.
    postgresIdentity = {
      user: compose(["exec", "-T", "postgres", "printenv", "POSTGRES_USER"]),
      database: compose([
        "exec",
        "-T",
        "postgres",
        "printenv",
        "POSTGRES_DB",
      ]),
    };
  }

  return postgresIdentity;
}

export function queryDatabase(sql) {
  const identity = getPostgresIdentity();

  return compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username",
    identity.user,
    "--dbname",
    identity.database,
    "--tuples-only",
    "--no-align",
    "--field-separator",
    "|",
    "--command",
    sql,
  ]);
}

function quoteUuid(uuid) {
  // UUID validation makes later SQL interpolation a fixed safe character set.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error(`Invalid UUID received by integration tooling: ${uuid}`);
  }

  return `'${uuid}'::uuid`;
}

export async function waitForActiveWorkerCount(expected, timeoutMilliseconds = 60_000) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const count = Number(
      queryDatabase(
        `SELECT COUNT(*) FROM worker_instances
         WHERE last_heartbeat_at >= NOW() - (
           heartbeat_timeout_seconds * INTERVAL '1 second'
         );`,
      ),
    );

    if (count === expected) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`Did not observe ${expected} active workers before timeout`);
}

export function readWorkerEvents(jobIds) {
  const wantedJobs = new Set(jobIds);
  const output = compose(["logs", "--no-log-prefix", "worker"]);

  return output
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        // Dependency output may not be JSON. It is unrelated to our job events.
        return null;
      }
    })
    .filter((event) => event && wantedJobs.has(event.jobId));
}

export function readJobAttempts(jobIds) {
  const idList = jobIds.map(quoteUuid).join(", ");
  const output = queryDatabase(
    `SELECT id, processing_attempts
     FROM jobs
     WHERE id IN (${idList})
     ORDER BY id;`,
  );

  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [jobId, attempts] = line.split("|");
        return [jobId, Number(attempts)];
      }),
  );
}

export async function waitForBusyWorker(jobId, timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  const quotedJobId = quoteUuid(jobId);

  while (Date.now() < deadline) {
    // processing_attempts >= 1 proves begin_job_attempt ran. Killing before that
    // point would test message redelivery but not recovery of active processing.
    const workerId = queryDatabase(
      `SELECT worker_id
       FROM worker_instances
       WHERE status = 'BUSY'
         AND current_job_id = ${quotedJobId}
         AND EXISTS (
           SELECT 1 FROM jobs
           WHERE id = ${quotedJobId}
             AND processing_attempts >= 1
         )
       LIMIT 1;`,
    );

    if (workerId) {
      return workerId;
    }

    await sleep(250);
  }

  throw new Error(`No busy worker was found for job ${jobId}`);
}

export function forceRemoveWorker(workerId) {
  // workerId is the Docker hostname/container-ID prefix written by trusted code.
  if (!/^[0-9a-f]{12,64}$/i.test(workerId)) {
    throw new Error(`Refusing to remove unexpected worker ID: ${workerId}`);
  }

  runCommand("docker", ["container", "rm", "--force", workerId], {
    capture: false,
  });
}

export async function waitForReplacementWorker(
  jobId,
  removedWorkerId,
  timeoutMilliseconds = 150_000,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  const quotedJobId = quoteUuid(jobId);

  while (Date.now() < deadline) {
    const workerId = queryDatabase(
      `SELECT processing_worker_id
       FROM jobs
       WHERE id = ${quotedJobId};`,
    );

    if (workerId && workerId !== removedWorkerId) {
      return workerId;
    }

    await sleep(500);
  }

  throw new Error(`Job ${jobId} was not reclaimed before timeout`);
}

export function expireTestJobs(jobIds) {
  if (jobIds.length === 0) {
    return;
  }

  const idList = jobIds.map(quoteUuid).join(", ");
  queryDatabase(
    `UPDATE jobs
     SET storage_expires_at = NOW()
     WHERE id IN (${idList});`,
  );
}

export function removeWorkerRegistryRow(workerId) {
  if (!workerId) {
    return;
  }

  if (!/^[0-9a-f]{12,64}$/i.test(workerId)) {
    throw new Error(`Refusing to delete unexpected worker ID: ${workerId}`);
  }

  queryDatabase(
    `DELETE FROM worker_instances WHERE worker_id = '${workerId}';`,
  );
}
