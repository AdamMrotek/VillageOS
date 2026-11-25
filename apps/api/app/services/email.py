"""Sending email, behind one small interface so the provider can be swapped.
Used by the notification worker only; auth emails go through Supabase's SMTP."""

import logging
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from email.policy import SMTP
from email.utils import formatdate
from typing import Protocol

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CalendarPart:
    """An iCalendar invite carried by the email (RFC 6047)."""

    method: str  # REQUEST or CANCEL; repeated as the MIME `method` parameter
    ics: str


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str
    # Where the recipient turns these emails off. Sent as the List-Unsubscribe
    # header, which mail clients show as an "Unsubscribe" link.
    unsubscribe_url: str
    calendar: CalendarPart | None = None


def to_mime(message: EmailMessage, from_address: str) -> bytes:
    """The email as sent. With a calendar part it is

    multipart/mixed
      multipart/alternative
        text/plain
        text/calendar; method=REQUEST   <- what Gmail and Outlook act on
      invite.ics (attachment)           <- what Apple Mail and others open
    """
    mime = MimeMessage(policy=SMTP)
    mime["From"] = from_address
    mime["To"] = message.to
    mime["Subject"] = message.subject
    mime["Date"] = formatdate(usegmt=True)
    mime["List-Unsubscribe"] = f"<{message.unsubscribe_url}>"
    mime.set_content(message.text)
    if message.calendar:
        cal = message.calendar
        mime.add_alternative(cal.ics, subtype="calendar", params={"method": cal.method})
        mime.add_attachment(
            cal.ics.encode(), maintype="application", subtype="ics", filename="invite.ics"
        )
    return mime.as_bytes()


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None:
        """Send one email. Raises if it could not be handed to the provider."""
        ...


class LogSender:
    """Writes the email to the log instead of sending it. Local development."""

    def send(self, message: EmailMessage) -> None:
        logger.info(
            "email_logged",
            extra={
                "event": "email_logged",
                "to": message.to,
                "subject": message.subject,
                "text": message.text,
                "calendar": message.calendar.ics if message.calendar else None,
            },
        )


class SesSender:
    """Amazon SES (API v2), sending the raw MIME so the calendar part survives.
    The Lambda's role needs ses:SendEmail on the sending identity; the region
    comes from the Lambda environment."""

    def __init__(self, from_address: str) -> None:
        self._from = from_address
        self._client = boto3.client("sesv2")

    def send(self, message: EmailMessage) -> None:
        self._client.send_email(
            FromEmailAddress=self._from,
            Destination={"ToAddresses": [message.to]},
            Content={"Raw": {"Data": to_mime(message, self._from)}},
        )


def get_email_sender() -> EmailSender | None:
    """The configured sender, or None when sending is switched off."""
    settings = get_settings()
    provider = settings.email_provider.lower()
    if provider == "ses":
        return SesSender(settings.email_from)
    if provider == "log":
        return LogSender()
    if provider == "none":
        return None
    raise RuntimeError(f"Unknown EMAIL_PROVIDER: {settings.email_provider!r} (none, log or ses)")
