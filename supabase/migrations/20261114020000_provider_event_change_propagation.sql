-- Change propagation for provider events.
-- Phase 3 of docs/PROVIDER_EVENTS_PLAN.md (3a in-app, 3b email outbox).
--
-- Everything that must happen "when a provider changes an event" lives in one
-- BEFORE trigger on provider_events, so it holds whether the write came through
-- the API or straight over PostgREST, and it commits or rolls back with the
-- edit itself:
--   - bump `version` on a material edit (time, place, status)
--   - keep the pre-edit state, so a parent can be shown what changed
--   - queue one email notification per confirmed reservation

-- ---------------------------------------------------------------------------
-- History: the material fields as they were at each superseded version.
-- ---------------------------------------------------------------------------
CREATE TABLE provider_event_versions (
    event_id    UUID        NOT NULL REFERENCES provider_events(id) ON DELETE CASCADE,
    version     INTEGER     NOT NULL,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ,
    is_all_day  BOOLEAN     NOT NULL,
    location    TEXT,
    status      public.provider_event_status NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, version)
);

-- RLS: readable by whoever can read the event itself (the subquery runs under
-- the caller's RLS on provider_events). Rows are only written once an event has
-- left draft, so history never exposes more than the event already did.
ALTER TABLE provider_event_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_event_versions_read" ON provider_event_versions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM provider_events e WHERE e.id = provider_event_versions.event_id)
    );

REVOKE INSERT, UPDATE, DELETE ON provider_event_versions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Parent preference: event emails on by default, switchable in settings.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN event_emails BOOLEAN NOT NULL DEFAULT TRUE;
GRANT UPDATE (event_emails) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- Transactional outbox for change emails.
-- ---------------------------------------------------------------------------
CREATE TYPE public.notification_status AS ENUM (
    'pending',
    'sent',
    'skipped'
);

CREATE TABLE notification_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  UUID        NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    event_id        UUID        NOT NULL REFERENCES provider_events(id) ON DELETE CASCADE,
    -- The event version the parent was last told about. The worker diffs that
    -- version's state against the current one, so a burst of edits becomes one
    -- email and an edit that is reverted becomes none.
    from_version    INTEGER     NOT NULL,
    status          public.notification_status NOT NULL DEFAULT 'pending',
    -- Reset on every further edit: the worker waits for the event to go quiet.
    pending_since   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one pending row per reservation — this is what coalesces a burst of
-- edits and keeps sends idempotent.
CREATE UNIQUE INDEX notification_outbox_one_pending
    ON notification_outbox (reservation_id) WHERE status = 'pending';

-- The worker scans for pending rows that have been quiet long enough.
CREATE INDEX notification_outbox_due
    ON notification_outbox (pending_since) WHERE status = 'pending';

