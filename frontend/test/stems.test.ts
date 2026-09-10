/* Verify that result stems remain complete, ordered, and human-readable. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatStemName, orderStemEntries } from "../src/utils/stems";

test("known Demucs stems use the requested musical order", () => {
  // Deliberately supply an unrelated object order to prove sorting is explicit.
  const entries = orderStemEntries({
    other: "other-url",
    bass: "bass-url",
    vocals: "vocals-url",
    drums: "drums-url",
    guitar: "guitar-url",
    piano: "piano-url",
  });

  assert.deepEqual(
    entries.map(([stemName]) => stemName),
    ["vocals", "piano", "guitar", "drums", "bass", "other"],
  );
});

test("unknown model stems remain visible after known stems", () => {
  const entries = orderStemEntries({
    strings: "strings-url",
    vocals: "vocals-url",
    accordion: "accordion-url",
  });

  assert.deepEqual(
    entries.map(([stemName]) => stemName),
    ["vocals", "accordion", "strings"],
  );
});

test("storage stem names become readable labels", () => {
  assert.equal(formatStemName("lead_vocals"), "Lead Vocals");
  assert.equal(formatStemName("electric-guitar"), "Electric Guitar");
});
