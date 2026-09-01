/* Refuse to begin a disruptive local drill while genuine work is waiting. */
import { compose } from "./commands.mjs";
import { queryDatabase } from "./docker.mjs";

function readKafkaJobLag() {
  const output = compose([
    "exec",
    "-T",
    "kafka",
    "/opt/kafka/bin/kafka-consumer-groups.sh",
    "--bootstrap-server",
    "kafka:29092",
    "--describe",
    "--group",
    "audio-worker",
  ]);

  let totalLag = 0;

  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);

    // Data rows have group in column 0, topic in 1, and numeric lag in 5.
    if (columns[0] === "audio-worker" && columns[1] === "audio.jobs.created") {
      const lag = Number(columns[5]);

      if (Number.isFinite(lag)) {
        totalLag += lag;
      }
    }
  }

  return totalLag;
}

export function assertProcessingEnvironmentIsIdle() {
  const activeJobs = Number(
    queryDatabase(
      `SELECT COUNT(*) FROM jobs
       WHERE status IN ('PROCESSING', 'RETRYING');`,
    ),
  );
  const busyWorkers = Number(
    queryDatabase(
      `SELECT COUNT(*) FROM worker_instances WHERE status = 'BUSY';`,
    ),
  );
  const pendingJobEvents = Number(
    queryDatabase(
      `SELECT COUNT(*) FROM outbox_events
       WHERE status = 'PENDING' AND topic = 'audio.jobs.created';`,
    ),
  );
  const kafkaLag = readKafkaJobLag();

  if (activeJobs || busyWorkers || pendingJobEvents || kafkaLag) {
    throw new Error(
      "Integration verification requires an idle system. " +
        `Active jobs: ${activeJobs}; busy workers: ${busyWorkers}; ` +
        `pending job events: ${pendingJobEvents}; Kafka lag: ${kafkaLag}.`,
    );
  }

  console.log("Safety check passed: no genuine processing work is waiting.");
}