-- RLS on, no policy: server-only. The worker reads it with the secret key.
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_outbox FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger.
-- ---------------------------------------------------------------------------
-- Errors are raised with a stable message the API maps to an HTTP status:
--   event_cancelled, event_has_reservations, capacity_below_reserved
CREATE OR REPLACE FUNCTION public.provider_events_track_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_taken INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- `version` is owned by this trigger; a client can't start it elsewhere.
        NEW.version := 1;
        RETURN NEW;
    END IF;

    NEW.version := OLD.version;

    -- Cancellation is final: parents have been told, so it can't be undone.
    IF OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'event_cancelled';
    END IF;

    IF (OLD.status = 'published' AND NEW.status = 'draft')
       OR NEW.capacity IS DISTINCT FROM OLD.capacity
    THEN
        SELECT COALESCE(SUM(r.spots), 0) INTO v_taken
        FROM public.reservations r
        WHERE r.event_id = OLD.id AND r.status = 'confirmed';

        -- Unpublishing would make a reserved event vanish from parents'
        -- calendars (drafts are invisible). With reservations it must be
        -- cancelled instead, which parents can see.
        IF OLD.status = 'published' AND NEW.status = 'draft' AND v_taken > 0 THEN
            RAISE EXCEPTION 'event_has_reservations';
        END IF;
        IF NEW.capacity IS NOT NULL AND NEW.capacity < v_taken THEN
            RAISE EXCEPTION 'capacity_below_reserved';
        END IF;
    END IF;

    -- Material = what a parent plans around. Title and description edits are
    -- not; neither is anything that happens while the event is still a draft.
    IF OLD.status <> 'draft'
       AND (NEW.start_time, NEW.end_time, NEW.is_all_day, NEW.location, NEW.status)
           IS DISTINCT FROM
           (OLD.start_time, OLD.end_time, OLD.is_all_day, OLD.location, OLD.status)
    THEN
        INSERT INTO public.provider_event_versions
            (event_id, version, start_time, end_time, is_all_day, location, status)
        VALUES
            (OLD.id, OLD.version, OLD.start_time, OLD.end_time, OLD.is_all_day, OLD.location, OLD.status);

        NEW.version := OLD.version + 1;

        -- "Notify attendees" on the edit form. update_provider_event() sets
        -- this transaction-local flag; any other write path notifies.
        IF COALESCE(current_setting('villageos.notify_attendees', TRUE), '') <> 'off' THEN
            INSERT INTO public.notification_outbox (reservation_id, event_id, from_version)
            SELECT r.id, OLD.id, OLD.version
            FROM public.reservations r
            WHERE r.event_id = OLD.id AND r.status = 'confirmed'
            ON CONFLICT (reservation_id) WHERE status = 'pending'
                DO UPDATE SET pending_since = NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER provider_events_track_changes
    BEFORE INSERT OR UPDATE ON provider_events
    FOR EACH ROW EXECUTE FUNCTION public.provider_events_track_changes();

-- ---------------------------------------------------------------------------
-- Provider edit with the "Notify attendees" choice.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the UPDATE runs as the caller, so the owner-only RLS policy
-- on provider_events still decides whether it is allowed. The function exists
-- only to carry p_notify into the same transaction as the write.
CREATE OR REPLACE FUNCTION public.update_provider_event(
    p_event_id UUID,
    p_event    JSONB,
    p_notify   BOOLEAN DEFAULT TRUE
)
RETURNS SETOF public.provider_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    PERFORM set_config(
        'villageos.notify_attendees',
        CASE WHEN COALESCE(p_notify, TRUE) THEN 'on' ELSE 'off' END,
        TRUE
    );

    RETURN QUERY
    UPDATE public.provider_events e
    SET title       = p_event ->> 'title',
        event_type  = (p_event ->> 'event_type')::public.event_type,
        start_time  = (p_event ->> 'start_time')::TIMESTAMPTZ,
        end_time    = (p_event ->> 'end_time')::TIMESTAMPTZ,
        is_all_day  = COALESCE((p_event ->> 'is_all_day')::BOOLEAN, FALSE),
        location    = p_event ->> 'location',
        description = p_event ->> 'description',
        capacity    = (p_event ->> 'capacity')::INTEGER,
        updated_at  = NOW()
    WHERE e.id = p_event_id
      AND e.provider_id = auth.uid()
      -- A cancelled event matches no row, so the caller gets an empty result
      -- (reported as 409) rather than the trigger's exception.
      AND e.status <> 'cancelled'
    RETURNING e.*;
END;
$$;

-- Acknowledge the current version of a reserved event: clears the "Updated"
-- badge. Called when the parent opens the event.
CREATE OR REPLACE FUNCTION public.mark_reservation_seen(p_event_id UUID)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reservation public.reservations;
BEGIN
    UPDATE public.reservations r
    SET seen_version = e.version
    FROM public.provider_events e
    WHERE e.id = r.event_id
      AND r.event_id = p_event_id
      AND r.user_id = auth.uid()
    RETURNING r.* INTO v_reservation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'reservation_not_found';
    END IF;
    RETURN v_reservation;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_events_track_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_provider_event(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_reservation_seen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_provider_event(UUID, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reservation_seen(UUID) TO authenticated;
