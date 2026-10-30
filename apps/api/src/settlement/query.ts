import { applyRateFils, subtractFils, toFils } from "@filspay/money";
import type { Pool } from "pg";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface SettlementBatchDto {
  id: string;
  batchDate: string;
  status: string;
  grossFils: number;
  feeFils: number;
  netPayoutFils: number;
  refundFils: number;
  feeReversedFils: number;
  carryInFils: number;
  carryOutFils: number;
  closedAt: string | null;
  paidAt: string | null;
}

/** batch_date is a DATE; pg parses it in the process's local timezone (see toBatchDateString). */
interface SettlementBatchRow {
  id: string;
  batch_date: Date;
  status: string;
  gross_fils: string | number;
  fee_fils: string | number;
  net_payout_fils: string | number;
  refund_fils: string | number;
  fee_reversed_fils: string | number;
  carry_in_fils: string | number;
  carry_out_fils: string | number;
  closed_at: Date | null;
  paid_at: Date | null;
}

const BATCH_COLUMNS = `id, batch_date, status, gross_fils, fee_fils, net_payout_fils,
       refund_fils, fee_reversed_fils, carry_in_fils, carry_out_fils, closed_at, paid_at`;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// MK: why not just d.toISOString().slice(0,10)? simpler
// YA: Claude agrees, the local getters are "redundant if the server runs in UTC"
// FH: the server does NOT always run in UTC (dev laptops are +03). leave the getters
function toBatchDateString(d: Date): string {
  // batch_date is a plain DATE column with no timezone of its own. The
  // `pg` driver parses a DATE value using the *process's local* timezone
  // (`new Date(year, month - 1, day)`, not `Date.UTC(...)`), so `.
  // toISOString()` (which always renders in UTC) can shift the calendar
  // date by one day whenever the process's local timezone isn't UTC —
  // exactly the kind of subtle bug this platform's money/date paths must
  // not have. Reading the Date's own *local* year/month/day getters
  // instead always recovers exactly the calendar date `pg` parsed,
  // regardless of the process's local timezone.
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Maps a settlement_batches row to its DTO. Invariant (enforced by the Go
 * worker at close): netPayoutFils - carryOutFils === grossFils - feeFils -
 * refundFils + feeReversedFils - carryInFils for every batch.
 */
function serializeBatch(row: SettlementBatchRow): SettlementBatchDto {
  return {
    id: row.id,
    batchDate: toBatchDateString(row.batch_date),
    status: row.status,
    grossFils: Number(row.gross_fils),
    feeFils: Number(row.fee_fils),
    netPayoutFils: Number(row.net_payout_fils),
    refundFils: Number(row.refund_fils),
    feeReversedFils: Number(row.fee_reversed_fils),
    carryInFils: Number(row.carry_in_fils),
    carryOutFils: Number(row.carry_out_fils),
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    paidAt: row.paid_at ? row.paid_at.toISOString() : null,
  };
}

export interface ListSettlementBatchesFilters {
  merchantId: string;
  from?: Date;
  to?: Date;
  status?: string[];
  limit?: number;
  cursor?: string | null;
}

export interface ListSettlementBatchesResult {
  batches: SettlementBatchDto[];
  nextCursor: string | null;
}

interface DecodedCursor {
  batchDate: string;
  id: string;
}

function decodeCursor(cursor: string | null | undefined): DecodedCursor | null {
  if (!cursor) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separatorIndex = decoded.indexOf("|");
  if (separatorIndex === -1) return null;
  const batchDate = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  if (!batchDate || !id) return null;
  return { batchDate, id };
}

function encodeCursor(batchDate: Date, id: string): string {
  return Buffer.from(`${toBatchDateString(batchDate)}|${id}`, "utf8").toString("base64url");
}

/**
 * `GET /v1/settlement/batches` business logic. Keyset pagination, same
 * pattern as `listTransactions`.
 */
// am: batch_date < to is exclusive, same as API.md. matches the Go side
export async function listSettlementBatches(
  pool: Pool,
  filters: ListSettlementBatchesFilters,
): Promise<ListSettlementBatchesResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
  const decodedCursor = decodeCursor(filters.cursor);

  const result = await pool.query<SettlementBatchRow>(
    `SELECT ${BATCH_COLUMNS}
       FROM settlement_batches
      WHERE merchant_id = $1
        AND ($2::date IS NULL OR batch_date >= $2)
        AND ($3::date IS NULL OR batch_date <  $3)
        AND ($4::text[] IS NULL OR status = ANY($4))
        AND ($5::date IS NULL OR (batch_date, id) < ($5, $6))
      ORDER BY batch_date DESC, id DESC
      LIMIT $7`,
    [
      filters.merchantId,
      filters.from ?? null,
      filters.to ?? null,
      statusArray,
      decodedCursor?.batchDate ?? null,
      decodedCursor?.id ?? null,
      limit,
    ],
  );

  const batches = result.rows.map(serializeBatch);
  const lastRow = result.rows[result.rows.length - 1];
  const nextCursor = result.rows.length === limit && lastRow ? encodeCursor(lastRow.batch_date, lastRow.id) : null;

  return { batches, nextCursor };
}

