/* Check filename-extension policy independently from S3 network validation. */
import assert from "node:assert/strict";
import test from "node:test";
import { hasAllowedAudioExtension } from "../src/config/upload.js";

test("supported audio extensions are accepted without case sensitivity", () => {
  assert.equal(hasAllowedAudioExtension("mix.MP3"), true);
  assert.equal(hasAllowedAudioExtension("orchestra.FlAc"), true);
});

test("unsupported and extensionless filenames are rejected", () => {
  assert.equal(hasAllowedAudioExtension("notes.txt"), false);
  assert.equal(hasAllowedAudioExtension("recording"), false);
});

