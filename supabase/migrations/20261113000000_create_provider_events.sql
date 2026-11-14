-- Provider events: dated events a provider publishes on their public page.
-- Phase 1 of docs/PROVIDER_EVENTS_PLAN.md. Parents read them here; reserving a
-- spot (the `reservations` table) arrives in Phase 2.
--
-- Deliberately a separate table from `events`: `events` rows are private to one
-- parent (owner-only RLS), these are public once published and owned by a
-- provider. A parent's calendar will reference these rows, never copy them.

CREATE TYPE public.provider_event_status AS ENUM (
    'draft',
    'published',
    'cancelled'
);

CREATE TABLE provider_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- References the public profile, not auth.users directly: an event can't
    -- exist without a provider page to show it on. Cascades from the profile,
    -- which itself cascades from auth.users (account deletion).
    provider_id  UUID        NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
    title        TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
    event_type   public.event_type NOT NULL,
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ,
    is_all_day   BOOLEAN     NOT NULL DEFAULT FALSE,
    location     TEXT,
    description  TEXT        CHECK (char_length(description) <= 240),
    -- NULL = unlimited.
    capacity     INTEGER     CHECK (capacity IS NULL OR capacity > 0),
    status       public.provider_event_status NOT NULL DEFAULT 'draft',
    -- Bumped on material edits (time / place / status) from Phase 3; maps to
    -- the ICS SEQUENCE in Phase 4. Starts at 1.
    version      INTEGER     NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT provider_events_end_after_start
        CHECK (end_time IS NULL OR end_time > start_time)
);

-- A provider's page lists their events by date.
CREATE INDEX provider_events_provider_start ON provider_events (provider_id, start_time);

-- RLS: published and cancelled events are public; drafts are visible only to
-- their owner. Cancelled stays public on purpose — a parent should see
-- "cancelled", not have the event silently vanish.
ALTER TABLE provider_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_events_public_read" ON provider_events
    FOR SELECT
    TO anon, authenticated
    USING (status IN ('published', 'cancelled') OR (SELECT auth.uid()) = provider_id);

CREATE POLICY "provider_events_owner_insert" ON provider_events
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = provider_id);

CREATE POLICY "provider_events_owner_update" ON provider_events
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = provider_id)
    WITH CHECK ((SELECT auth.uid()) = provider_id);

-- Only drafts can be deleted. Once published, an event is cancelled instead so
-- anyone who saw (or, from Phase 2, reserved) it gets a visible cancellation.
CREATE POLICY "provider_events_owner_delete_draft" ON provider_events
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = provider_id AND status = 'draft');
