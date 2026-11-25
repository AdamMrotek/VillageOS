-- Reservations: a parent holding spots on a provider's event.
-- Phase 2 of docs/PROVIDER_EVENTS_PLAN.md.
--
-- A reserved event is never copied into the parent's `events` table. This row
-- points at the provider's event and the calendar reads both sources live, so a
-- provider edit is visible on the next fetch with no fan-out job.

CREATE TYPE public.reservation_status AS ENUM (
    'confirmed',
    'cancelled'
);

CREATE TABLE reservations (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      UUID        NOT NULL REFERENCES provider_events(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spots         INTEGER     NOT NULL DEFAULT 1 CHECK (spots BETWEEN 1 AND 10),
    status        public.reservation_status NOT NULL DEFAULT 'confirmed',
    -- The event `version` this parent last acknowledged. Behind the event's
    -- current version = show the "Updated" badge (Phase 3).
    seen_version  INTEGER     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One reservation per parent per event; re-reserving re-confirms this row.
    CONSTRAINT reservations_one_per_user UNIQUE (event_id, user_id)
);

-- A parent's calendar lists their reservations.
CREATE INDEX reservations_user ON reservations (user_id) WHERE status = 'confirmed';

-- RLS: a parent reads their own reservations, and nothing else. Every write goes through the SECURITY DEFINER
-- functions below — a direct INSERT or UPDATE could set `spots` or `status`
-- without the capacity check, which is the whole point of reserve_spot.
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reservations_owner_read" ON reservations
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- Deliberately no provider policy. A provider learns how many spots are taken
-- through provider_event_spots_taken() below, not who took them: showing
-- attendees to a provider is new data sharing that needs consent copy and a
-- DPIA entry first (docs/PROVIDER_EVENTS_PLAN.md, 1.8).

REVOKE INSERT, UPDATE, DELETE ON reservations FROM anon, authenticated;

-- Reserve (or re-confirm, or change the spot count of) the caller's place on an
-- event. Capacity is enforced here, under a row lock on the event, because a
-- check in the API layer cannot stop two parents racing for the last spot: the
-- second caller blocks on the lock and then sees the first one's reservation.
--
-- Errors are raised with a stable message the API maps to an HTTP status:
--   sign_in_required, invalid_spots, event_not_found, event_not_bookable,
--   event_full
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

    RETURN v_reservation;
END;
$$;

-- Cancel the caller's reservation. The row is kept (status = 'cancelled') so a
-- later re-reserve re-confirms it rather than hitting the unique constraint.
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
    RETURN v_reservation;
END;
$$;

-- Confirmed spots per event, for "3 spots left" and the provider's attendee
-- count. Nobody can read another user's reservation rows, so the total comes
-- from here; it only answers for events the caller could already see.
CREATE OR REPLACE FUNCTION public.provider_event_spots_taken(p_event_ids UUID[])
RETURNS TABLE (event_id UUID, spots_taken INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.id, COALESCE(SUM(r.spots), 0)::INTEGER
    FROM public.provider_events e
    LEFT JOIN public.reservations r
           ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.id = ANY (p_event_ids)
      AND (e.status IN ('published', 'cancelled') OR e.provider_id = auth.uid())
    GROUP BY e.id;
$$;

REVOKE ALL ON FUNCTION public.reserve_spot(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_reservation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_event_spots_taken(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_spot(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_event_spots_taken(UUID[]) TO authenticated;
