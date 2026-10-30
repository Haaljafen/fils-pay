-- Refunds in the reporting read model.
--
-- merchant_daily_volume gains a refund count and gross, rolled up by the
-- reporting worker from refund.succeeded events on the same Asia/Bahrain
-- business day as captures. (The worker's old refund helper wrote these two
-- columns, but no migration had ever created them.)
ALTER TABLE merchant_daily_volume
    ADD COLUMN refund_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refund_gross_fils BIGINT  NOT NULL DEFAULT 0;

-- refund_merchant_summary (0072) joined refunds to transactions on
-- `t.id = r.id` (a refund id against a transaction id), so it could never
-- return a row; nothing reads or refreshes it. Refund reporting lives in
-- merchant_daily_volume above.
DROP MATERIALIZED VIEW IF EXISTS refund_merchant_summary;
