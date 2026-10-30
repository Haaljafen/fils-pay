-- platform_stats.total_processed_fils was INTEGER (32-bit, max 2,147,483,647)
-- while the volume-tier threshold it is compared against is 2,000,000,000
-- fils. A few batches past the threshold the running total overflowed: the
-- Go accumulator wrapped it negative and the tier silently switched off.
-- Every other money column is BIGINT (ADR-0001); this one now is too.

ALTER TABLE platform_stats
    ALTER COLUMN total_processed_fils TYPE BIGINT;
