-- Self-hosted experiments — drops PostHog for both jobs it did:
--   (1) variant-assignment config + remote kill-switch  (experiments)
--   (2) the event sink the A/B readouts aggregate over   (analytics_events)
-- See apps/api/EXPERIMENTS.md.

-- ───────────────────────────────────────────────────────────────────────────
-- experiments — one row per A/B test: the config and remote kill-switch.
-- Editing a row retunes the split or disables a test with no deploy.
CREATE TABLE experiments (
    key             TEXT        PRIMARY KEY,
    enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
    variants        JSONB       NOT NULL,  -- weight map, e.g. {"control":0.5,"treatment":0.5}
    default_variant TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on, no policy: only the service-role client (get_admin_db) reads config,
-- inside server-side assignment. End users have no path to experiment config.
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

-- Seed the live extraction provider-stack A/B (ADR-019). Disabled by default —
-- flip enabled=true (and adjust weights) to turn it on without a deploy. Keys
-- match app/core/experiments._VARIANT_TO_CONFIG.
INSERT INTO experiments (key, enabled, variants, default_variant) VALUES
    ('extraction-model', FALSE, '{"control": 0.5, "treatment": 0.5}'::jsonb, 'control');

-- ───────────────────────────────────────────────────────────────────────────
-- analytics_events — generic event sink (replaces posthog.capture). distinct_id
-- is the Supabase user id (JWT sub), stamped server-side so a client can never
-- write events as another user. Anonymous demo guests (ADR-016) are real
-- auth.users rows, so the FK + auth.uid() cover them too.
CREATE TABLE analytics_events (
    id          BIGSERIAL   PRIMARY KEY,
    event       TEXT        NOT NULL,
    distinct_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    properties  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX analytics_events_event_ts_idx ON analytics_events (event, ts);
CREATE INDEX analytics_events_properties_idx ON analytics_events USING GIN (properties);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Authenticated callers may INSERT only their own events. There is no SELECT
-- policy: reads happen exclusively through the admin readout views below, via
-- the service-role client (which bypasses RLS). Server-side captures also use
-- the service role, so they're unaffected by this user-scoped policy.
CREATE POLICY "users_insert_own_events" ON analytics_events
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = distinct_id);

-- ───────────────────────────────────────────────────────────────────────────
-- A/B readout views — the self-hosted equivalents of the PostHog HogQL tiles
-- (apps/api/EXPERIMENTS.md, "Reading the results"). security_invoker = on means they run
-- with the caller's RLS: anon/authenticated see nothing (no SELECT policy on the
-- base table); the service-role client bypasses RLS and reads everything.

-- Tile 1 — outcomes per arm. One row per variant. (unassigned) bucket keeps a
-- variant-less event visible as a data-hygiene check, never a third arm.
CREATE VIEW experiment_extraction_outcomes
WITH (security_invoker = on) AS
SELECT
    COALESCE(properties->>'variant', '(unassigned)')                                      AS model,
    COUNT(*) FILTER (WHERE event = 'extraction_shown')                                    AS shown,
    COUNT(*) FILTER (WHERE event = 'extraction_accepted')                                 AS accepted,
    COUNT(*) FILTER (WHERE event = 'extraction_shown'
                       AND properties->>'re_extract' = 'true')                            AS re_extracted,
    COUNT(*) FILTER (WHERE event = 'extraction_discarded')                                AS discarded,
    COUNT(*) FILTER (WHERE event = 'extraction_shown')
      - COUNT(*) FILTER (WHERE event = 'extraction_accepted')                             AS not_completed,
    ROUND(100.0 * COUNT(*) FILTER (WHERE event = 'extraction_accepted')
          / NULLIF(COUNT(*) FILTER (WHERE event = 'extraction_shown'), 0), 1)             AS completion_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE event = 'extraction_discarded')
          / NULLIF(COUNT(*) FILTER (WHERE event = 'extraction_shown'), 0), 1)             AS discard_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE event = 'extraction_shown'
                                     AND properties->>'re_extract' = 'true')
          / NULLIF(COUNT(*) FILTER (WHERE event = 'extraction_shown'), 0), 1)             AS reextract_pct
FROM analytics_events
WHERE event IN ('extraction_shown', 'extraction_accepted', 'extraction_discarded')
GROUP BY model
ORDER BY shown DESC;

-- Tile 2 — per-field edit rate, pivoted to one row per field (control vs
-- treatment %). jsonb_array_elements_text unnests edited_fields (Postgres's
-- arrayJoin); the denominator is each arm's accepted-draft count.
CREATE VIEW experiment_extraction_field_edits
WITH (security_invoker = on) AS
WITH exploded AS (
    SELECT
        properties->>'variant' AS variant,
        jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(properties->'edited_fields') = 'array'
                 THEN properties->'edited_fields' ELSE '[]'::jsonb END
        ) AS field
    FROM analytics_events
    WHERE event = 'extraction_accepted'
),
per_field AS (
    SELECT
        field,
        COUNT(*) FILTER (WHERE variant = 'control')   AS control_edits,
        COUNT(*) FILTER (WHERE variant = 'treatment') AS treatment_edits
    FROM exploded
    GROUP BY field
),
accepted AS (
    SELECT
        COUNT(*) FILTER (WHERE properties->>'variant' = 'control')   AS control_acc,
        COUNT(*) FILTER (WHERE properties->>'variant' = 'treatment') AS treatment_acc
    FROM analytics_events
    WHERE event = 'extraction_accepted'
)
SELECT
    pf.field                                                              AS field,
    ROUND(100.0 * pf.control_edits   / NULLIF(a.control_acc, 0), 1)       AS control_pct,
    ROUND(100.0 * pf.treatment_edits / NULLIF(a.treatment_acc, 0), 1)     AS treatment_pct
FROM per_field pf CROSS JOIN accepted a
ORDER BY
    COALESCE(ROUND(100.0 * pf.control_edits   / NULLIF(a.control_acc, 0), 1), 0)
  + COALESCE(ROUND(100.0 * pf.treatment_edits / NULLIF(a.treatment_acc, 0), 1), 0) DESC;

-- service_role drives both views from the admin API; nobody else may read them.
REVOKE ALL ON experiment_extraction_outcomes, experiment_extraction_field_edits FROM anon, authenticated;
GRANT SELECT ON experiment_extraction_outcomes, experiment_extraction_field_edits TO service_role;
