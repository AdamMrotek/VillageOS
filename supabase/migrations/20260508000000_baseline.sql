-- Baseline: reflects the schema created by the POC migration (20260508160143).
-- This file is a record only — these tables already exist on the remote.

CREATE TYPE IF NOT EXISTS public.event_type AS ENUM (
    'school', 'sport', 'birthday', 'fundraiser', 'meeting', 'deadline', 'other'
);

CREATE TABLE IF NOT EXISTS events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT        NOT NULL,
    event_type   public.event_type NOT NULL,
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ,
    is_all_day   BOOLEAN     NOT NULL DEFAULT FALSE,
    location     TEXT,
    description  TEXT,
    confidence   NUMERIC     NOT NULL,
    raw_text     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_items (
    id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           UUID    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    description        TEXT    NOT NULL,
    cost_estimate_gbp  NUMERIC,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
