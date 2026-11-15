#!/usr/bin/env bash
# Database-level tests for provider events, reservations and change propagation
# (docs/PROVIDER_EVENTS_PLAN.md, phases 2 and 3).
#
# These rules live in Postgres functions, triggers and RLS, so they are tested
# against a real database rather than a stand-in: run against the LOCAL Supabase
# stack (`supabase start`, migrations applied).
#
#   bash supabase/tests/provider_events.sh
#
# Creates its own users and events, and removes them again on exit.

set -uo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_VillageOS}"

PROVIDER="c0000000-0000-4000-8000-000000000001"
OTHER_PROVIDER="c0000000-0000-4000-8000-000000000002"
parent() { printf 'c0000000-0000-4000-8000-0000000001%02d' "$1"; }

FAILED=0
PASSED=0

psql_admin() { docker exec -i "$DB_CONTAINER" psql -U postgres -qAt -v ON_ERROR_STOP=1 "$@"; }

# Run SQL as a signed-in user, the way PostgREST would: the `authenticated`
# role plus the JWT claims auth.uid() / auth.jwt() read. Prints rows, or the
# first error line.
as_user() {
    local uid="$1" sql="$2" claims="${3:-}"
    if [[ -z "$claims" ]]; then
        claims="{\"sub\":\"$uid\",\"role\":\"authenticated\"}"
    fi
    psql_admin 2>&1 <<SQL | grep -v '^$' | sed -n '1p' | sed 's/^ERROR:  //'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '$claims';
$sql;
COMMIT;
SQL
}

check() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        PASSED=$((PASSED + 1))
        echo "  ok    $name"
    else
        FAILED=$((FAILED + 1))
        echo "  FAIL  $name"
        echo "          expected: $expected"
        echo "          actual:   $actual"
    fi
}

cleanup() {
    psql_admin -c "DELETE FROM auth.users WHERE id::text LIKE 'c0000000-0000-4000-8000-%'" >/dev/null
}
trap cleanup EXIT

# Create an event owned by PROVIDER and print its id.
# Args: status, capacity (or NULL), start offset (interval, relative to now).
new_event() {
    psql_admin <<SQL
INSERT INTO provider_events (provider_id, title, event_type, start_time, location, capacity, status)
VALUES ('$PROVIDER', 'Test event', 'sport', NOW() + INTERVAL '$3', 'Pitch 1', $2, '$1')
RETURNING id;
SQL
}

confirmed() {
    psql_admin -c "SELECT COALESCE(SUM(spots), 0) FROM reservations WHERE event_id = '$1' AND status = 'confirmed'"
}

# ---------------------------------------------------------------------------
cleanup
psql_admin >/dev/null <<SQL
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
       'dbtest-' || id || '@test.local', meta::jsonb
FROM (
    VALUES ('$PROVIDER', '{"role":"provider"}'),
           ('$OTHER_PROVIDER', '{"role":"provider"}')
    UNION ALL
    SELECT 'c0000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'), '{}'
    FROM generate_series(1, 8) n
) AS u(id, meta);
INSERT INTO provider_profiles (user_id, name) VALUES ('$PROVIDER', 'Test Club'), ('$OTHER_PROVIDER', 'Other Club');
SQL

A="$(parent 1)"
B="$(parent 2)"

echo "Reserving"
EVENT="$(new_event published 1 '7 days')"

# Two parents, one spot. A holds its transaction open so B's call overlaps it:
# B must block on the event's row lock, then see A's reservation and fail.
(
    psql_admin >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"$A","role":"authenticated"}';
SELECT reserve_spot('$EVENT', 1);
SELECT pg_sleep(1);
COMMIT;
SQL
) &
sleep 0.3
RACE_B="$(as_user "$B" "SELECT (reserve_spot('$EVENT', 1)).status")"
wait
check "racing for the last spot: the second parent is refused" "event_full" "$RACE_B"
check "racing for the last spot: exactly one reservation" "1" "$(confirmed "$EVENT")"

