import assert from "node:assert/strict";
import { test } from "node:test";
import { expiryReferenceTime } from "./pay.js";

// Tolerance for comparing a freshly-minted Date against the test's own
// `Date.now()` — generous enough not to flake on a loaded CI box.
const TOLERANCE_MS = 5_000;

test("expiryReferenceTime: no value -> the server's own clock", () => {
  const before = Date.now();
  const resolved = expiryReferenceTime();
  assert.ok(Math.abs(resolved.getTime() - before) < TOLERANCE_MS);
});

test("expiryReferenceTime: empty string -> the server's own clock", () => {
  const before = Date.now();
  const resolved = expiryReferenceTime("");
  assert.ok(Math.abs(resolved.getTime() - before) < TOLERANCE_MS);
});

const NOW = new Date("2026-03-14T09:35:00.000Z");

test("expiryReferenceTime: a submittedAt within the grace window is used as-is", () => {
  const iso = "2026-03-14T09:30:00.000Z"; // 5 minutes before NOW
  assert.equal(expiryReferenceTime(iso, NOW).toISOString(), iso);
});

test("expiryReferenceTime: a submittedAt older than the grace window is ignored", () => {
  assert.equal(expiryReferenceTime("2026-03-14T09:29:59.999Z", NOW).toISOString(), NOW.toISOString());
  assert.equal(expiryReferenceTime("2025-01-01T00:00:00.000Z", NOW).toISOString(), NOW.toISOString());
});

test("expiryReferenceTime: a submittedAt in the future is ignored", () => {
  assert.equal(expiryReferenceTime("2026-03-14T10:00:00.000Z", NOW).toISOString(), NOW.toISOString());
});

test("expiryReferenceTime: an unparseable value -> the server's own clock", () => {
  const before = Date.now();
  const resolved = expiryReferenceTime("not-a-timestamp");
  assert.ok(!Number.isNaN(resolved.getTime()));
  assert.ok(Math.abs(resolved.getTime() - before) < TOLERANCE_MS);
});
