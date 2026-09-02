/* Verify password and session-token security helpers without starting Express. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthenticationToken,
  hashAuthenticationToken,
} from "../src/auth/authToken.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

test("password hashes are salted and verify only the original password", async () => {
  const password = "a-correct-test-password";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  // A stored hash must not contain the original password and two equal passwords
  // must differ because each registration receives a new random salt.
  assert.equal(firstHash.includes(password), false);
  assert.notEqual(firstHash, secondHash);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword("a-different-password", firstHash), false);
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("any-password", "not-a-valid-hash"), false);
});

test("authentication tokens are random and stored as fixed fingerprints", () => {
  const firstToken = createAuthenticationToken();
  const secondToken = createAuthenticationToken();
  const firstFingerprint = hashAuthenticationToken(firstToken);

  assert.notEqual(firstToken, secondToken);
  assert.equal(firstFingerprint.length, 64);
  assert.match(firstFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(firstFingerprint, firstToken);
  assert.equal(hashAuthenticationToken(firstToken), firstFingerprint);
});
