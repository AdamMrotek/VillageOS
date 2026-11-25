"""The scheduled notification worker (worker_handler.py, every minute): send
what each due outbox row calls for. PROVIDERS.md#notifications."""

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from email.utils import parseaddr

from supabase import Client

from app.core.config import get_settings
from app.core.db import get_admin_db
from app.notifications import calendar_sync, outbox
from app.notifications.types import Context, Decision, Recipient, Row
from app.services.email import EmailSender, get_email_sender
from app.services.ics import Person

logger = logging.getLogger(__name__)

Handler = Callable[[Client, Row, Recipient, Context], Decision]

# One handler per kind of outbox row. Every row is "calendar" until the outbox
# has a `kind` column (PROVIDERS.md#adding-a-notification).
HANDLERS: dict[str, Handler] = {"calendar": calendar_sync.handle}


def process_due(db: Client, sender: EmailSender, ctx: Context) -> dict[str, int]:
    """Handle every due row. Returns how many ended in each outcome."""
    counts: dict[str, int] = {}
    for row in outbox.due(db, ctx.now):
        try:
            handle = HANDLERS[row.get("kind") or "calendar"]
            decision = handle(db, row, outbox.recipient(db, row), ctx)
            if decision.message:
                sender.send(decision.message)
                outbox.record_sent(db, row, decision.reservation_update)
            outbox.finish(db, row, sent=decision.message is not None, now=ctx.now)
            outcome = decision.reason
        except Exception as exc:
            outcome = outbox.record_failure(db, row, exc, now=ctx.now)
        counts[outcome] = counts.get(outcome, 0) + 1

    logger.info("notifications_processed", extra={"event": "notifications_processed", **counts})
    return counts


def organizer_from(email_from: str) -> Person:
    """The sending address and its display name, e.g. from
    "VillageOS <events@notify.villageos.co.uk>"."""
    name, address = parseaddr(email_from)
    return Person(address, name or None)


def run() -> dict[str, int]:
    """Entry point for worker_handler.py."""
    sender = get_email_sender()
    if sender is None:
        # Sending is off: leave the outbox pending rather than marking rows
        # sent for emails nobody received.
        logger.info("notifications_disabled", extra={"event": "notifications_disabled"})
        return {}
    settings = get_settings()
    ctx = Context(
        now=datetime.now(UTC),
        app_url=settings.app_url.rstrip("/"),
        organizer=organizer_from(settings.email_from),
    )
    return process_due(get_admin_db(), sender, ctx)
