-- Exactly one payout instruction and one settlement.paid event per paid batch.
--
-- settlement_payout_disbursements was written by every settlement.paid
-- webhook delivery's pre-delivery effect: once per endpoint, again on a retry
-- after a crash, again if the event itself had been enqueued twice. Each row is
-- a payout-rail instruction, so a batch could be instructed more than once.
-- EnqueuePayoutNotifications relied on a unique index on outbox_events that was
-- never created (a NOT EXISTS check alone lets a daemon tick and `run-batch`
-- both insert).

-- 1. Keep the earliest disbursement per batch; park the extras for finance to
--    review rather than silently dropping them.
CREATE TABLE settlement_payout_disbursements_duplicates AS
SELECT d.*
  FROM settlement_payout_disbursements d
 WHERE d.id <> (
         SELECT k.id
           FROM settlement_payout_disbursements k
          WHERE k.settlement_batch_id = d.settlement_batch_id
          ORDER BY k.created_at, k.id
          LIMIT 1
       );

DELETE FROM settlement_payout_disbursements d
 USING settlement_payout_disbursements_duplicates x
 WHERE d.id = x.id;

CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id);

-- 2. One settlement.paid event per batch. Duplicates already in the outbox are
--    renamed, not deleted (webhook_deliveries references them), so nothing
--    dispatches or consumes them as a second payout.
UPDATE outbox_events oe
   SET event_type = 'settlement.paid.duplicate'
 WHERE oe.event_type = 'settlement.paid'
   AND oe.id <> (
         SELECT min(o2.id)
           FROM outbox_events o2
          WHERE o2.event_type = 'settlement.paid' AND o2.aggregate_id = oe.aggregate_id
       );

CREATE UNIQUE INDEX uq_outbox_settlement_paid_per_batch
    ON outbox_events (aggregate_id)
 WHERE event_type = 'settlement.paid';