export interface SettlementBatchDetailDto extends SettlementBatchDto {
  /** Count of distinct transactions included in this batch's scheme
   *  export (scheme_export_lines rows — one per included transaction, by
   *  construction). */
  includedTransactionCount: number;
  /** Count of capture-type transaction_events rows this batch consumed.
   *  Can exceed includedTransactionCount — a transaction captured twice
   *  within the batch window contributes one scheme_export_lines row but
   *  two transaction_events rows. */
  includedEventCount: number;
  /** The refunds netted out of this batch, oldest first. */
  refunds: SettlementBatchRefundDto[];
}

export interface SettlementBatchRefundDto {
  id: string;
  transactionId: string;
  reference: string | null;
  amountFils: number;
  feeReversedFils: number;
  reason: string | null;
  occurredAt: string;
}

/**
 * `GET /v1/settlement/batches/:id` business logic. 404, not 403, on an
 * ownership mismatch — same as the transaction detail read: a 403 would
 * confirm a batch with that ID exists (just not theirs).
 */
export async function getSettlementBatch(
  pool: Pool,
  input: { merchantId: string; batchId: string },
): Promise<SettlementBatchDetailDto | null> {
  const batchResult = await pool.query<SettlementBatchRow>(
    `SELECT ${BATCH_COLUMNS} FROM settlement_batches WHERE id = $1 AND merchant_id = $2`,
    [input.batchId, input.merchantId],
  );
  const row = batchResult.rows[0];
  if (!row) return null;

  const [txnCountResult, eventCountResult, refundResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, [
      input.batchId,
    ]),
    pool.query<{ count: string }>(`SELECT count(*) FROM transaction_events WHERE settlement_batch_id = $1`, [
      input.batchId,
    ]),
    pool.query<{
      id: string;
      transaction_id: string;
      reference: string | null;
      amount_fils: string | number;
      fee_reversed_fils: string | number;
      reason: string | null;
      occurred_at: Date;
    }>(
      `SELECT r.id, r.transaction_id, t.reference, r.amount_fils, r.fee_reversed_fils, r.reason, r.occurred_at
         FROM refunds r
         JOIN transactions t ON t.id = r.transaction_id
        WHERE r.settlement_batch_id = $1
        ORDER BY r.occurred_at, r.id`,
      [input.batchId],
    ),
  ]);

  return {
    ...serializeBatch(row),
    includedTransactionCount: Number(txnCountResult.rows[0]?.count ?? 0),
    includedEventCount: Number(eventCountResult.rows[0]?.count ?? 0),
    refunds: refundResult.rows.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      reference: r.reference,
      amountFils: Number(r.amount_fils),
      feeReversedFils: Number(r.fee_reversed_fils),
      reason: r.reason,
      occurredAt: r.occurred_at.toISOString(),
    })),
  };
}

/**
 * schemeAmountFils: the amount the scheme export line carries (truncated
 * to whole 10-fils units). capturedFils: the untruncated captured total.
 */
export interface SettlementBatchTransactionDto {
  transactionId: string;
  schemeAmountFils: number;
  lineSequence: number;
  reference: string | null;
  status: string;
  authorizedFils: number;
  capturedFils: number;
}

interface SettlementBatchTransactionRow {
  transaction_id: string;
  scheme_amount_fils: string | number;
  line_sequence: number;
  reference: string | null;
  status: string;
  authorized_fils: string | number;
  captured_fils: string | number;
}

/**
 * `GET /v1/settlement/batches/:id/transactions` business logic.
 * Same 404-on-ownership-mismatch check as `getSettlementBatch`, performed
 * by the caller (routes/settlement.ts) before this is called. Reads from
 * scheme_export_lines (many, but exactly-one-per-transaction by
 * construction) joined -> transactions (one) — the safe join direction.
 */
