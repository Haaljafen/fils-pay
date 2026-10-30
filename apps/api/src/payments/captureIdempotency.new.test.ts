import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { toFils } from "@filspay/money";
import { captureRequestHash } from "./capture.js";

test("the same key reused on a different transaction is a hash mismatch, not a replay", () => {
  // claimIdempotencyKey scopes keys by (merchant, endpoint, key) and replays
  // the stored response when the hash matches. Two captures of different
  // transactions with identical bodies must therefore hash differently.
  const a = captureRequestHash({ transactionId: randomUUID() });
  const b = captureRequestHash({ transactionId: randomUUID() });
  assert.notEqual(a, b);
});

test("a genuine retry of the same capture hashes identically", () => {
  const transactionId = randomUUID();
  assert.equal(
    captureRequestHash({ transactionId, amountFils: toFils(4_750) }),
    captureRequestHash({ transactionId, amountFils: toFils(4_750) }),
  );
  assert.equal(captureRequestHash({ transactionId }), captureRequestHash({ transactionId }));
});

test("a different amount on the same transaction still conflicts", () => {
  const transactionId = randomUUID();
  assert.notEqual(
    captureRequestHash({ transactionId, amountFils: toFils(1_000) }),
    captureRequestHash({ transactionId, amountFils: toFils(2_000) }),
  );
});
