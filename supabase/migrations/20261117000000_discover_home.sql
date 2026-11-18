-- Discover home (D1 in docs/PROVIDER_EVENTS_PLAN.md §4): the browse page's
-- rule-based rows need to know how parents use a provider, and how popular
-- each one is.

-- How parents use a provider, separate from `category` (what sector they are
-- in). A venue is a place families go, an entertainer is booked for private
-- parties, an organiser runs events (schools and councils included).
CREATE TYPE public.provider_kind AS ENUM (
    'venue',
    'organiser',
    'entertainer'
);

ALTER TABLE provider_profiles
    ADD COLUMN kind public.provider_kind NOT NULL DEFAULT 'organiser';

-- The browse rows read upcoming published events across all providers,
-- soonest first. The existing (provider_id, start_time) index only serves one
-- provider's page.
CREATE INDEX provider_events_published_start
    ON provider_events (start_time)
    WHERE status = 'published';

-- Confirmed reservations per provider, across their published events, for
-- ranking "Popular venues". A count of bookings, not who made them: parents
-- can't read each other's reservations, so this runs as the definer and
-- returns only totals. Drafts are left out so a provider can't see interest in
-- an event that was never public. Providers with no reservations are absent.
CREATE OR REPLACE FUNCTION public.provider_reservation_counts(p_provider_ids UUID[])
RETURNS TABLE (provider_id UUID, reservations INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.provider_id, COUNT(r.id)::INTEGER
    FROM public.provider_events e
    JOIN public.reservations r
      ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.provider_id = ANY (p_provider_ids)
      AND e.status = 'published'
    GROUP BY e.provider_id;
$$;

REVOKE ALL ON FUNCTION public.provider_reservation_counts(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_reservation_counts(UUID[]) TO authenticated;
