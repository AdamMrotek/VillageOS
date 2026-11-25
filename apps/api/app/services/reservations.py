from datetime import UTC, datetime
from typing import Any, cast

from supabase import Client

from app.schemas.events import StoredEvent
from app.schemas.reservations import ReservationStatus, StoredReservation
from app.services.db_errors import db_rules

# postgrest types row data as generic JSON; these tables always return objects.
_Row = dict[str, Any]

# A reservation with its event and the provider's name, in one round trip.
_CALENDAR_SELECT = "id, spots, seen_version, provider_events(*, provider_profiles(name))"


def reserve(db: Client, event_id: str, spots: int) -> StoredReservation:
    """Reserve, re-confirm, or change the spot count. Capacity is decided by
    reserve_spot() under a row lock — never check it here first."""
    with db_rules():
        row = db.rpc("reserve_spot", {"p_event_id": event_id, "p_spots": spots}).execute().data
    return StoredReservation.model_validate(row)


def cancel(db: Client, event_id: str) -> StoredReservation:
    with db_rules():
        row = db.rpc("cancel_reservation", {"p_event_id": event_id}).execute().data
    return StoredReservation.model_validate(row)


def mark_seen(db: Client, event_id: str) -> StoredReservation:
    """Acknowledge the event's current version (clears the "Updated" badge)."""
    with db_rules():
        row = db.rpc("mark_reservation_seen", {"p_event_id": event_id}).execute().data
    return StoredReservation.model_validate(row)


def spots_taken(db: Client, event_ids: list[str]) -> dict[str, int]:
    """Confirmed spots per event. Parents can't read each other's reservations,
    so the total comes from a function rather than a query."""
    if not event_ids:
        return {}
    rows = cast(
        list[_Row],
        db.rpc("provider_event_spots_taken", {"p_event_ids": event_ids}).execute().data,
    )
    return {row["event_id"]: row["spots_taken"] for row in rows}


def my_spots(db: Client, user_id: str, event_ids: list[str]) -> dict[str, int]:
    """The caller's own confirmed spots per event. RLS already limits this to
    their own rows; the user_id filter states the intent and survives a future
    policy that lets a provider read reservations on their events."""
    if not event_ids:
        return {}
    rows = cast(
        list[_Row],
        db.table("reservations")
        .select("event_id, spots")
        .eq("user_id", user_id)
        .eq("status", ReservationStatus.confirmed.value)
        .in_("event_id", event_ids)
        .execute()
        .data,
    )
    return {row["event_id"]: row["spots"] for row in rows}


def to_calendar_event(reservation: _Row, previous: _Row | None) -> StoredEvent:
    """Shape a reserved provider event like one of the parent's own, so the
    calendar renders both from one list.

    `previous` is the event as it was at the version the parent last saw, or
    None when they are up to date.
    """
    event: _Row = reservation["provider_events"]
    provider: _Row = event.get("provider_profiles") or {}
    return StoredEvent.model_validate(
        {
            **event,
            # Parent-only fields a provider event doesn't have.
            "confidence": 1.0,
            "action_items": [],
            "source": "provider",
            "reservation": {
                "reservation_id": reservation["id"],
                "spots": reservation["spots"],
                "provider_id": event["provider_id"],
                "provider_name": provider.get("name"),
                "cancelled": event["status"] == "cancelled",
                "updated": reservation["seen_version"] < event["version"],
                "previous": previous,
            },
        }
    )


def list_reserved_events(db: Client, user_id: str) -> list[StoredEvent]:
    """The caller's confirmed reservations as calendar events."""
    reservations = cast(
        list[_Row],
        db.table("reservations")
        .select(_CALENDAR_SELECT)
        .eq("user_id", user_id)
        .eq("status", ReservationStatus.confirmed.value)
        .execute()
        .data,
    )
    # RLS hides the event if it went back to draft; nothing to show then.
    reservations = [r for r in reservations if r.get("provider_events")]

    behind = [r for r in reservations if r["seen_version"] < r["provider_events"]["version"]]
    previous: dict[tuple[str, int], _Row] = {}
    if behind:
        versions = cast(
            list[_Row],
            db.table("provider_event_versions")
            .select("*")
            .in_("event_id", [r["provider_events"]["id"] for r in behind])
            .execute()
            .data,
        )
        previous = {(v["event_id"], v["version"]): v for v in versions}

    return [
        to_calendar_event(r, previous.get((r["provider_events"]["id"], r["seen_version"])))
        for r in reservations
    ]


def sort_key(event: StoredEvent) -> datetime:
    """Start time, comparable across both sources (treats a naive time as UTC)."""
    start = event.start_time
    return start if start.tzinfo else start.replace(tzinfo=UTC)
