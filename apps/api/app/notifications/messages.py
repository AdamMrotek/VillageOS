"""The wording of every notification email. Copy lives here and nowhere else."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import cast

from app.core.local_time import local_tz
from app.notifications.types import Row
from app.services import ics
from app.services.email import CalendarPart, EmailMessage


class Kind(StrEnum):
    booked = "booked"  # first invite after reserving
    updated = "updated"  # time or place changed
    cancelled = "cancelled"  # the provider cancelled the event
    withdrawn = "withdrawn"  # the parent cancelled their reservation


# The kinds whose invite takes the event off the parent's calendar.
REMOVES = {Kind.cancelled, Kind.withdrawn}


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def format_when(state: Row) -> str:
    """ "Fri 20 Nov 2026, 16:00 – 17:00", or "Fri 20 Nov 2026, all day", in UK time."""
    tz = local_tz()
    start = cast(datetime, parse_time(state["start_time"])).astimezone(tz)
    day = f"{start:%a} {start.day} {start:%b %Y}"
    if state.get("is_all_day"):
        return f"{day}, all day"
    end = parse_time(state.get("end_time"))
    if end is None:
        return f"{day}, {start:%H:%M}"
    end = end.astimezone(tz)
    if end.date() == start.date():
        return f"{day}, {start:%H:%M} – {end:%H:%M}"
    return f"{day}, {start:%H:%M} – {end:%a} {end.day} {end:%b}, {end:%H:%M}"


def describe_changes(previous: Row, current: Row) -> list[str]:
    """One line per thing a parent plans around that differs; empty if none."""
    if current["status"] == "cancelled":
        return [] if previous["status"] == "cancelled" else ["This event has been cancelled."]

    lines: list[str] = []
    when_before, when_now = format_when(previous), format_when(current)
    if when_before != when_now:
        lines.append(f"When: {when_now} (was {when_before})")
    where_before, where_now = previous.get("location"), current.get("location")
    if where_before != where_now:
        lines.append(f"Where: {where_now or 'no location'} (was {where_before or 'no location'})")
    return lines


def _plural(spots: int) -> str:
    return f"{spots} {'spot' if spots == 1 else 'spots'}"


def calendar_email(
    kind: Kind,
    *,
    to: str,
    event: Row,
    reservation: Row,
    changes: list[str],
    sequence: int,
    organizer: ics.Person,
    now: datetime,
    app_url: str,
) -> EmailMessage:
    """A reserved-event email of `kind`, carrying the calendar invite."""
    provider = (event.get("provider_profiles") or {}).get("name") or "The organiser"
    title = event["title"]
    spots = reservation.get("spots") or 1
    settings_url = f"{app_url}/settings"

    details = [f"When: {format_when(event)}"]
    if event.get("location"):
        details.append(f"Where: {event['location']}")

    subject, intro, body, calendar_line = {
        Kind.booked: (
            f"Booked: {title}",
            f"You've reserved {_plural(spots)} with {provider}.",
            details,
            "Add it to your calendar with the invite in this email. If the time "
            "or place changes, we'll email you an update that changes it there too.",
        ),
        Kind.updated: (
            f"Updated: {title}",
            f"{provider} has changed an event you reserved.",
            # Exactly what moved, which already says where and when it is now.
            changes,
            "The invite in this email updates it in your calendar.",
        ),
        Kind.cancelled: (
            f"Cancelled: {title}",
            f"{provider} has cancelled an event you reserved.",
            details,
            "The invite in this email takes it off your calendar.",
        ),
        Kind.withdrawn: (
            f"Reservation cancelled: {title}",
            f"You cancelled your reservation with {provider}.",
            details,
            "The invite in this email takes it off your calendar.",
        ),
    }[kind]

    text = "\n".join(
        [
            intro,
            "",
            title,
            *body,
            "",
            calendar_line,
            "",
            f"See it in VillageOS: {app_url}/calendar",
            "",
            "You are receiving this because you reserved a spot on this event.",
            f"Turn these emails off (your calendar then stops updating): {settings_url}",
        ]
    )
    method: ics.Method = "CANCEL" if kind in REMOVES else "REQUEST"
    invite = ics.build_invite(
        method=method,
        reservation_id=reservation["id"],
        sequence=sequence,
        event=event,
        spots=spots,
        organizer=organizer,
        attendee=ics.Person(to),
        now=now,
        app_url=app_url,
    )
    return EmailMessage(
        to=to,
        subject=subject,
        text=text,
        unsubscribe_url=settings_url,
        calendar=CalendarPart(method=method, ics=invite),
    )
