"""Emails that tell parents a reserved event changed.

The database queues the work: when a provider makes a material edit, a trigger
writes one `notification_outbox` row per confirmed reservation in the same
transaction (see 20261114020000_provider_event_change_propagation.sql). This
module is the other half — a scheduled worker that turns pending rows into
emails.

Providers edit in bursts, so the worker waits until an event has been quiet for
QUIET_PERIOD, then compares the state the parent was last told about with the
state now and sends at most one email. An edit that was reverted in the
meantime sends nothing.

Delivery is at-least-once: a crash between sending and marking the row can
repeat an email on the next run. It never sends for a change that didn't commit,
and it never silently drops one.

A row that fails is retried on later runs, up to MAX_ATTEMPTS. After that it is
dead-lettered: moved to status `failed` with the last error, where it stays for
someone to look at and no longer holds up newer rows.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from supabase import Client

from app.core.config import get_settings
from app.core.db import get_admin_db
from app.services.email import EmailMessage, EmailSender, get_email_sender

logger = logging.getLogger(__name__)

_Row = dict[str, Any]

# How long an event must go without a further material edit before parents are
# emailed about it.
QUIET_PERIOD = timedelta(minutes=10)

# Rows handled per run. The worker runs every 5 minutes; anything beyond this
# is picked up by the next run.
BATCH_SIZE = 100

# Tries before a row is dead-lettered. At one try per run that is about 25
# minutes, long enough to ride out a short outage at the email provider.
MAX_ATTEMPTS = 5

# Events are local to the UK, so times in an email are written in UK time
# regardless of where the Lambda runs.
_LOCAL_TZ_NAME = "Europe/London"

_OUTBOX_SELECT = (
    "id, from_version, pending_since, attempts, "
    "reservations(user_id, status), "
    "provider_events(id, title, start_time, end_time, is_all_day, location, status, version, "
    "provider_profiles(name))"
)


@dataclass(frozen=True)
class Decision:
    """What to do with one pending row: send `message`, or skip for `reason`."""

    message: EmailMessage | None
    reason: str


def _local_tz() -> ZoneInfo | Any:
    try:
        return ZoneInfo(_LOCAL_TZ_NAME)
    except ZoneInfoNotFoundError:  # no tz database on the host
        return UTC


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def format_when(state: _Row) -> str:
    """ "Fri 20 Nov 2026, 16:00 – 17:00", or "Fri 20 Nov 2026, all day"."""
    tz = _local_tz()
    start = cast(datetime, _parse(state["start_time"])).astimezone(tz)
    day = f"{start:%a} {start.day} {start:%b %Y}"
    if state.get("is_all_day"):
        return f"{day}, all day"
    end = _parse(state.get("end_time"))
    if end is None:
        return f"{day}, {start:%H:%M}"
    end = end.astimezone(tz)
    if end.date() == start.date():
        return f"{day}, {start:%H:%M} – {end:%H:%M}"
    return f"{day}, {start:%H:%M} – {end:%a} {end.day} {end:%b}, {end:%H:%M}"


def describe_changes(previous: _Row, current: _Row) -> list[str]:
    """One line per thing that differs between what the parent was last told
    and the event now. Empty when nothing a parent plans around has changed."""
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


def build_message(*, to: str, event: _Row, changes: list[str], app_url: str) -> EmailMessage:
    cancelled = event["status"] == "cancelled"
    provider = (event.get("provider_profiles") or {}).get("name") or "The organiser"
    title = event["title"]
    settings_url = f"{app_url}/settings"

    intro = (
        f"{provider} has cancelled an event you reserved."
        if cancelled
        else f"{provider} has changed an event you reserved."
    )
    details = [f"When: {format_when(event)}"]
    if event.get("location"):
        details.append(f"Where: {event['location']}")
    # A cancellation states the event as it would have been; a change lists
    # exactly what moved, which already says where and when it is now.
    body = details if cancelled else changes

    text = "\n".join(
        [
            intro,
            "",
            title,
            *body,
            "",
            f"See it in your calendar: {app_url}/calendar",
            "",
            "You are receiving this because you reserved a spot on this event.",
            f"Turn these emails off: {settings_url}",
        ]
    )
    return EmailMessage(
        to=to,
        subject=f"{'Cancelled' if cancelled else 'Updated'}: {title}",
        text=text,
        unsubscribe_url=settings_url,
    )


def decide(
    *,
    row: _Row,
    previous: _Row | None,
    wants_email: bool,
    email: str | None,
    now: datetime,
    app_url: str,
) -> Decision:
    """Whether a pending row becomes an email. Pure — everything it needs is
    passed in, so each rule can be tested without a database."""
    reservation: _Row | None = row.get("reservations")
    event: _Row | None = row.get("provider_events")
    if not reservation or not event:
        return Decision(None, "missing")
    if reservation["status"] != "confirmed":
        return Decision(None, "reservation_cancelled")
    if not wants_email:
        return Decision(None, "opted_out")
    if not email:
        return Decision(None, "no_email")
    if previous is None:
        return Decision(None, "no_previous_state")

    # A change to an event that has already happened is not worth an email.
    start = cast(datetime, _parse(event["start_time"]))
    if start < now - timedelta(days=1):
        return Decision(None, "event_past")

    changes = describe_changes(previous, event)
    if not changes:
        return Decision(None, "reverted")
    return Decision(build_message(to=email, event=event, changes=changes, app_url=app_url), "send")


def _previous_state(db: Client, event_id: str, version: int) -> _Row | None:
    rows = cast(
        list[_Row],
        db.table("provider_event_versions")
        .select("*")
        .eq("event_id", event_id)
        .eq("version", version)
        .execute()
        .data,
    )
    return rows[0] if rows else None


def _wants_email(db: Client, user_id: str) -> bool:
    rows = cast(
        list[_Row],
        db.table("profiles").select("event_emails").eq("id", user_id).execute().data,
    )
    return bool(rows and rows[0]["event_emails"])


def _email_of(db: Client, user_id: str) -> str | None:
    return db.auth.admin.get_user_by_id(user_id).user.email


def _finish(db: Client, row: _Row, *, sent: bool, now: datetime) -> None:
    """Close a row, unless the provider edited the event again while it was
    being handled (`pending_since` moved). Then the row stays pending for the
    newer edit; if an email did go out, `from_version` is advanced so the next
    one only describes what changed since."""
    closed = (
        db.table("notification_outbox")
        .update(
            {"status": "sent" if sent else "skipped", "sent_at": now.isoformat() if sent else None}
        )
        .eq("id", row["id"])
        .eq("status", "pending")
        .eq("pending_since", row["pending_since"])
        .execute()
        .data
    )
    if not closed and sent:
        (
            db.table("notification_outbox")
            .update({"from_version": row["provider_events"]["version"]})
            .eq("id", row["id"])
            .eq("status", "pending")
            .execute()
        )


def failure_update(*, attempts: int, error: str, now: datetime) -> _Row:
    """The outbox columns to write after a failed try. Pure. `attempts` is the
    count before this try; the row is dead-lettered when the limit is reached."""
    attempts += 1
    update: _Row = {"attempts": attempts, "last_error": error[:500]}
    if attempts >= MAX_ATTEMPTS:
        update |= {"status": "failed", "failed_at": now.isoformat()}
    return update


def _record_failure(db: Client, row: _Row, exc: Exception, *, now: datetime) -> str:
    """Count a failed try against the row. Returns the outcome: "failed" (will
    be retried) or "dead" (limit reached, dead-lettered)."""
    update = failure_update(attempts=row.get("attempts") or 0, error=str(exc), now=now)
    dead = update.get("status") == "failed"
    logger.error(
        "notification_dead" if dead else "notification_failed",
        extra={
            "event": "notification_dead" if dead else "notification_failed",
            "outbox_id": row["id"],
            "attempts": update["attempts"],
            "reason": str(exc),
        },
    )
    try:
        (
            db.table("notification_outbox")
            .update(update)
            .eq("id", row["id"])
            .eq("status", "pending")
            .execute()
        )
    except Exception as record_exc:
        # The database is unreachable too: the try goes uncounted and the row
        # stays pending, which is the safe side.
        logger.error(
            "notification_failure_not_recorded",
            extra={
                "event": "notification_failure_not_recorded",
                "outbox_id": row["id"],
                "reason": str(record_exc),
            },
        )
        return "failed"
    return "dead" if dead else "failed"


def process_due(db: Client, sender: EmailSender, *, now: datetime, app_url: str) -> dict[str, int]:
    """Handle every pending notification whose event has gone quiet. Returns
    counts by outcome. A row that fails stays pending and is retried next run,
    until MAX_ATTEMPTS dead-letters it."""
    cutoff = (now - QUIET_PERIOD).isoformat()
    rows = cast(
        list[_Row],
        db.table("notification_outbox")
        .select(_OUTBOX_SELECT)
        .eq("status", "pending")
        .lte("pending_since", cutoff)
        .order("pending_since", desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data,
    )

    counts: dict[str, int] = {}
    for row in rows:
        try:
            reservation: _Row = row.get("reservations") or {}
            event: _Row = row.get("provider_events") or {}
            user_id = reservation.get("user_id")
            wants = bool(user_id) and _wants_email(db, cast(str, user_id))
            decision = decide(
                row=row,
                previous=_previous_state(db, event["id"], row["from_version"]) if event else None,
                wants_email=wants,
                # Only look up the address of someone who will be emailed.
                email=_email_of(db, cast(str, user_id)) if wants else None,
                now=now,
                app_url=app_url,
            )
            if decision.message:
                sender.send(decision.message)
            _finish(db, row, sent=decision.message is not None, now=now)
            outcome = decision.reason
        except Exception as exc:
            outcome = _record_failure(db, row, exc, now=now)
        counts[outcome] = counts.get(outcome, 0) + 1

    logger.info("notifications_processed", extra={"event": "notifications_processed", **counts})
    return counts


def run() -> dict[str, int]:
    """Entry point for the scheduled worker (worker_handler.py)."""
    sender = get_email_sender()
    if sender is None:
        # Sending is switched off: leave the outbox untouched rather than
        # marking rows sent for emails nobody received.
        logger.info("notifications_disabled", extra={"event": "notifications_disabled"})
        return {}
    return process_due(
        get_admin_db(), sender, now=datetime.now(UTC), app_url=get_settings().app_url.rstrip("/")
    )