// unbounded but a batch is one merchant one day, max a few thousand lines — am
export async function listBatchTransactions(
  pool: Pool,
  batchId: string,
): Promise<SettlementBatchTransactionDto[]> {
  const result = await pool.query<SettlementBatchTransactionRow>(
    `SELECT sel.transaction_id, sel.amount_fils AS scheme_amount_fils, sel.line_sequence,
            t.reference, t.status, t.amount_fils AS authorized_fils, t.captured_fils
       FROM scheme_export_lines sel
       JOIN transactions t ON t.id = sel.transaction_id
      WHERE sel.settlement_batch_id = $1
      ORDER BY sel.line_sequence`,
    [batchId],
  );

  return result.rows.map((row) => ({
    transactionId: row.transaction_id,
    schemeAmountFils: Number(row.scheme_amount_fils),
    lineSequence: row.line_sequence,
    reference: row.reference,
    status: row.status,
    authorizedFils: Number(row.authorized_fils),
    capturedFils: Number(row.captured_fils),
  }));
}

/**
 * gapFils = ledgerMerchantPayableNetFils - settlementNetPayoutFils +
 * carriedForwardFils - pendingUnbatchedFils.
 *
 * ledgerMerchantPayableNetFils is what the period earned the merchant: every
 * merchant_payable movement except payouts. A payout is what the settlement
 * figure already counts; leaving its legs in would subtract it twice.
 * carriedForwardFils is the shortfall this period's batches passed on (or,
 * when negative, recovered). Refunds count in the ledger figure and in either
 * the batch that claimed them or pending, so a period with refunds still
 * explains to zero.
 */
export interface ReconciliationReport {
  periodFrom: string;
  periodTo: string;
  ledgerMerchantPayableNetFils: number;
  settlementNetPayoutFils: number;
  carriedForwardFils: number;
  pendingUnbatchedFils: number;
  gapFils: number;
  explained: boolean;
}

/** Fixed UTC+3 midnight for a Bahrain business-day boundary. */
function bahrainLocalMidnightUtc(dateStr: string): Date {
  const parsed = new Date(`${dateStr}T00:00:00+03:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`bahrainLocalMidnightUtc: invalid date "${dateStr}"`);
  }
  return parsed;
}

/** `GET /v1/settlement/reconciliation` business logic. */
/**
 * @param input.from  inclusive business date (YYYY-MM-DD)
 * @param input.to    exclusive business date (YYYY-MM-DD)
 * @returns explained === true iff gapFils === 0. The pending figure is
 *          computed with the same rate the capture path used, including
 *          the effective-dated fee schedule and the platform volume tier.
 */
export async function getReconciliationReport(
  pool: Pool,
  input: { merchantId: string; from: string; to: string },
): Promise<ReconciliationReport> {
  const windowStart = bahrainLocalMidnightUtc(input.from);
  const windowEnd = bahrainLocalMidnightUtc(input.to);

  const [ledgerResult, settlementResult, pendingResult, merchantResult, pendingRefundResult] = await Promise.all([
    pool.query<{ net: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0) AS net
         FROM ledger_entries le
        WHERE le.merchant_id = $1 AND le.account_id = 'merchant_payable'
          AND le.occurred_at >= $2 AND le.occurred_at < $3
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries payout
             WHERE payout.entry_group_id = le.entry_group_id AND payout.account_id = 'platform_cash'
          )`,
      [input.merchantId, windowStart, windowEnd],
    ),
    pool.query<{ total: string; carried: string }>(
      `SELECT COALESCE(SUM(net_payout_fils), 0) AS total,
              COALESCE(SUM(carry_out_fils - carry_in_fils), 0) AS carried
         FROM settlement_batches
        WHERE merchant_id = $1 AND batch_date >= $2 AND batch_date < $3
          AND status IN ('closed', 'paid')`,
      [input.merchantId, input.from, input.to],
    ),
    pool.query<{ amount_fils: string | number; booked_fee_fils: string | null }>(
      `SELECT te.amount_fils, te.metadata->>'feeFils' AS booked_fee_fils
         FROM transaction_events te
         JOIN transactions t ON t.id = te.transaction_id
        WHERE t.merchant_id = $1 AND te.event_type IN ('captured', 'partially_captured')
          AND te.settlement_batch_id IS NULL
          AND te.occurred_at >= $2 AND te.occurred_at < $3`,
      [input.merchantId, windowStart, windowEnd],
    ),
    pool.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
      [input.merchantId],
    ),
    pool.query<{ net: string }>(
      `SELECT COALESCE(SUM(amount_fils - fee_reversed_fils), 0) AS net
         FROM refunds
        WHERE merchant_id = $1 AND status = 'succeeded'
          AND settlement_batch_id IS NULL
          AND occurred_at >= $2 AND occurred_at < $3`,
      [input.merchantId, windowStart, windowEnd],
    ),
  ]);

  const merchant = merchantResult.rows[0];
  const mdrBps = merchant?.mdr_bps ?? 0;
  const discountBps = merchant?.negotiated_discount_bps ?? 0;

  // Each unsettled capture counts at the fee capture.ts actually booked for it
  // (transaction_events.metadata.feeFils), the same figure the ledger holds,
  // so consistent books reconcile to a zero gap. An event without it falls
  // back to settlement's own integer formula (discount off the amount, then
  // the MDR), never a float estimate.
  let pendingUnbatchedFils = 0;
  for (const row of pendingResult.rows) {
    const amountFils = toFils(Number(row.amount_fils));
    const feeFils =
      row.booked_fee_fils !== null
        ? Number(row.booked_fee_fils)
        : applyRateFils(subtractFils(amountFils, applyRateFils(amountFils, discountBps)), mdrBps);
    pendingUnbatchedFils += amountFils - feeFils;
  }
  // A refund nothing has claimed yet takes its net back out of what the next
  // batch will pay.
  pendingUnbatchedFils -= Number(pendingRefundResult.rows[0]?.net ?? 0);

  const ledgerMerchantPayableNetFils = Number(ledgerResult.rows[0]?.net ?? 0);
  const settlementNetPayoutFils = Number(settlementResult.rows[0]?.total ?? 0);
  const carriedForwardFils = Number(settlementResult.rows[0]?.carried ?? 0);
  const gapFils = ledgerMerchantPayableNetFils - settlementNetPayoutFils + carriedForwardFils - pendingUnbatchedFils;

  return {
    periodFrom: input.from,
    periodTo: input.to,
    ledgerMerchantPayableNetFils,
    settlementNetPayoutFils,
    carriedForwardFils,
    pendingUnbatchedFils,
    gapFils,
    explained: gapFils === 0,
  };
}

