"""The notification worker's pure parts: which calendar email a due row
calls for, what it says, and how a failed try is counted. Queueing is tested
in supabase/tests/provider_events.sh; the invite text in test_ics.py."""

from datetime import UTC, datetime, timedelta
from typing import Any

from app.notifications import calendar_sync, messages, outbox, worker
from app.notifications.types import Context, Decision, Recipient
from app.services import ics
from app.services.email import EmailMessage

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
APP = "https://villageos.co.uk"
ORGANIZER = ics.Person("events@notify.villageos.co.uk", "VillageOS")


def _state(**overrides: Any) -> dict[str, Any]:
    state = {
        "start_time": "2026-11-20T16:00:00+00:00",
        "end_time": "2026-11-20T17:00:00+00:00",
        "is_all_day": False,
        "location": "Riverside Pitch 2",
        "status": "published",
    }
    state.update(overrides)
    return state


def _row(
    reservation_status: str = "confirmed",
    invite_version: int | None = 1,
    invite_sequence: int = 1,
    **event: Any,
) -> dict[str, Any]:
    return {
        "id": "outbox-1",
        "pending_since": "2026-11-14T11:00:00+00:00",
        "reservations": {
            "id": "reservation-1",
            "user_id": "parent-1",
            "status": reservation_status,
            "spots": 2,
            "invite_sequence": invite_sequence,
            "invite_version": invite_version,
        },
        "provider_events": {
            "id": "event-1",
            "provider_id": "provider-1",
            "title": "U9 Football Training",
            "description": None,
            "version": 2,
            "provider_profiles": {"name": "Riverside FC"},
            **_state(**event),
        },
    }


def _decide(
    row: dict[str, Any],
    previous: dict[str, Any] | None = None,
    *,
    wants_email: bool = True,
    now: datetime = NOW,
) -> Decision:
    return calendar_sync.decide(
        row=row,
        previous=previous,
        recipient=Recipient(wants_email, "parent@example.com" if wants_email else None),
        ctx=Context(now=now, app_url=APP, organizer=ORGANIZER),
    )


def _sent(decision: Decision) -> EmailMessage:
    assert decision.message is not None, decision.reason
    return decision.message


def _method(message: EmailMessage) -> str:
    assert message.calendar is not None
    assert f"METHOD:{message.calendar.method}\r\n" in message.calendar.ics
    return message.calendar.method


class TestDescribeChanges:
    def test_time_change(self):
        lines = messages.describe_changes(
            _state(), _state(start_time="2026-11-20T17:00:00+00:00", end_time=None)
        )
        assert lines == ["When: Fri 20 Nov 2026, 17:00 (was Fri 20 Nov 2026, 16:00 – 17:00)"]

    def test_location_change(self):
        lines = messages.describe_changes(_state(), _state(location="Sports Hall"))
        assert lines == ["Where: Sports Hall (was Riverside Pitch 2)"]

    def test_cancellation_replaces_every_other_line(self):
        lines = messages.describe_changes(
            _state(), _state(status="cancelled", location="Elsewhere")
        )
        assert lines == ["This event has been cancelled."]

    def test_nothing_changed(self):
        assert messages.describe_changes(_state(), _state()) == []

    def test_times_are_written_in_uk_time(self):
        # 15:00 UTC in July is 16:00 British Summer Time.
        when = messages.format_when(_state(start_time="2026-07-20T15:00:00+00:00", end_time=None))
        assert when == "Mon 20 Jul 2026, 16:00"

    def test_all_day(self):
        when = messages.format_when(_state(start_time="2026-11-20T00:00:00+00:00", is_all_day=True))
        assert when == "Fri 20 Nov 2026, all day"


class TestFirstInvite:
    def test_a_new_reservation_gets_an_invite(self):
        decision = _decide(_row(invite_version=None, invite_sequence=0))
        message = _sent(decision)
        assert decision.reason == "booked"
        assert message.to == "parent@example.com"
        assert message.subject == "Booked: U9 Football Training"
        assert "You've reserved 2 spots with Riverside FC." in message.text
        assert "When: Fri 20 Nov 2026, 16:00 – 17:00" in message.text
        assert "Where: Riverside Pitch 2" in message.text
        assert _method(message) == "REQUEST"
        assert "SEQUENCE:0\r\n" in message.calendar.ics  # type: ignore[union-attr]

    def test_the_reservation_then_records_the_version_and_next_sequence(self):
        decision = _decide(_row(invite_version=None, invite_sequence=0))
        assert decision.reservation_update == {"invite_sequence": 1, "invite_version": 2}

    def test_an_event_cancelled_before_the_invite_went_out_sends_nothing(self):
        decision = _decide(_row(invite_version=None, status="cancelled"))
        assert (decision.message, decision.reason) == (None, "cancelled_before_invite")

    def test_a_re_reservation_already_in_the_calendar_sends_nothing(self):
        # A spot-count change re-queues the row; the calendar is already right.
        decision = _decide(_row(invite_version=2))
        assert (decision.message, decision.reason) == (None, "up_to_date")


