"""The worker loop: each due row goes to its handler; a send is recorded and
the row closed; a failure is counted against the row and the run carries on.
Database calls are replaced with recorders."""

from datetime import UTC, datetime
from typing import Any

import pytest

from app.notifications import outbox, worker
from app.notifications.types import Context, Decision, Recipient
from app.services.email import EmailMessage
from app.services.ics import Person

CTX = Context(
    now=datetime(2026, 11, 16, 12, 0, tzinfo=UTC),
    app_url="https://app.example",
    organizer=Person("events@notify.villageos.co.uk", "VillageOS"),
)
MESSAGE = EmailMessage(to="p@example.com", subject="s", text="t", unsubscribe_url="u")


class Sender:
    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.sent.append(message)


@pytest.fixture
def calls(monkeypatch) -> list[tuple[Any, ...]]:
    log: list[tuple[Any, ...]] = []
    rows = [{"id": "send"}, {"id": "skip"}, {"id": "boom"}]
    monkeypatch.setattr(outbox, "due", lambda db, now: rows)
    monkeypatch.setattr(outbox, "recipient", lambda db, row: Recipient(True, "p@example.com"))
    monkeypatch.setattr(
        outbox, "record_sent", lambda db, row, update: log.append(("record", row["id"], update))
    )
    monkeypatch.setattr(
        outbox, "finish", lambda db, row, sent, now: log.append(("finish", row["id"], sent))
    )

    def record_failure(db: Any, row: dict[str, Any], exc: Exception, now: datetime) -> str:
        log.append(("fail", row["id"]))
        return "failed"

    monkeypatch.setattr(outbox, "record_failure", record_failure)

    def handler(db: Any, row: dict[str, Any], recipient: Recipient, ctx: Context) -> Decision:
        if row["id"] == "boom":
            raise RuntimeError("provider down")
        if row["id"] == "send":
            return Decision(MESSAGE, "booked", reservation_update={"invite_sequence": 1})
        return Decision(None, "up_to_date")

    monkeypatch.setitem(worker.HANDLERS, "calendar", handler)
    return log


def test_sends_records_and_closes_each_row(calls):
    sender = Sender()
    counts = worker.process_due(object(), sender, CTX)  # type: ignore[arg-type]
    assert sender.sent == [MESSAGE]
    assert calls == [
        ("record", "send", {"invite_sequence": 1}),
        ("finish", "send", True),
        ("finish", "skip", False),
        ("fail", "boom"),
    ]
    assert counts == {"booked": 1, "up_to_date": 1, "failed": 1}
