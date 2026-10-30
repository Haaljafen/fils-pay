/**
 * Unit tests for the inbound acquirer-callback signature verifier. Pure
 * function, no database — the route-level behavior it drives is covered in
 * routes/acquirerCallbacks.test.ts.
 *
 * The signature covers the exact bytes the acquirer sent. Re-serialising the
 * parsed body is not the same bytes: key order, whitespace and number
 * formatting can all differ, and a genuine callback would then be rejected.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyAcquirerCallbackSignature } from "./inboundVerify.js";

const SECRET = "acqsec_test_secret";
const NOW = 1_757_930_000;

/** Builds the header the acquirer would send for a raw body — the same
 *  `t=<seconds>,v1=<hex>` shape webhooks/sign.ts uses outbound. */
function acquirerHeader(rawBody: string, secret: string, timestamp = NOW): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("a correctly-signed callback verifies", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const result = verifyAcquirerCallbackSignature(raw, acquirerHeader(raw, SECRET), SECRET, { now: NOW });
  assert.deepEqual(result, { valid: true });
});

test("a genuine callback whose bytes differ from JSON.stringify of its parsed form still verifies", () => {
  // Extra spaces and a different key order: the acquirer signed exactly these bytes.
  const raw = '{ "outcome": "cleared",   "callbackId": "acqcb_1" }';
  const result = verifyAcquirerCallbackSignature(raw, acquirerHeader(raw, SECRET), SECRET, { now: NOW });
  assert.deepEqual(result, { valid: true });
});

test("a body altered after signing is rejected", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const tampered = JSON.stringify({ callbackId: "acqcb_1", outcome: "confirmed_fraud" });
  const result = verifyAcquirerCallbackSignature(tampered, acquirerHeader(raw, SECRET), SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a callback signed with a different secret is rejected (signature_mismatch)", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const result = verifyAcquirerCallbackSignature(raw, acquirerHeader(raw, "acqsec_someone_elses_secret"), SECRET, {
    now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a malformed header is rejected (malformed_header)", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1" });
  assert.equal(verifyAcquirerCallbackSignature(raw, "not-a-real-header", SECRET).reason, "malformed_header");
  assert.equal(verifyAcquirerCallbackSignature(raw, "t=abc,v1=deadbeef", SECRET).reason, "malformed_header");
  assert.equal(verifyAcquirerCallbackSignature(raw, "v1=deadbeef", SECRET).reason, "malformed_header");
});

test("an unsigned callback is rejected (missing_header)", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const result = verifyAcquirerCallbackSignature(raw, undefined, SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_header");
});

test("a correctly-signed but stale callback is rejected (timestamp_out_of_tolerance)", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const result = verifyAcquirerCallbackSignature(raw, acquirerHeader(raw, SECRET, NOW - 301), SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "timestamp_out_of_tolerance");
});

test("with no secret configured every callback is rejected, even one signed with the empty key", () => {
  const raw = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });
  const result = verifyAcquirerCallbackSignature(raw, acquirerHeader(raw, ""), "", { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "secret_not_configured");
});
