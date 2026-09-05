/*
 * Build one Kafka connection policy for every KafkaJS client in the backend.
 *
 * Local Kafka uses an unencrypted connection on localhost or Docker's private
 * network. A hosted broker travels across a wider network and should use TLS,
 * usually together with a username and password supplied through SASL.
 */
import { readFileSync } from "node:fs";
import type { KafkaConfig, SASLOptions } from "kafkajs";
import { parseApplicationEnvironment } from "../config/environment.js";

type KafkaSecurityProtocol =
  | "PLAINTEXT"
  | "SSL"
  | "SASL_PLAINTEXT"
  | "SASL_SSL";

const supportedSecurityProtocols = new Set<KafkaSecurityProtocol>([
  "PLAINTEXT",
  "SSL",
  "SASL_PLAINTEXT",
  "SASL_SSL",
]);

/** Turn comma-separated broker text into KafkaJS's required string array. */
function parseBrokerList(environment: NodeJS.ProcessEnv): string[] {
  // KAFKA_BROKERS is preferred because managed Kafka normally provides several
  // bootstrap addresses. KAFKA_BROKER keeps old local .env files compatible.
  const brokerText =
    environment.KAFKA_BROKERS?.trim() ||
    environment.KAFKA_BROKER?.trim() ||
    "localhost:9092";
  const brokers = brokerText
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    throw new Error("KAFKA_BROKERS must contain at least one broker address");
  }

  return brokers;
}

/** Convert the environment spelling into one of Kafka's protocol names. */
function parseSecurityProtocol(
  environment: NodeJS.ProcessEnv,
): KafkaSecurityProtocol {
  const protocol = (
    environment.KAFKA_SECURITY_PROTOCOL?.trim() || "PLAINTEXT"
  ).toUpperCase();

  if (!supportedSecurityProtocols.has(protocol as KafkaSecurityProtocol)) {
    throw new Error(
      "KAFKA_SECURITY_PROTOCOL must be PLAINTEXT, SSL, " +
        "SASL_PLAINTEXT, or SASL_SSL",
    );
  }

  return protocol as KafkaSecurityProtocol;
}

/** Read and validate SASL credentials without ever writing them to logs. */
function readSaslConfiguration(
  environment: NodeJS.ProcessEnv,
): SASLOptions {
  const mechanism = environment.KAFKA_SASL_MECHANISM?.trim().toUpperCase();
  const username = environment.KAFKA_SASL_USERNAME?.trim();
  const password = environment.KAFKA_SASL_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required for SASL",
    );
  }

  // KafkaJS uses lowercase mechanism names even though broker documentation
  // commonly presents these same names in uppercase.
  if (mechanism === "PLAIN") {
    return { mechanism: "plain", username, password };
  }

  if (mechanism === "SCRAM-SHA-256") {
    return { mechanism: "scram-sha-256", username, password };
  }

  if (mechanism === "SCRAM-SHA-512") {
    return { mechanism: "scram-sha-512", username, password };
  }

  throw new Error(
    "KAFKA_SASL_MECHANISM must be PLAIN, SCRAM-SHA-256, or SCRAM-SHA-512",
  );
}

/** Create a complete KafkaJS client configuration for one named client. */
export function createKafkaClientConfiguration(
  clientId: string,
  environment: NodeJS.ProcessEnv = process.env,
): KafkaConfig {
  const applicationEnvironment = parseApplicationEnvironment(
    environment.APP_ENV,
  );
  const securityProtocol = parseSecurityProtocol(environment);
  const usesTls = securityProtocol === "SSL" || securityProtocol === "SASL_SSL";
  const usesSasl =
    securityProtocol === "SASL_SSL" ||
    securityProtocol === "SASL_PLAINTEXT";

  // Public production traffic must be encrypted. Authentication by itself does
  // not encrypt a SASL_PLAINTEXT connection, so that mode is rejected here too.
  if (applicationEnvironment === "production" && !usesTls) {
    throw new Error("Production Kafka connections must use SSL or SASL_SSL");
  }

  const configuration: KafkaConfig = {
    clientId,
    brokers: parseBrokerList(environment),
  };

  if (usesTls) {
    const certificatePath = environment.KAFKA_SSL_CA_PATH?.trim();

    // Most hosts use a certificate already trusted by the operating system. A
    // private certificate authority can instead be loaded from this optional
    // file path. The certificate contents never become part of browser code.
    configuration.ssl = certificatePath
      ? { ca: [readFileSync(certificatePath, "utf8")] }
      : true;
  }

  if (usesSasl) {
    configuration.sasl = readSaslConfiguration(environment);
  }

  return configuration;
}