# Eight parents at once for three spots.
EVENT3="$(new_event published 3 '7 days')"
for n in 1 2 3 4 5 6 7 8; do
    as_user "$(parent "$n")" "SELECT (reserve_spot('$EVENT3', 1)).status" >/dev/null &
done
wait
check "eight parents, three spots: exactly three reservations" "3" "$(confirmed "$EVENT3")"

check "a second reservation by the same parent is the same row" "1" \
    "$(as_user "$A" "SELECT (reserve_spot('$EVENT', 1)).spots" >/dev/null; psql_admin -c "SELECT COUNT(*) FROM reservations WHERE event_id = '$EVENT' AND user_id = '$A'")"
check "cancelling frees the spot" "cancelled" "$(as_user "$A" "SELECT (cancel_reservation('$EVENT')).status")"
check "the freed spot can be taken" "confirmed" "$(as_user "$B" "SELECT (reserve_spot('$EVENT', 1)).status")"
check "cancelling twice is refused" "reservation_not_found" "$(as_user "$A" "SELECT cancel_reservation('$EVENT')")"

check "a draft cannot be reserved" "event_not_found" \
    "$(as_user "$A" "SELECT reserve_spot('$(new_event draft NULL '7 days')', 1)")"
check "a past event cannot be reserved" "event_not_bookable" \
    "$(as_user "$A" "SELECT reserve_spot('$(new_event published NULL '-2 hours')', 1)")"
check "more than ten spots is refused" "invalid_spots" "$(as_user "$A" "SELECT reserve_spot('$EVENT3', 11)")"
ANON_CLAIMS='{"sub":"'"$A"'","role":"authenticated","is_anonymous":true}'
check "a demo (anonymous) session cannot reserve" "sign_in_required" \
    "$(as_user "$A" "SELECT reserve_spot('$EVENT3', 1)" "$ANON_CLAIMS")"

echo "Access"
check "a reservation cannot be inserted directly" "permission denied for table reservations" \
    "$(as_user "$A" "INSERT INTO reservations (event_id, user_id, spots, seen_version) VALUES ('$EVENT3', '$A', 5, 1)")"
check "a reservation cannot be updated directly" "permission denied for table reservations" \
    "$(as_user "$B" "UPDATE reservations SET spots = 9 WHERE event_id = '$EVENT'")"
check "a parent sees only their own reservations" "1" \
    "$(as_user "$B" "SELECT COUNT(*) FROM reservations WHERE event_id = '$EVENT'")"
check "another parent sees none of them" "0" \
    "$(as_user "$A" "SELECT COUNT(*) FROM reservations WHERE event_id = '$EVENT' AND status = 'confirmed'")"
check "the provider cannot see who reserved" "0" \
    "$(as_user "$PROVIDER" "SELECT COUNT(*) FROM reservations WHERE event_id = '$EVENT3'")"
check "the provider sees how many spots are taken" "3" \
    "$(as_user "$PROVIDER" "SELECT spots_taken FROM provider_event_spots_taken(ARRAY['$EVENT3']::uuid[])")"
check "spots taken on someone else's draft are not revealed" "" \
    "$(as_user "$OTHER_PROVIDER" "SELECT spots_taken FROM provider_event_spots_taken(ARRAY['$(new_event draft 5 '7 days')']::uuid[])")"
check "spots taken is visible to any parent" "3" \
    "$(as_user "$(parent 8)" "SELECT spots_taken FROM provider_event_spots_taken(ARRAY['$EVENT3']::uuid[])")"
check "the outbox is closed to users" "permission denied for table notification_outbox" \
    "$(as_user "$PROVIDER" "SELECT COUNT(*) FROM notification_outbox")"

