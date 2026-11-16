"""Handler: keep a parent's calendar invite in line with the event they
reserved. Rules: PROVIDERS.md#calendar-invites."""

from datetime import datetime, timedelta
from typing import cast

from supabase import Client

from app.notifications import outbox
from app.notifications.messages import REMOVES, Kind, calendar_email, describe_changes, parse_time
from app.notifications.types import Context, Decision, Recipient, Row


def decide(*, row: Row, previous: Row | None, recipient: Recipient, ctx: Context) -> Decision:
    """Pure. `previous` is the event as the parent's calendar last got it
    (`invite_version`); only needed when that differs from the event now."""
    reservation: Row | None = row.get("reservations")
    event: Row | None = row.get("provider_events")
    if not reservation or not event:
        return Decision(None, "missing")
    if not recipient.wants_email:
        return Decision(None, "opted_out")
    if not recipient.email:
        return Decision(None, "no_email")
    if cast(datetime, parse_time(event["start_time"])) < ctx.now - timedelta(days=1):
        return Decision(None, "event_past")

    in_calendar = reservation.get("invite_version") is not None
    changes: list[str] = []
    if reservation["status"] != "confirmed":
        if not in_calendar:
            return Decision(None, "not_in_calendar")
        kind = Kind.withdrawn
    elif not in_calendar:
        if event["status"] == "cancelled":
            return Decision(None, "cancelled_before_invite")
        kind = Kind.booked
    else:
        if reservation["invite_version"] == event["version"]:
            return Decision(None, "up_to_date")
        if previous is None:
            return Decision(None, "no_previous_state")
        changes = describe_changes(previous, event)
        if not changes:
            return Decision(None, "reverted")
        kind = Kind.cancelled if event["status"] == "cancelled" else Kind.updated

    sequence = reservation.get("invite_sequence") or 0
    message = calendar_email(
        kind,
        to=recipient.email,
        event=event,
        reservation=reservation,
        changes=changes,
        sequence=sequence,
        organizer=ctx.organizer,
        now=ctx.now,
        app_url=ctx.app_url,
    )
    return Decision(
        message,
        kind.value,
        reservation_update={
            "invite_sequence": sequence + 1,
            "invite_version": None if kind in REMOVES else event["version"],
        },
    )


def handle(db: Client, row: Row, recipient: Recipient, ctx: Context) -> Decision:
    """Load what decide() needs, then decide."""
    event: Row = row.get("provider_events") or {}
    sent_version = (row.get("reservations") or {}).get("invite_version")
    previous = (
        outbox.event_at_version(db, event["id"], sent_version)
        if event and sent_version is not None and sent_version != event["version"]
        else None
    )
    return decide(row=row, previous=previous, recipient=recipient, ctx=ctx)
