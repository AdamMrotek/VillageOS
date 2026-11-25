"""The iCalendar text (RFC 5545) of a calendar invite for a reserved event.
How invites work: PROVIDERS.md#calendar-invites."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from app.core.local_time import local_tz

_Row = dict[str, Any]

Method = Literal["REQUEST", "CANCEL"]

# Calendars need an end; an event without one gets this long.
DEFAULT_DURATION = timedelta(hours=1)

_UID_DOMAIN = "villageos.co.uk"


@dataclass(frozen=True)
class Person:
    email: str
    name: str | None = None


def uid(reservation_id: str) -> str:
    """Stable per reservation, so every invite for it updates the same event,
    including after the parent cancels and reserves again (same row)."""
    return f"reservation-{reservation_id}@{_UID_DOMAIN}"


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------
def escape_text(value: str) -> str:
    """Escape a TEXT value (RFC 5545 3.3.11)."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def _param(value: str) -> str:
    """A quoted parameter value (RFC 5545 3.2). DQUOTE can't appear inside."""
    return '"' + value.replace('"', "") + '"'


def fold(line: str) -> str:
    """Fold a content line to at most 75 octets per line (RFC 5545 3.1).
    Continuation lines start with a space, which counts toward their 75.
    Never splits a multi-byte UTF-8 character."""
    if len(line.encode()) <= 75:
        return line
    parts: list[str] = []
    current, size, limit = "", 0, 75
    for char in line:
        width = len(char.encode())
        if size + width > limit:
            parts.append(current)
            current, size, limit = "", 0, 74
        current += char
        size += width
    parts.append(current)
    return "\r\n ".join(parts)


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------
def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _when(event: _Row) -> list[str]:
    start = _parse(event["start_time"])
    if event["is_all_day"]:
        # Stored at UK midnight, so the day is the UK date, not the UTC one
        # (midnight in BST is 23:00 the previous day in UTC). DTEND is
        # exclusive: an all-day event ends the next day. Multi-day all-day
        # events are not modelled.
        day = start.astimezone(local_tz()).date()
        return [
            f"DTSTART;VALUE=DATE:{day:%Y%m%d}",
            f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
        ]
    end = _parse(event["end_time"]) if event.get("end_time") else start + DEFAULT_DURATION
    return [f"DTSTART:{_utc(start)}", f"DTEND:{_utc(end)}"]


def _person(prop: str, person: Person, params: str = "") -> str:
    cn = f";CN={_param(person.name)}" if person.name else ""
    return f"{prop}{cn}{params}:mailto:{person.email}"


def event_page(event: _Row, app_url: str) -> str:
    return f"{app_url}/discover/{event['provider_id']}"


def _description(event: _Row, spots: int, app_url: str) -> str:
    parts = [event["description"]] if event.get("description") else []
    organiser = (event.get("provider_profiles") or {}).get("name") or "the organiser"
    parts.append(
        f"Organised by {organiser}. You reserved {spots} {'spot' if spots == 1 else 'spots'}."
    )
    parts.append(event_page(event, app_url))
    return "\n\n".join(parts)


def build_invite(
    *,
    method: Method,
    reservation_id: str,
    sequence: int,
    event: _Row,
    spots: int,
    organizer: Person,
    attendee: Person,
    now: datetime,
    app_url: str,
) -> str:
    """One invite: a VCALENDAR holding the reservation's VEVENT. `event` is a
    provider_events row with its provider_profiles(name)."""
    cancel = method == "CANCEL"
    vevent = [
        "BEGIN:VEVENT",
        f"UID:{uid(reservation_id)}",
        f"DTSTAMP:{_utc(now)}",
        *_when(event),
        f"SEQUENCE:{sequence}",
        f"STATUS:{'CANCELLED' if cancel else 'CONFIRMED'}",
        f"SUMMARY:{escape_text(event['title'])}",
    ]
    if event.get("location"):
        vevent.append(f"LOCATION:{escape_text(event['location'])}")
    vevent += [
        f"DESCRIPTION:{escape_text(_description(event, spots, app_url))}",
        f"URL:{event_page(event, app_url)}",
        # Gmail only applies updates from the organiser: must be the sender.
        _person("ORGANIZER", organizer),
        # Already accepted (they reserved), and no reply wanted: nothing reads
        # mail sent back to the organiser address.
        _person("ATTENDEE", attendee, ";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE"),
        "END:VEVENT",
    ]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//VillageOS//Calendar invite//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        *vevent,
        "END:VCALENDAR",
    ]
    return "".join(f"{fold(line)}\r\n" for line in lines)
