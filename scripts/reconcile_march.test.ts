import assert from "node:assert/strict";
import { test } from "node:test";
import { computeResidueFils, monthBounds } from "./reconcile_march.js";

test("computeResidueFils returns the amount lost to 2dp quantization", () => {
  assert.equal(computeResidueFils(4750), 0);
  assert.equal(computeResidueFils(4759), 9);
  assert.equal(computeResidueFils(10), 0);
  assert.equal(computeResidueFils(1), 1);
  assert.equal(computeResidueFils(0), 0);
});

test("monthBounds is the Asia/Bahrain business month, matching the daily batches", () => {
  const { start, end } = monthBounds(2026, 3);
  assert.equal(start.toISOString(), "2026-02-28T21:00:00.000Z"); // 1 March 00:00 Bahrain
  assert.equal(end.toISOString(), "2026-03-31T21:00:00.000Z"); // 1 April 00:00 Bahrain
  assert.equal((end.getTime() - start.getTime()) / 86_400_000, 31);
});
