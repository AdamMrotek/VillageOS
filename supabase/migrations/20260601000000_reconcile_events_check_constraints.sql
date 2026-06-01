-- Reconcile the events CHECK constraints with the application schema.
--
-- These constraints were created on the POC database but never tracked in
-- migrations (schema drift). This migration codifies all four so the repo
-- matches the remote, and relaxes the description cap from 120 to 240 chars
-- to match ParentEvent.description in app/schemas/events.py — the old 120 cap
-- rejected extracted descriptions that passed API validation, surfacing as 500s.
--
-- DROP IF EXISTS + ADD makes this idempotent against the already-constrained remote.

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_description_check;
ALTER TABLE events ADD CONSTRAINT events_description_check
    CHECK (char_length(description) <= 240);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_title_check;
ALTER TABLE events ADD CONSTRAINT events_title_check
    CHECK (char_length(title) <= 60);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_confidence_check;
ALTER TABLE events ADD CONSTRAINT events_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE events DROP CONSTRAINT IF EXISTS end_after_start;
ALTER TABLE events ADD CONSTRAINT end_after_start
    CHECK (end_time IS NULL OR end_time > start_time);
