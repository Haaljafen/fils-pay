import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRateFils, subtractFils, toFils, type Fils } from "@filspay/money";
import { assertScenario, feeForAmount, replayFees, type CurrentRates } from "./feeReplay.js";

const f = (n: number) => toFils(n);

const today: CurrentRates = { mdrBps: 250, volumeTierBonusBps: 0, discountBps: 0 };

test("fee matches capture.ts: discount first, then MDR, one rounding each", () => {
  // 10.000 BD, 10% negotiated discount, 2.50% MDR:
  // discounted = 9.000 BD, fee = 2.50% of 9.000 BD = 225 fils.
  assert.equal(feeForAmount(f(10_000), 250, 0, 1000), 225);
});

test("volume-tier bonus reduces the MDR and never goes below zero", () => {
  assert.equal(feeForAmount(f(10_000), 250, 50, 0), 200);
  assert.equal(feeForAmount(f(10_000), 50, 100, 0), 0);
});

test("replay at today's rates with no change yields zero difference", () => {
  const amounts = [f(1_000), f(2_500), f(12_345)];
  const result = replayFees(amounts, today, { volumeChangePct: 0, mdrBps: 250, discountBps: 0 });
  assert.equal(result.netChangeFils, 0);
  assert.equal(result.netChangePerMonthFils, 0);
  assert.equal(result.current.transactionCount, 3);
  assert.equal(result.current.volumeFils, 1_000 + 2_500 + 12_345);
});

test("lower MDR means the merchant keeps more, reported per month", () => {
  const amounts = [f(100_000)]; // 100 BD over the 90-day window
  const result = replayFees(amounts, today, { volumeChangePct: 0, mdrBps: 200, discountBps: 0 });
  // 2.50% -> 2.00% on 100 BD = 500 fils more over 90 days.
  assert.equal(result.netChangeFils, 500);
  // 500 * 30 / 90 = 166.67 -> 167 fils per month.
  assert.equal(result.netChangePerMonthFils, 167);
});

test("a volume increase is scaled per transaction and raises volume and fees", () => {
  const amounts = [f(10_000)];
  const result = replayFees(amounts, today, { volumeChangePct: 50, mdrBps: 250, discountBps: 0 });
  assert.equal(result.scenario.volumeFils, applyRateFils(f(10_000), 15_000));
  assert.equal(result.scenario.feesFils, applyRateFils(f(15_000), 250));
});

test("net change is signed: a higher MDR shows a negative change", () => {
  const result = replayFees([f(100_000)], today, { volumeChangePct: 0, mdrBps: 300, discountBps: 0 });
  assert.equal(result.netChangeFils < 0, true);
  assert.equal(result.netChangePerMonthFils < 0, true);
});

test("no captured transactions gives zeros", () => {
  const result = replayFees([], today, { volumeChangePct: 10, mdrBps: 100, discountBps: 0 });
  assert.equal(result.current.volumeFils, 0);
  assert.equal(result.scenario.feesFils, 0);
  assert.equal(result.netChangeFils, 0);
});

test("scenario inputs outside the allowed ranges are rejected", () => {
  assert.throws(() => assertScenario({ volumeChangePct: 301, mdrBps: 250, discountBps: 0 }), RangeError);
  assert.throws(() => assertScenario({ volumeChangePct: -91, mdrBps: 250, discountBps: 0 }), RangeError);
  assert.throws(() => assertScenario({ volumeChangePct: 0, mdrBps: 1001, discountBps: 0 }), RangeError);
  assert.throws(() => assertScenario({ volumeChangePct: 0, mdrBps: 250.5, discountBps: 0 }), RangeError);
  assert.throws(() => assertScenario({ volumeChangePct: 0, mdrBps: 250, discountBps: 5001 }), RangeError);
});

test("the replay never produces a fractional fils value", () => {
  const amounts: Fils[] = [f(1), f(3), f(7), f(999), f(10_001)];
  const result = replayFees(amounts, today, { volumeChangePct: 17, mdrBps: 333, discountBps: 125 });
  for (const v of [result.netChangeFils, result.netChangePerMonthFils, result.scenario.feesFils]) {
    assert.equal(Number.isInteger(v), true);
  }
  assert.equal(subtractFils(result.scenario.netFils, result.current.netFils), result.netChangeFils);
});
