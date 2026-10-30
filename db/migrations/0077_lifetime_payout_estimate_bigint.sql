-- merchants.lifetime_net_payout_monitoring_estimate was a REAL (float4): a
-- running total of fils that stops being exact at 2^24 (16,777.216 BD) and
-- then silently drops fils on every addition. It is a money total in fils like
-- every other (ADR-0001: integer fils, BIGINT), so it is stored as one.
ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;
