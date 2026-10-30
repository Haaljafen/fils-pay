import {
  addFils,
  applyRateFils,
  bankersRoundDiv,
  subtractFils,
  toFils,
  ZERO_FILS,
  type Fils,
} from "@filspay/money";

/**
 * Pure fee replay for the "What if?" simulator. No database, no clock.
 *
 * It takes the merchant's real captured amounts and runs them through the
 * same rules capture.ts applies (negotiated discount first, then the MDR
 * less any volume-tier bonus, one half-to-even rounding per step). Two
 * replays are produced: one at the rates in effect today, one at the
 * scenario's rates with the volume scaled. Nothing here writes anything.
 */

export const REPLAY_WINDOW_DAYS = 90;

export interface CurrentRates {
  mdrBps: number;
  volumeTierBonusBps: number;
  discountBps: number;
}

export interface Scenario {
  /** Whole percent change in captured volume, -90..300. */
  volumeChangePct: number;
  /** Proposed MDR in basis points, 0..1000 (10%). */
  mdrBps: number;
  /** Proposed negotiated discount in basis points, 0..5000. */
  discountBps: number;
}

export interface ReplaySummary {
  transactionCount: number;
  volumeFils: Fils;
  feesFils: Fils;
  /** Volume the merchant keeps after fees: volume minus fees. */
  netFils: Fils;
}

export interface SimulationResult {
  windowDays: number;
  current: ReplaySummary;
  scenario: ReplaySummary;
  /** scenario.net minus current.net, over the replay window. */
  netChangeFils: Fils;
  /** netChangeFils rescaled to a 30-day month, rounded half-to-even. */
  netChangePerMonthFils: Fils;
}

export function assertScenario(s: Scenario): void {
  const check = (name: string, value: number, min: number, max: number) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
    }
  };
  check("volumeChangePct", s.volumeChangePct, -90, 300);
  check("mdrBps", s.mdrBps, 0, 1000);
  check("discountBps", s.discountBps, 0, 5000);
}

/** Same fee rule as capture.ts: discount the amount, then apply the MDR. */
export function feeForAmount(amount: Fils, mdrBps: number, volumeTierBonusBps: number, discountBps: number): Fils {
  const discounted = subtractFils(amount, applyRateFils(amount, discountBps));
  return applyRateFils(discounted, Math.max(0, mdrBps - volumeTierBonusBps));
}

function summarise(amounts: Fils[], mdrBps: number, bonusBps: number, discountBps: number, volumePct: number): ReplaySummary {
  let volume = ZERO_FILS;
  let fees = ZERO_FILS;
  for (const amount of amounts) {
    // Scale by (100 + volumePct)%, rounded once per transaction.
    const scaled = volumePct === 0 ? amount : applyRateFils(amount, 10_000 + volumePct * 100);
    volume = addFils(volume, scaled);
    fees = addFils(fees, feeForAmount(scaled, mdrBps, bonusBps, discountBps));
  }
  return {
    transactionCount: amounts.length,
    volumeFils: volume,
    feesFils: fees,
    netFils: subtractFils(volume, fees),
  };
}

/**
 * Replays `capturedAmounts` (one entry per captured transaction, in fils)
 * under today's rates and under the scenario, and reports the difference
 * in what the merchant keeps.
 */
export function replayFees(capturedAmounts: Fils[], current: CurrentRates, scenario: Scenario): SimulationResult {
  assertScenario(scenario);

  const today = summarise(capturedAmounts, current.mdrBps, current.volumeTierBonusBps, current.discountBps, 0);
  const proposed = summarise(
    capturedAmounts,
    scenario.mdrBps,
    current.volumeTierBonusBps,
    scenario.discountBps,
    scenario.volumeChangePct,
  );

  const netChange = subtractFils(proposed.netFils, today.netFils);
  const sign = netChange < 0 ? -1 : 1;
  const magnitude = BigInt(Math.abs(netChange));
  const perMonth = sign * bankersRoundDiv(magnitude * 30n, BigInt(REPLAY_WINDOW_DAYS));

  return {
    windowDays: REPLAY_WINDOW_DAYS,
    current: today,
    scenario: proposed,
    netChangeFils: netChange,
    netChangePerMonthFils: toFils(perMonth, { allowNegative: true }),
  };
}