echo "Change propagation"
version() { psql_admin -c "SELECT version FROM provider_events WHERE id = '$EVENT'"; }
pending() { psql_admin -c "SELECT COUNT(*) || ' from v' || COALESCE(MIN(from_version)::text, '-') FROM notification_outbox WHERE event_id = '$EVENT' AND status = 'pending'"; }

as_user "$PROVIDER" "UPDATE provider_events SET title = 'Renamed' WHERE id = '$EVENT'" >/dev/null
check "a title edit does not bump the version" "1" "$(version)"
check "a title edit queues no email" "0 from v-" "$(pending)"

as_user "$PROVIDER" "UPDATE provider_events SET start_time = start_time + INTERVAL '1 hour', version = 40 WHERE id = '$EVENT'" >/dev/null
check "a time edit bumps the version (and a client-set version is ignored)" "2" "$(version)"
check "a time edit queues one email for the one attendee" "1 from v1" "$(pending)"
check "the previous time is kept" "Pitch 1" \
    "$(as_user "$B" "SELECT location FROM provider_event_versions WHERE event_id = '$EVENT' AND version = 1")"
check "the parent's reservation is now behind" "1" \
    "$(as_user "$B" "SELECT seen_version FROM reservations WHERE event_id = '$EVENT'")"

as_user "$PROVIDER" "UPDATE provider_events SET location = 'Pitch 2' WHERE id = '$EVENT'" >/dev/null
check "a second edit coalesces into the same pending email" "1 from v1" "$(pending)"
check "opening the event acknowledges the current version" "3" \
    "$(as_user "$B" "SELECT (mark_reservation_seen('$EVENT')).seen_version")"

psql_admin -c "UPDATE notification_outbox SET status = 'sent', sent_at = NOW() WHERE event_id = '$EVENT'" >/dev/null
as_user "$PROVIDER" "SELECT version FROM update_provider_event('$EVENT', '{\"title\":\"Renamed\",\"event_type\":\"sport\",\"start_time\":\"2030-01-01T10:00:00Z\",\"location\":\"Pitch 3\",\"capacity\":1}'::jsonb, FALSE)" >/dev/null
check "an edit with 'Notify attendees' off still bumps the version" "4" "$(version)"
check "an edit with 'Notify attendees' off queues no email" "0 from v-" "$(pending)"
check "another provider cannot edit the event" "" \
    "$(as_user "$OTHER_PROVIDER" "SELECT version FROM update_provider_event('$EVENT', '{\"title\":\"Hijacked\",\"event_type\":\"sport\",\"start_time\":\"2031-01-01T10:00:00Z\"}'::jsonb)")"

check "an event with reservations cannot be unpublished" "event_has_reservations" \
    "$(as_user "$PROVIDER" "UPDATE provider_events SET status = 'draft' WHERE id = '$EVENT'")"
check "capacity cannot drop below the spots already reserved" "capacity_below_reserved" \
    "$(as_user "$PROVIDER" "UPDATE provider_events SET capacity = 2 WHERE id = '$EVENT3'")"

as_user "$PROVIDER" "UPDATE provider_events SET status = 'cancelled' WHERE id = '$EVENT'" >/dev/null
check "cancelling bumps the version" "5" "$(version)"
check "cancelling queues an email" "1 from v4" "$(pending)"
check "a cancelled event cannot be changed" "event_cancelled" \
    "$(as_user "$PROVIDER" "UPDATE provider_events SET status = 'published' WHERE id = '$EVENT'")"
check "a cancelled event cannot be reserved" "event_not_bookable" "$(as_user "$A" "SELECT reserve_spot('$EVENT', 1)")"

echo "Profiles"
check "a parent can turn event emails off" "f" \
    "$(as_user "$A" "UPDATE profiles SET event_emails = FALSE WHERE id = '$A' RETURNING event_emails")"
check "a parent cannot make themselves an admin" "permission denied for table profiles" \
    "$(as_user "$A" "UPDATE profiles SET role = 'admin' WHERE id = '$A'")"

echo
echo "$PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]]
