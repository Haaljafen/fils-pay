/**
 * The reconciliation report must not invent a gap when the books agree.
 * Requires DATABASE_URL (a local, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { refreshAnalyticsRollups } from "../admin/reportingRebuild.js";
import { getReconciliationReport, getSettlementBatch, getSettlementSummary, listSettlementBatches } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconciliation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => {
  await pool.end();
});

/** A captured, not-yet-settled payment exactly as capture.ts records it: the
 *  transaction, its capture event (with the fee it booked in metadata), and
 *  the gross and fee ledger legs. */
async function capturedUnsettled(merchantId: string, amountFils: number, bookedFeeFils: number): Promise<string> {
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', $2, $2, $3) RETURNING id`,
    [merchantId, amountFils, `acq_${randomUUID()}`],
  );
  const txnId = txn.rows[0]!.id;
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, metadata)
     VALUES ($1, 'captured', $2, 'system', $3)`,
    [txnId, amountFils, JSON.stringify({ feeFils: bookedFeeFils })],
  );
  const group = randomUUID();
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, now(), 'capture: gross'),
            ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: gross'),
            ($1, $2, $3, 'merchant_payable',     'debit',  $5, now(), 'capture: MDR fee'),
            ($1, $2, $3, 'platform_fee_revenue', 'credit', $5, now(), 'capture: MDR fee')`,
    [group, merchantId, txnId, amountFils, bookedFeeFils],
  );
  return txnId;
}

async function newMerchant(): Promise<string> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reconciliation Test ${randomUUID()}`],
  );
  return merchant.rows[0]!.id;
}

/** A succeeded refund exactly as processRefund.ts records it. */
async function refunded(merchantId: string, txnId: string, amountFils: number, feeReversedFils: number): Promise<string> {
  const refund = await pool.query<{ id: string }>(
    `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status, acquirer_reference, reason, created_by_type, created_by_id)
     VALUES ($1, $2, $3, $4, 'succeeded', $5, 'test', 'merchant_session', $6) RETURNING id`,
    [txnId, merchantId, amountFils, feeReversedFils, `acq_${randomUUID()}`, randomUUID()],
  );
  const group = randomUUID();
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, $3, 'merchant_payable',     'debit',  $4, now(), 'refund: gross'),
            ($1, $2, $3, 'card_scheme_clearing', 'credit', $4, now(), 'refund: gross'),
            ($1, $2, $3, 'platform_fee_revenue', 'debit',  $5, now(), 'refund: MDR fee reversal'),
            ($1, $2, $3, 'merchant_payable',     'credit', $5, now(), 'refund: MDR fee reversal')`,
    [group, merchantId, txnId, amountFils, feeReversedFils],
  );
  return refund.rows[0]!.id;
}

/** A closed batch holding everything so far unbatched, with the given frozen
 *  figures; `pay` also posts the payout legs CloseBatch's PayoutBatch posts. */
