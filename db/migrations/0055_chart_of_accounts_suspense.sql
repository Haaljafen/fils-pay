-- Additional suspense accounts for future reconciliation lanes.
-- chart_of_accounts is (id, name, kind) — see 0007. Suspense accounts use
-- kind 'asset', matching scheme_rounding_residue.
--   fx_rounding_difference: rounding differences between fils and scheme-file BD amounts.
--   chargeback_suspense:    chargeback amounts pending acquirer confirmation.

INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  ('fx_rounding_difference', 'FX Rounding Difference', 'asset'),
  ('chargeback_suspense',    'Chargeback Suspense',    'asset')
ON CONFLICT (id) DO NOTHING;
