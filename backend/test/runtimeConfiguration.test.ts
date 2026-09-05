/* Verify provider-independent production security configuration. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseApplicationEnvironment,
  parseBooleanEnvironmentVariable,
  validateDatabaseUrl,
} from "../src/config/environment.js";
import { createKafkaClientConfiguration } from "../src/kafka/clientConfiguration.js";
import { readSecurityConfiguration } from "../src/config/security.js";

test("unknown application environments are rejected", () => {
  assert.throws(
    () => parseApplicationEnvironment("prod"),
    /development, test, or production/,
  );
});

test("boolean configuration rejects spelling mistakes", () => {
  assert.throws(
    () => parseBooleanEnvironmentVariable("COOKIE_SECURE", "yes", false),
    /true or false/,
  );
});

test("development keeps the local browser defaults", () => {
  const configuration = readSecurityConfiguration({
    APP_ENV: "development",
    COOKIE_SECURE: "false",
  });

  assert.equal(
    configuration.allowedOrigins.has("http://localhost:5173"),
    true,
  );
  assert.equal(configuration.sessionCookieSecure, false);
});

test("production requires an explicit HTTPS browser origin", () => {
  assert.throws(
    () =>
      readSecurityConfiguration({
        APP_ENV: "production",
        COOKIE_SECURE: "true",
      }),
    /CORS_ALLOWED_ORIGINS is required/,
  );

  assert.throws(
    () =>
      readSecurityConfiguration({
        APP_ENV: "production",
        COOKIE_SECURE: "true",
        CORS_ALLOWED_ORIGINS: "http://example.com",
      }),
    /must use HTTPS/,
  );
});

test("production requires Secure authentication cookies", () => {
  assert.throws(
    () =>
      readSecurityConfiguration({
        APP_ENV: "production",
        COOKIE_SECURE: "false",
        CORS_ALLOWED_ORIGINS: "https://audio.example.com",
      }),
    /COOKIE_SECURE must be true/,
  );
});

test("production accepts an explicit HTTPS origin and Secure cookie", () => {
  const configuration = readSecurityConfiguration({
    APP_ENV: "production",
    COOKIE_SECURE: "true",
    CORS_ALLOWED_ORIGINS: "https://audio.example.com/",
  });

  assert.deepEqual([...configuration.allowedOrigins], [
    "https://audio.example.com",
  ]);
  assert.equal(configuration.sessionCookieSecure, true);
});

test("production PostgreSQL requires an encrypted sslmode", () => {
  assert.throws(
    () =>
      validateDatabaseUrl(
        "DATABASE_URL",
        "postgresql://user:password@database.example.com/audio",
        "production",
      ),
    /sslmode=require/,
  );

  assert.doesNotThrow(() =>
    validateDatabaseUrl(
      "DATABASE_URL",
      "postgresql://user:password@database.example.com/audio?sslmode=require",
      "production",
    ),
  );
});

test("local Kafka keeps its plaintext broker default", () => {
  const configuration = createKafkaClientConfiguration("test-client", {
    APP_ENV: "development",
    KAFKA_BROKER: "localhost:9092",
  });

  assert.deepEqual(configuration.brokers, ["localhost:9092"]);
  assert.equal(configuration.ssl, undefined);
  assert.equal(configuration.sasl, undefined);
});

test("production Kafka requires TLS", () => {
  assert.throws(
    () =>
      createKafkaClientConfiguration("test-client", {
        APP_ENV: "production",
        KAFKA_BROKERS: "broker.example.com:9092",
        KAFKA_SECURITY_PROTOCOL: "PLAINTEXT",
      }),
    /must use SSL or SASL_SSL/,
  );
});

test("production Kafka accepts SASL over TLS", () => {
  const configuration = createKafkaClientConfiguration("test-client", {
    APP_ENV: "production",
    KAFKA_BROKERS: "one.example.com:9092,two.example.com:9092",
    KAFKA_SECURITY_PROTOCOL: "SASL_SSL",
    KAFKA_SASL_MECHANISM: "SCRAM-SHA-256",
    KAFKA_SASL_USERNAME: "worker-user",
    KAFKA_SASL_PASSWORD: "private-password",
  });

  assert.deepEqual(configuration.brokers, [
    "one.example.com:9092",
    "two.example.com:9092",
  ]);
  assert.equal(configuration.ssl, true);
  assert.deepEqual(configuration.sasl, {
    mechanism: "scram-sha-256",
    username: "worker-user",
    password: "private-password",
  });
});
