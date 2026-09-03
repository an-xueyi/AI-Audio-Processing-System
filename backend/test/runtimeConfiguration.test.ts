/* Verify provider-independent production security configuration. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseApplicationEnvironment,
  parseBooleanEnvironmentVariable,
} from "../src/config/environment.js";
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