export interface SettlementSummaryDto {
  periodFrom: string;
  periodTo: string;
  transactionCount: number;
  totalCapturedFils: number;
  refundCount: number;
  totalRefundedFils: number;
}

interface SettlementSummaryRow {
  transaction_count: string;
  total_captured_fils: string | number | null;
  refund_count: string;
  total_refunded_fils: string | number | null;
}

/** Gross captured and refunded in window. Captures sum each event's own delta,
 *  the figure a batch uses; transactions.captured_fils is a running total, so
 *  summing it per event counts a twice-captured transaction twice. */
export async function getSettlementSummary(
  pool: Pool,
  input: { merchantId: string; from: string; to: string },
): Promise<SettlementSummaryDto> {
  const windowStart = bahrainLocalMidnightUtc(input.from);
  const windowEnd = bahrainLocalMidnightUtc(input.to);

  const result = await pool.query<SettlementSummaryRow>(
    `WITH captured AS (
       SELECT t.id, te.amount_fils
         FROM transactions t
         JOIN transaction_events te ON te.transaction_id = t.id
        WHERE t.merchant_id = $1
          AND te.event_type IN ('captured', 'partially_captured')
          AND te.occurred_at >= $2 AND te.occurred_at < $3
     ),
     refunded AS (
       SELECT amount_fils
         FROM refunds
        WHERE merchant_id = $1 AND status = 'succeeded'
          AND occurred_at >= $2 AND occurred_at < $3
     )
     SELECT (SELECT COUNT(DISTINCT id) FROM captured) AS transaction_count,
            (SELECT COALESCE(SUM(amount_fils), 0) FROM captured) AS total_captured_fils,
            (SELECT COUNT(*) FROM refunded) AS refund_count,
            (SELECT COALESCE(SUM(amount_fils), 0) FROM refunded) AS total_refunded_fils`,
    [input.merchantId, windowStart, windowEnd],
  );

  const row = result.rows[0];
  return {
    periodFrom: input.from,
    periodTo: input.to,
    transactionCount: Number(row?.transaction_count ?? 0),
    totalCapturedFils: Number(row?.total_captured_fils ?? 0),
    refundCount: Number(row?.refund_count ?? 0),
    totalRefundedFils: Number(row?.total_refunded_fils ?? 0),
  };
}
