-- The acquirer redelivers a callback (same callback_id) until it sees a 2xx,
-- and nothing on our side deduplicated them: 0051 left callback_id
-- non-unique, and the processed_events table its comments refer to was never
-- created. Each distinct callback has its own callback_id, so callback_id is
-- the redelivery key.
--
-- Rows already duplicated by redelivery are collapsed to the first one
-- received before the index is built.

DELETE FROM acquirer_callback_notes n
 USING acquirer_callback_notes earlier
 WHERE n.callback_id = earlier.callback_id
   AND (earlier.created_at, earlier.id) < (n.created_at, n.id);

CREATE UNIQUE INDEX acquirer_callback_notes_callback_id_key
    ON acquirer_callback_notes (callback_id);
