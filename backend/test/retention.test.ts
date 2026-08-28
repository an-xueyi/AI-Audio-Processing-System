/* Verify strict parsing of lifecycle environment values. */
import assert from "node:assert/strict";
import test from "node:test";
import { parsePositiveInteger } from "../src/config/retention.js";

test("missing configuration uses the documented fallback", () => {
  assert.equal(parsePositiveInteger("TEST_VALUE", undefined, 168), 168);
});

test("positive integer text becomes a JavaScript number", () => {
  assert.equal(parsePositiveInteger("TEST_VALUE", "25", 1), 25);
});

for (const invalidValue of ["0", "-1", "1.5", "not-a-number"]) {
  test(`invalid configuration ${invalidValue} fails during startup`, () => {
    assert.throws(
      () => parsePositiveInteger("TEST_VALUE", invalidValue, 168),
      /TEST_VALUE must be a positive integer/,
    );
  });
}

