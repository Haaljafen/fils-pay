-- Migration 0054 (an abandoned PR, per the handover) created three views that
-- nothing reads any more, each encoding a wrong rule that invites reuse:
--   merchant_payable_position   "balance" = lifetime scheme-exported gross
--                               (bug 23: ignores fees, payouts, unsettled)
--   v_unbatched_capture_events  only 'captured', missing 'partially_captured'
--   v_active_api_keys           ignores rotation (bug 14)
DROP VIEW IF EXISTS merchant_payable_position;
DROP VIEW IF EXISTS v_unbatched_capture_events;
DROP VIEW IF EXISTS v_active_api_keys;
