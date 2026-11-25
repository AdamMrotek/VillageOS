-- Calendar invites by email (phase 4 of docs/PROVIDER_EVENTS_PLAN.md): what
-- each parent's calendar was last sent, and queueing an outbox row when a
-- parent reserves or cancels. How it works: PROVIDERS.md#notifications.

-- ---------------------------------------------------------------------------
-- What each parent's calendar holds.
-- ---------------------------------------------------------------------------
ALTER TABLE reservations
    -- SEQUENCE carried by the next invite email for this reservation. Calendar
    -- apps only apply an invite whose SEQUENCE is above the last one they saw,
    -- so it never goes down, including across cancel and re-reserve.
    ADD COLUMN invite_sequence INTEGER NOT NULL DEFAULT 0,
    -- The event version the parent's calendar was last sent. NULL = nothing in
    -- their calendar (never invited, or the invite was withdrawn).
    ADD COLUMN invite_version  INTEGER;

-- ---------------------------------------------------------------------------
-- Outbox: when each row is due.
-- ---------------------------------------------------------------------------
-- A new reservation or a cancelled one is due at once. A provider's edit is due
-- 10 minutes after their last edit, so a burst of edits becomes one email.
-- `from_version` is dropped: what the parent's calendar was last sent lives on
-- the reservation (invite_version), which also covers the first invite.
ALTER TABLE notification_outbox
    DROP COLUMN from_version,
    ADD COLUMN due_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP INDEX notification_outbox_due;
CREATE INDEX notification_outbox_due
    ON notification_outbox (due_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Provider edits: queue a calendar update per confirmed reservation.
-- ---------------------------------------------------------------------------
-- Same trigger as 20261114020000_provider_event_change_propagation.sql; only
-- the outbox insert changes.
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
        -- this transaction-local flag; any other write path notifies. With it
        -- off, calendars catch up on the next notified change.
        IF COALESCE(current_setting('villageos.notify_attendees', TRUE), '') <> 'off' THEN
            INSERT INTO public.notification_outbox (reservation_id, event_id, due_at)
            SELECT r.id, OLD.id, NOW() + INTERVAL '10 minutes'
            FROM public.reservations r
            WHERE r.event_id = OLD.id AND r.status = 'confirmed'
            ON CONFLICT (reservation_id) WHERE status = 'pending'
                DO UPDATE SET pending_since = NOW(), due_at = EXCLUDED.due_at;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reserving and cancelling: queue the invite, or its withdrawal, at once.
-- ---------------------------------------------------------------------------
-- reserve_spot() as in 20261114010000_create_reservations.sql, plus the
-- outbox insert at the end.
CREATE OR REPLACE FUNCTION public.reserve_spot(p_event_id UUID, p_spots INTEGER DEFAULT 1)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user        UUID := auth.uid();
    v_event       public.provider_events;
    v_taken       INTEGER;
    v_reservation public.reservations;
BEGIN
    -- Demo sessions are anonymous auth users; a reservation needs a real
    -- account the provider's changes can be reported to.
    IF v_user IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION 'sign_in_required';
    END IF;
    IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'invalid_spots';
    END IF;

    SELECT * INTO v_event FROM public.provider_events WHERE id = p_event_id FOR UPDATE;
    -- A draft is invisible to parents, so it is reported the same as missing.
    IF NOT FOUND OR v_event.status = 'draft' THEN
        RAISE EXCEPTION 'event_not_found';
    END IF;
    -- All-day events are stored at local midnight, so they stay bookable for
    -- the rest of their day (same one-day grace as the public listing).
    IF v_event.status <> 'published'
       OR (v_event.is_all_day AND v_event.start_time < NOW() - INTERVAL '1 day')
       OR (NOT v_event.is_all_day AND v_event.start_time < NOW())
    THEN
        RAISE EXCEPTION 'event_not_bookable';
    END IF;

    -- The caller's own row is excluded: changing 2 spots to 3 must count as 3,
    -- not 5.
    SELECT COALESCE(SUM(r.spots), 0) INTO v_taken
    FROM public.reservations r
    WHERE r.event_id = p_event_id
      AND r.status = 'confirmed'
      AND r.user_id <> v_user;

    IF v_event.capacity IS NOT NULL AND v_taken + p_spots > v_event.capacity THEN
        RAISE EXCEPTION 'event_full';
    END IF;

    INSERT INTO public.reservations (event_id, user_id, spots, status, seen_version)
    VALUES (p_event_id, v_user, p_spots, 'confirmed', v_event.version)
    ON CONFLICT (event_id, user_id) DO UPDATE
        SET status       = 'confirmed',
            spots        = EXCLUDED.spots,
            seen_version = EXCLUDED.seen_version,
            updated_at   = NOW()
    RETURNING * INTO v_reservation;

    -- The calendar invite. If the parent's calendar already has this event
    -- (a spot-count change), the worker finds nothing to send.
    INSERT INTO public.notification_outbox (reservation_id, event_id)
    VALUES (v_reservation.id, p_event_id)
    ON CONFLICT (reservation_id) WHERE status = 'pending'
        DO UPDATE SET pending_since = NOW(), due_at = NOW();

    RETURN v_reservation;
END;
$$;

-- cancel_reservation() as in 20261114010000_create_reservations.sql, plus the
-- outbox insert. The worker withdraws the invite only if one was sent.
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_event_id UUID)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reservation public.reservations;
BEGIN
    UPDATE public.reservations
    SET status = 'cancelled', updated_at = NOW()
    WHERE event_id = p_event_id
      AND user_id = auth.uid()
      AND status = 'confirmed'
    RETURNING * INTO v_reservation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'reservation_not_found';
    END IF;

    INSERT INTO public.notification_outbox (reservation_id, event_id)
    VALUES (v_reservation.id, p_event_id)
    ON CONFLICT (reservation_id) WHERE status = 'pending'
        DO UPDATE SET pending_since = NOW(), due_at = NOW();

    RETURN v_reservation;
END;
$$;
