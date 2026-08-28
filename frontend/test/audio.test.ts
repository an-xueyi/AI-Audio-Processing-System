/* Verify MIME-type selection used before requesting a presigned upload URL. */
import assert from "node:assert/strict";
import test from "node:test";
import { getAudioContentType } from "../src/utils/audio";

function createFileLike(name: string, type: string): File {
  // getAudioContentType reads only name and type, so a focused object is enough.
  // The cast avoids requiring browser File construction in Node's test process.
  return { name, type } as File;
}

test("the browser-provided MIME type takes priority", () => {
  const file = createFileLike("song.mp3", "audio/custom-browser-type");
  assert.equal(getAudioContentType(file), "audio/custom-browser-type");
});

test("an uppercase extension supplies a MIME type when the browser omits it", () => {
  const file = createFileLike("song.MP3", "");
  assert.equal(getAudioContentType(file), "audio/mpeg");
});

test("an unknown extension produces an empty type for caller validation", () => {
  const file = createFileLike("notes.txt", "");
  assert.equal(getAudioContentType(file), "");
});

