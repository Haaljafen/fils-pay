import { request } from "./client.js";
import { buildQuery } from "./query.js";

/** Read-only "What if?" fee simulator. Replays the merchant's own captured
 *  transactions from the last 90 days; nothing here changes a fee or payout. */

export interface FeeSimulationSummary {
  transactionCount: number;
  volumeFils: number;
  feesFils: number;
  netFils: number;
}

export interface FeeSimulation {
  windowDays: number;
  currentMdrBps: number;
  discountBps: number;
  appliedScenario: { volumeChangePct: number; mdrBps: number; discountBps: number };
  current: FeeSimulationSummary;
  scenario: FeeSimulationSummary;
  netChangeFils: number;
  netChangePerMonthFils: number;
}

export interface FeeSimulationQuery {
  volumeChangePct?: number;
  mdrBps?: number;
  discountBps?: number;
}

export function simulateFees(query: FeeSimulationQuery = {}): Promise<FeeSimulation> {
  return request(`/v1/simulations/fees${buildQuery({ ...query })}`);
}
