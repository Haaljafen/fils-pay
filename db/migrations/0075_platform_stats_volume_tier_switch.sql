-- The platform-wide volume-tier discount (0.15% off every merchant's MDR once
-- lifetime volume passes 2,000,000 BD) was coded and switched on without
-- finance approval: the handover records Yousif refusing it "until finance
-- signs off in writing", and no ticket for it exists.
--
-- It now applies only when this switch is true. Both apps/api (capture) and
-- apps/settlement (batch close) read it from this one row, so the two sides
-- can never price the same event differently. Turning it on is a deliberate,
-- audited change, e.g.:
--   UPDATE platform_stats SET volume_tier_enabled = true, updated_at = now() WHERE id = 1;

ALTER TABLE platform_stats
    ADD COLUMN volume_tier_enabled BOOLEAN NOT NULL DEFAULT false;
