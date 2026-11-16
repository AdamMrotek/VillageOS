"""Every database read and write the notification worker makes: the
`notification_outbox` queue, and what handlers need to look up or record."""

import logging
from datetime import datetime
from typing import cast

from supabase import Client

from app.notifications.types import Recipient, Row

logger = logging.getLogger(__name__)

# Rows handled per run; the rest wait for the next run (every minute).
BATCH_SIZE = 100

# Tries before a row is dead-lettered: about 25 minutes at one try per run.
MAX_ATTEMPTS = 25

# Everything the handlers read from a row. A new handler that needs more adds
# it here.
_SELECT = (
    "id, pending_since, attempts, "
    "reservations(id, user_id, status, spots, invite_sequence, invite_version), "
    "provider_events(id, provider_id, title, description, start_time, end_time, "
    "is_all_day, location, status, version, provider_profiles(name))"
)


def due(db: Client, now: datetime) -> list[Row]:
    """Pending rows whose time has come, oldest first."""
    return cast(
        list[Row],
        db.table("notification_outbox")
        .select(_SELECT)
        .eq("status", "pending")
        .lte("due_at", now.isoformat())
        .order("due_at", desc=False)
        .limit(BATCH_SIZE)
        .execute()
        .data,
    )


def recipient(db: Client, row: Row) -> Recipient:
    """The reservation's owner: their email preference, and their address if
    they want email (nobody else's address is looked up)."""
    user_id = (row.get("reservations") or {}).get("user_id")
    if not user_id:
        return Recipient(False, None)
    prefs = cast(
        list[Row], db.table("profiles").select("event_emails").eq("id", user_id).execute().data
    )
    if not (prefs and prefs[0]["event_emails"]):
        return Recipient(False, None)
    return Recipient(True, db.auth.admin.get_user_by_id(user_id).user.email)


def event_at_version(db: Client, event_id: str, version: int) -> Row | None:
    """A provider event's material fields as they were at `version`."""
    rows = cast(
        list[Row],
        db.table("provider_event_versions")
        .select("*")
        .eq("event_id", event_id)
        .eq("version", version)
        .execute()
        .data,
    )
    return rows[0] if rows else None


def record_sent(db: Client, row: Row, reservation_update: Row | None) -> None:
    reservation_id = (row.get("reservations") or {}).get("id")
    if reservation_update and reservation_id:
        db.table("reservations").update(reservation_update).eq("id", reservation_id).execute()


def finish(db: Client, row: Row, *, sent: bool, now: datetime) -> None:
    """Close the row, unless it was queued again while being handled
    (`pending_since` moved): then it stays pending for the next run."""
    (
        db.table("notification_outbox")
        .update(
            {"status": "sent" if sent else "skipped", "sent_at": now.isoformat() if sent else None}
        )
        .eq("id", row["id"])
        .eq("status", "pending")
        .eq("pending_since", row["pending_since"])
        .execute()
    )


def failure_update(*, attempts: int, error: str, now: datetime) -> Row:
    """Pure. The columns to write after a failed try; `attempts` is the count
    before it. Reaching MAX_ATTEMPTS dead-letters the row."""
    attempts += 1
    update: Row = {"attempts": attempts, "last_error": error[:500]}
    if attempts >= MAX_ATTEMPTS:
        update |= {"status": "failed", "failed_at": now.isoformat()}
    return update


def record_failure(db: Client, row: Row, exc: Exception, *, now: datetime) -> str:
    """Count a failed try. Returns "failed" (retried next run) or "dead"."""
    update = failure_update(attempts=row.get("attempts") or 0, error=str(exc), now=now)
    outcome = "dead" if update.get("status") == "failed" else "failed"
    event = f"notification_{outcome}"
    logger.error(
        event,
        extra={
            "event": event,
            "outbox_id": row["id"],
            "attempts": update["attempts"],
            "reason": str(exc),
        },
    )
    # If this write fails too, the database is down: the run stops here and
    # every row is still pending for the next one.
    (
        db.table("notification_outbox")
        .update(update)
        .eq("id", row["id"])
        .eq("status", "pending")
        .execute()
    )
    return outcome
