-- Remove the self-hosted experiments / A-B stack.
--
-- The extraction provider-stack A/B (added 2026-06-26, see the now-deleted
-- apps/api/EXPERIMENTS.md) is gone: assignment, the control/arm model logic, and
-- the funnel analytics that only ever fed its readout are all removed from the
-- app. This drops the backing objects. Extraction now runs the env-default
-- provider for text and that provider's vision model for images — the path
-- production already took whenever the experiment was disabled.

-- Views first (they read analytics_events), then the tables. Indexes and the
-- RLS policies drop with their tables.
DROP VIEW IF EXISTS experiment_extraction_field_edits;
DROP VIEW IF EXISTS experiment_extraction_outcomes;

DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS experiments;
