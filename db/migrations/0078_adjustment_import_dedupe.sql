-- The same adjustment CSV could be applied any number of times: nothing tied an
-- import to its content, and original_filename is not unique (a double click
-- on "Import" moved real money twice). The fingerprint is a SHA-256 over the
-- normalised rows (merchant, parsed fils, reason); a second import with the
-- same fingerprint is refused. NULL for imports made before this column existed.
ALTER TABLE adjustment_imports ADD COLUMN content_sha256 TEXT;

CREATE UNIQUE INDEX uq_adjustment_imports_content_sha256
    ON adjustment_imports (content_sha256)
 WHERE content_sha256 IS NOT NULL;