async function batched(
  merchantId: string,
  batchDate: string,
  figures: { gross: number; fee: number; net: number; refund?: number; feeReversed?: number; carryIn?: number; carryOut?: number },
  pay = false,
): Promise<string> {
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches
       (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, refund_fils, fee_reversed_fils, carry_in_fils, carry_out_fils, closed_at, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11) RETURNING id`,
    [
      merchantId,
      batchDate,
      pay ? "paid" : "closed",
      figures.gross,
      figures.fee,
      figures.net,
      figures.refund ?? 0,
      figures.feeReversed ?? 0,
      figures.carryIn ?? 0,
      figures.carryOut ?? 0,
      pay ? new Date() : null,
    ],
  );
  const batchId = batch.rows[0]!.id;
  await pool.query(
    `UPDATE transaction_events te SET settlement_batch_id = $2
       FROM transactions t
      WHERE t.id = te.transaction_id AND t.merchant_id = $1 AND te.settlement_batch_id IS NULL`,
    [merchantId, batchId],
  );
  await pool.query(`UPDATE refunds SET settlement_batch_id = $2 WHERE merchant_id = $1 AND settlement_batch_id IS NULL`, [
    merchantId,
    batchId,
  ]);
  if (pay && figures.net > 0) {
    await pool.query(
      `INSERT INTO ledger_entries (entry_group_id, merchant_id, settlement_batch_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES ($1, $2, $3, 'merchant_payable', 'debit',  $4, now(), 'settlement payout: batch paid'),
              ($1, $2, $3, 'platform_cash',    'credit', $4, now(), 'settlement payout: batch paid')`,
      [randomUUID(), merchantId, batchId, figures.net],
    );
  }
  return batchId;
}

const dayOffset = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("unsettled captures are counted at the fee actually booked, so consistent books show no gap", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reconciliation Test ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  // 2.50% of 4.740 BD is 118.5 fils; capture books 118 (half-to-even).
  await capturedUnsettled(merchantId, 4740, 118);

  const today = new Date();
  const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const report = await getReconciliationReport(pool, { merchantId, from: day(-1), to: day(2) });

  assert.equal(report.ledgerMerchantPayableNetFils, 4622);
  assert.equal(report.pendingUnbatchedFils, 4622);
  assert.equal(report.gapFils, 0);
  assert.equal(report.explained, true);
});

test("an unsettled refund comes off pending, so it does not read as an unexplained gap", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 10_000, 250);
  await refunded(merchantId, txnId, 2_000, 50);

  const report = await getReconciliationReport(pool, { merchantId, from: dayOffset(-1), to: dayOffset(2) });

  assert.equal(report.ledgerMerchantPayableNetFils, 7_800);
  assert.equal(report.pendingUnbatchedFils, 7_800, "9750 net captured less 1950 net refunded");
  assert.equal(report.gapFils, 0);
});

test("a refund already netted into a batch is not subtracted from pending as well", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 10_000, 250);
  await refunded(merchantId, txnId, 2_000, 50);
  await batched(merchantId, dayOffset(0), { gross: 10_000, fee: 250, net: 7_800, refund: 2_000, feeReversed: 50 });

  const report = await getReconciliationReport(pool, { merchantId, from: dayOffset(-1), to: dayOffset(2) });

  assert.equal(report.pendingUnbatchedFils, 0);
  assert.equal(report.settlementNetPayoutFils, 7_800);
  assert.equal(report.gapFils, 0);
});

test("a paid batch does not read as a gap: the payout's own ledger legs are not period activity", async () => {
  const merchantId = await newMerchant();
  await capturedUnsettled(merchantId, 10_000, 250);
  await batched(merchantId, dayOffset(0), { gross: 10_000, fee: 250, net: 9_750 }, true);

  // A multi-day window, as the page defaults to: it holds the payout legs too.
  const report = await getReconciliationReport(pool, { merchantId, from: dayOffset(-30), to: dayOffset(2) });

  assert.equal(report.settlementNetPayoutFils, 9_750);
  assert.equal(report.ledgerMerchantPayableNetFils, 9_750);
  assert.equal(report.gapFils, 0);
});

test("a shortfall carried to a later batch is shown and explained, in the batch that carries it and in the one that recovers it", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 10_000, 250);
  await batched(merchantId, dayOffset(-2), { gross: 10_000, fee: 250, net: 9_750 }, true);

  await refunded(merchantId, txnId, 10_000, 250);
  await batched(merchantId, dayOffset(-1), { gross: 0, fee: 0, net: 0, refund: 10_000, feeReversed: 250, carryOut: 9_750 }, true);

  const carrying = await getReconciliationReport(pool, { merchantId, from: dayOffset(-30), to: dayOffset(2) });
  assert.equal(carrying.carriedForwardFils, 9_750);
  assert.equal(carrying.gapFils, 0);

  await capturedUnsettled(merchantId, 20_000, 500);
  await batched(merchantId, dayOffset(0), { gross: 20_000, fee: 500, net: 9_750, carryIn: 9_750 }, true);

  const recovered = await getReconciliationReport(pool, { merchantId, from: dayOffset(-30), to: dayOffset(2) });
  assert.equal(recovered.carriedForwardFils, 0);
  assert.equal(recovered.settlementNetPayoutFils, 19_500);
  assert.equal(recovered.gapFils, 0);
});

test("the settlement report shows what a batch netted out, and which refunds", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 10_000, 250);
  const refundId = await refunded(merchantId, txnId, 2_000, 50);
  const batchId = await batched(merchantId, dayOffset(0), {
    gross: 10_000,
    fee: 250,
    net: 7_800,
    refund: 2_000,
    feeReversed: 50,
  });

  const { batches } = await listSettlementBatches(pool, { merchantId });
  assert.equal(batches[0]!.refundFils, 2_000);
  assert.equal(batches[0]!.feeReversedFils, 50);
  assert.equal(batches[0]!.carryInFils, 0);
  assert.equal(batches[0]!.carryOutFils, 0);

  const detail = await getSettlementBatch(pool, { merchantId, batchId });
  assert.deepEqual(
    detail!.refunds.map((r) => ({ id: r.id, transactionId: r.transactionId, amountFils: r.amountFils, feeReversedFils: r.feeReversedFils })),
    [{ id: refundId, transactionId: txnId, amountFils: 2_000, feeReversedFils: 50 }],
  );
});

test("the settlement summary counts a twice-captured transaction once and reports refunds", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 6_000, 150);
  // A second partial capture on the same order, as capture.ts records it: the
  // running total on the transaction moves, and a second event carries the delta.
  await pool.query(`UPDATE transactions SET amount_fils = 10000, captured_fils = 10000 WHERE id = $1`, [txnId]);
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, metadata)
     VALUES ($1, 'partially_captured', 4000, 'system', '{"feeFils": 100}')`,
    [txnId],
  );
  await refunded(merchantId, txnId, 2_000, 50);

  const summary = await getSettlementSummary(pool, { merchantId, from: dayOffset(-1), to: dayOffset(2) });

  assert.equal(summary.transactionCount, 1);
  assert.equal(summary.totalCapturedFils, 10_000, "the sum of what was captured, not the running total once per event");
  assert.equal(summary.refundCount, 1);
  assert.equal(summary.totalRefundedFils, 2_000);
});

test("rebuilding the analytics rollups keeps refund figures", async () => {
  const merchantId = await newMerchant();
  const txnId = await capturedUnsettled(merchantId, 10_000, 250);
  await refunded(merchantId, txnId, 2_000, 50);

  // TRUNCATE is transactional: rolling back leaves the rollups as they were.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await refreshAnalyticsRollups(client);
    const row = await client.query<{ refund_count: number; refund_gross_fils: string }>(
      `SELECT refund_count, refund_gross_fils FROM merchant_daily_volume WHERE merchant_id = $1`,
      [merchantId],
    );
    assert.equal(row.rows[0]?.refund_count, 1);
    assert.equal(Number(row.rows[0]?.refund_gross_fils), 2_000);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
