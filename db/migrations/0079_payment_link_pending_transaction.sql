-- The transaction an in-flight pay attempt has authorized (and possibly
-- captured) against a link. transaction_id can only be set on a paid link
-- (CHECK above), so an attempt records its money here while the link is still
-- reserved. A stale reservation with this set is never reclaimed: money may have
-- moved, and reclaiming it would charge the same link twice (bug 90).
ALTER TABLE payment_links
    ADD COLUMN pending_transaction_id UUID REFERENCES transactions (id);
