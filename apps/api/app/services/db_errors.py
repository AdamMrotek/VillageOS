"""Turn the database's rule violations into HTTP errors.

The reservation and change-tracking rules live in Postgres functions and a
trigger (see supabase/migrations/20261114010000_create_reservations.sql and
20261114020000_provider_event_change_propagation.sql). When one is broken they
`RAISE EXCEPTION '<key>'`; PostgREST relays the key as the error message. This
maps each key to the status and sentence the client shows.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException
from postgrest.exceptions import APIError

_RULES: dict[str, tuple[int, str]] = {
    "sign_in_required": (403, "Create an account to reserve a spot"),
    "invalid_spots": (422, "Choose between 1 and 10 spots"),
    "event_not_found": (404, "Event not found"),
    "event_not_bookable": (409, "This event can no longer be reserved"),
    "event_full": (409, "Not enough spots left"),
    "reservation_not_found": (404, "Reservation not found"),
    "event_cancelled": (409, "A cancelled event can't be changed"),
    "event_has_reservations": (
        409,
        "Parents have reserved this event — cancel it instead of unpublishing",
    ),
    "capacity_below_reserved": (409, "Spots can't be set below the number already reserved"),
}


@contextmanager
def db_rules() -> Iterator[None]:
    """Re-raise a known rule violation as its HTTPException; anything else
    propagates unchanged (and surfaces as a 500)."""
    try:
        yield
    except APIError as exc:
        rule = _RULES.get(exc.message or "")
        if rule is None:
            raise
        raise HTTPException(status_code=rule[0], detail=rule[1]) from exc
