-- What CloseBatch nets out of a payout, frozen on the batch next to gross and
-- fee, so a batch explains its own net_payout_fils:
--
--   net_payout_fils - carry_out_fils
--     = gross_fils - fee_fils - refund_fils + fee_reversed_fils - carry_in_fils
--
-- A payout cannot be negative. When a day's refunds exceed what it would pay,
-- net_payout_fils is 0 and the shortfall is carry_out_fils; the next batch
-- takes it as carry_in_fils. The ledger needs no entry for this: the refund's
-- legs already left merchant_payable negative, and the next payout clears it.
-- A merchant's outstanding shortfall is SUM(carry_out_fils - carry_in_fils).

ALTER TABLE settlement_batches
    ADD COLUMN refund_fils       BIGINT NOT NULL DEFAULT 0 CHECK (refund_fils >= 0),
    ADD COLUMN fee_reversed_fils BIGINT NOT NULL DEFAULT 0 CHECK (fee_reversed_fils >= 0),
    ADD COLUMN carry_in_fils     BIGINT NOT NULL DEFAULT 0 CHECK (carry_in_fils >= 0),
    ADD COLUMN carry_out_fils    BIGINT NOT NULL DEFAULT 0 CHECK (carry_out_fils >= 0);
