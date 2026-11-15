"""Sending email, behind one small interface so the provider can be swapped.

Used only for event-change notifications. Sign-up and password emails are sent
by Supabase Auth through its own SMTP and never pass through here.
"""

import logging
from dataclasses import dataclass
from typing import Protocol

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str
    # Where the recipient turns these emails off. Sent as the List-Unsubscribe
    # header, which mail clients show as an "Unsubscribe" link.
    unsubscribe_url: str


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
            },
        )


class SesSender:
    """Amazon SES (API v2). The Lambda's role needs ses:SendEmail on the
    sending identity; the region comes from the Lambda environment."""

    def __init__(self, from_address: str) -> None:
        self._from = from_address
        self._client = boto3.client("sesv2")

    def send(self, message: EmailMessage) -> None:
        self._client.send_email(
            FromEmailAddress=self._from,
            Destination={"ToAddresses": [message.to]},
            Content={
                "Simple": {
                    "Subject": {"Data": message.subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": message.text, "Charset": "UTF-8"}},
                    "Headers": [
                        {"Name": "List-Unsubscribe", "Value": f"<{message.unsubscribe_url}>"},
                    ],
                }
            },
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
