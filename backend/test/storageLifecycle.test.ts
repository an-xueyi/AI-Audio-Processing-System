/* Test the backend's result-expiration decision without using real storage. */
import assert from "node:assert/strict";
import test from "node:test";
import { hasStorageExpired } from "../src/services/storageLifecycle.js";

const fixedNow = new Date("2026-08-27T12:00:00.000Z");

test("storage remains available before its expiration deadline", () => {
  const hasExpired = hasStorageExpired(
    {
      storage_expires_at: new Date("2026-08-28T12:00:00.000Z"),
      storage_deleted_at: null,
    },
    fixedNow,
  );

  assert.equal(hasExpired, false);
});

test("storage expires exactly at its deadline", () => {
  const hasExpired = hasStorageExpired(
    {
      storage_expires_at: fixedNow,
      storage_deleted_at: null,
    },
    fixedNow,
  );

  assert.equal(hasExpired, true);
});

test("physical deletion is authoritative even before the deadline", () => {
  const hasExpired = hasStorageExpired(
    {
      storage_expires_at: new Date("2026-09-03T12:00:00.000Z"),
      storage_deleted_at: new Date("2026-08-27T11:00:00.000Z"),
    },
    fixedNow,
  );

  assert.equal(hasExpired, true);
});

test("a job without a storage deadline is not guessed expired", () => {
  const hasExpired = hasStorageExpired(
    { storage_expires_at: null, storage_deleted_at: null },
    fixedNow,
  );

  assert.equal(hasExpired, false);
});