class TestUpdates:
    def test_a_moved_event_sends_one_update_saying_what_moved(self):
        decision = _decide(
            _row(start_time="2026-11-20T17:00:00+00:00", end_time=None, invite_sequence=3),
            _state(),
        )
        message = _sent(decision)
        assert decision.reason == "updated"
        assert message.subject == "Updated: U9 Football Training"
        assert "Riverside FC has changed an event you reserved." in message.text
        assert "When: Fri 20 Nov 2026, 17:00 (was Fri 20 Nov 2026, 16:00 – 17:00)" in message.text
        assert _method(message) == "REQUEST"
        assert "SEQUENCE:3\r\n" in message.calendar.ics  # type: ignore[union-attr]
        assert decision.reservation_update == {"invite_sequence": 4, "invite_version": 2}

    def test_a_cancellation_takes_it_off_the_calendar(self):
        decision = _decide(_row(status="cancelled"), _state())
        message = _sent(decision)
        assert decision.reason == "cancelled"
        assert message.subject == "Cancelled: U9 Football Training"
        assert "Riverside FC has cancelled an event you reserved." in message.text
        assert _method(message) == "CANCEL"
        assert decision.reservation_update == {"invite_sequence": 2, "invite_version": None}

    def test_an_edit_that_was_reverted_sends_nothing(self):
        decision = _decide(_row(), _state())
        assert (decision.message, decision.reason) == (None, "reverted")

    def test_without_the_previous_state_nothing_is_guessed(self):
        decision = _decide(_row(location="Sports Hall"), None)
        assert (decision.message, decision.reason) == (None, "no_previous_state")


class TestParentCancels:
    def test_a_cancelled_reservation_withdraws_the_invite(self):
        decision = _decide(_row("cancelled"))
        message = _sent(decision)
        assert decision.reason == "withdrawn"
        assert message.subject == "Reservation cancelled: U9 Football Training"
        assert "You cancelled your reservation with Riverside FC." in message.text
        assert _method(message) == "CANCEL"
        assert decision.reservation_update == {"invite_sequence": 2, "invite_version": None}

    def test_cancelling_before_the_invite_went_out_sends_nothing(self):
        decision = _decide(_row("cancelled", invite_version=None))
        assert (decision.message, decision.reason) == (None, "not_in_calendar")


class TestSkips:
    def test_every_email_says_how_to_turn_them_off(self):
        message = _sent(_decide(_row(location="Sports Hall"), _state()))
        assert message.unsubscribe_url == f"{APP}/settings"
        assert f"Turn these emails off (your calendar then stops updating): {APP}/settings" in (
            message.text
        )

    def test_a_parent_who_opted_out_gets_nothing(self):
        decision = _decide(_row(location="Sports Hall"), _state(), wants_email=False)
        assert (decision.message, decision.reason) == (None, "opted_out")

    def test_a_change_to_a_past_event_sends_nothing(self):
        decision = _decide(_row(location="Sports Hall"), _state(), now=NOW + timedelta(days=30))
        assert (decision.message, decision.reason) == (None, "event_past")

    def test_a_row_whose_event_is_gone_is_skipped(self):
        row = _row()
        row["provider_events"] = None
        assert _decide(row, _state()).reason == "missing"


class TestOrganizer:
    def test_is_the_sending_address_with_its_name(self):
        assert worker.organizer_from("VillageOS <events@notify.villageos.co.uk>") == (
            ics.Person("events@notify.villageos.co.uk", "VillageOS")
        )

    def test_a_bare_address_has_no_name(self):
        assert worker.organizer_from("events@notify.villageos.co.uk") == (
            ics.Person("events@notify.villageos.co.uk")
        )


class TestFailureUpdate:
    def test_a_failed_try_is_counted_and_the_row_stays_pending(self):
        update = outbox.failure_update(attempts=0, error="timeout", now=NOW)
        assert update == {"attempts": 1, "last_error": "timeout"}

    def test_the_last_allowed_try_dead_letters_the_row(self):
        update = outbox.failure_update(
            attempts=outbox.MAX_ATTEMPTS - 1, error="bad address", now=NOW
        )
        assert update == {
            "attempts": outbox.MAX_ATTEMPTS,
            "last_error": "bad address",
            "status": "failed",
            "failed_at": NOW.isoformat(),
        }

    def test_a_long_error_is_cut_short(self):
        update = outbox.failure_update(attempts=0, error="x" * 2000, now=NOW)
        assert len(update["last_error"]) == 500
