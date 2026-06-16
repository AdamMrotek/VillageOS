-- Drop the vestigial events.raw_text column.
--
-- Carried over from the POC baseline, where it was meant to hold the source
-- message each event was extracted from. The current API never writes it: the
-- ParentEvent schema has no raw_text field, so create_event's INSERT never sets
-- it and the column has always been NULL. Nothing reads it either.
--
-- Removing it is schema hygiene and a data-protection win: the parent's raw
-- pasted message (the rawest PII we handle) goes to the extractor and comes back
-- as structured events — it is never persisted. An empty column named raw_text
-- is a standing invitation to "just store the source text for debugging" later
-- and silently start retaining that PII. Dropping it closes that door.

ALTER TABLE events DROP COLUMN IF EXISTS raw_text;
