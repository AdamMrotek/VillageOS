"""Shapes shared by the notification worker and its handlers."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.email import EmailMessage
from app.services.ics import Person

Row = dict[str, Any]


@dataclass(frozen=True)
class Context:
    """The same for every row in one worker run."""

    now: datetime
    app_url: str
    organizer: Person  # the sender; also every invite's ORGANIZER


@dataclass(frozen=True)
class Recipient:
    """The parent a row is about. `email` is only looked up when they want email."""

    wants_email: bool
    email: str | None


@dataclass(frozen=True)
class Decision:
    """A handler's answer for one row: send `message`, or skip. `reason` is
    the outcome counted in the worker's log line."""

    message: EmailMessage | None
    reason: str
    # Written to the row's reservation once `message` has been sent.
    reservation_update: Row | None = None
