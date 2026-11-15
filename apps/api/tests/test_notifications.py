"""The notification worker's decisions: when a pending row becomes an email,
and what the email says. Queuing (one pending row per reservation, in the
provider's transaction) is the database's job — supabase/tests/provider_events.sh.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from app.services import notifications
from app.services.email import EmailMessage

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
APP = "https://villageos.co.uk"


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


def _row(reservation_status: str = "confirmed", **event: Any) -> dict[str, Any]:
    return {
        "id": "outbox-1",
        "from_version": 1,
        "pending_since": "2026-11-14T11:00:00+00:00",
        "reservations": {"user_id": "parent-1", "status": reservation_status},
        "provider_events": {
            "id": "event-1",
            "title": "U9 Football Training",
            "version": 2,
            "provider_profiles": {"name": "Riverside FC"},
            **_state(**event),
        },
    }


def _decide(row: dict[str, Any], previous: dict[str, Any] | None, **kwargs: Any):
    params: dict[str, Any] = {
        "wants_email": True,
        "email": "parent@example.com",
        "now": NOW,
        "app_url": APP,
    }
    params.update(kwargs)
    return notifications.decide(row=row, previous=previous, **params)


def _sent(decision: notifications.Decision) -> EmailMessage:
    assert decision.message is not None, decision.reason
    return decision.message


class TestDescribeChanges:
    def test_time_change(self):
        lines = notifications.describe_changes(
            _state(), _state(start_time="2026-11-20T17:00:00+00:00", end_time=None)
        )
        assert lines == ["When: Fri 20 Nov 2026, 17:00 (was Fri 20 Nov 2026, 16:00 – 17:00)"]

    def test_location_change(self):
        lines = notifications.describe_changes(_state(), _state(location="Sports Hall"))
        assert lines == ["Where: Sports Hall (was Riverside Pitch 2)"]

    def test_cancellation_replaces_every_other_line(self):
        lines = notifications.describe_changes(
            _state(), _state(status="cancelled", location="Elsewhere")
        )
        assert lines == ["This event has been cancelled."]

    def test_nothing_changed(self):
        assert notifications.describe_changes(_state(), _state()) == []

    def test_times_are_written_in_uk_time(self):
        # 15:00 UTC in July is 16:00 British Summer Time.
        when = notifications.format_when(
            _state(start_time="2026-07-20T15:00:00+00:00", end_time=None)
        )
        assert when == "Mon 20 Jul 2026, 16:00"

    def test_all_day(self):
        when = notifications.format_when(
            _state(start_time="2026-11-20T00:00:00+00:00", is_all_day=True)
        )
        assert when == "Fri 20 Nov 2026, all day"


class TestDecide:
    def test_a_moved_event_sends_one_email_saying_what_moved(self):
        message = _sent(
            _decide(_row(start_time="2026-11-20T17:00:00+00:00", end_time=None), _state())
        )
        assert message.to == "parent@example.com"
        assert message.subject == "Updated: U9 Football Training"
        assert "Riverside FC has changed an event you reserved." in message.text
        assert "When: Fri 20 Nov 2026, 17:00 (was Fri 20 Nov 2026, 16:00 – 17:00)" in message.text

    def test_a_cancellation_says_so(self):
        message = _sent(_decide(_row(status="cancelled"), _state()))
        assert message.subject == "Cancelled: U9 Football Training"
        assert "Riverside FC has cancelled an event you reserved." in message.text

    def test_every_email_says_how_to_turn_them_off(self):
        message = _sent(_decide(_row(location="Sports Hall"), _state()))
        assert message.unsubscribe_url == f"{APP}/settings"
        assert f"Turn these emails off: {APP}/settings" in message.text

    def test_an_edit_that_was_reverted_sends_nothing(self):
        decision = _decide(_row(), _state())
        assert decision.message is None
        assert decision.reason == "reverted"

    def test_a_parent_who_opted_out_gets_nothing(self):
        decision = _decide(_row(location="Sports Hall"), _state(), wants_email=False)
        assert (decision.message, decision.reason) == (None, "opted_out")

    def test_a_parent_who_cancelled_their_reservation_gets_nothing(self):
        decision = _decide(_row("cancelled", location="Sports Hall"), _state())
        assert (decision.message, decision.reason) == (None, "reservation_cancelled")

    def test_a_change_to_a_past_event_sends_nothing(self):
        decision = _decide(_row(location="Sports Hall"), _state(), now=NOW + timedelta(days=30))
        assert (decision.message, decision.reason) == (None, "event_past")

    def test_a_row_whose_event_is_gone_is_skipped(self):
        row = _row()
        row["provider_events"] = None
        assert _decide(row, _state()).reason == "missing"
