"""Reserved provider events on the parent's calendar, and the mapping from the
database's rule violations to HTTP errors.

The rules themselves (capacity under a row lock, who may read what) live in
Postgres and are tested there: supabase/tests/provider_events.sh.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.schemas.events import StoredEvent
from app.services import reservations
from app.services.db_errors import db_rules

PROVIDER = "11111111-1111-1111-1111-111111111111"
EVENT = "55555555-5555-5555-5555-555555555555"


def _reservation(**event_overrides: Any) -> dict[str, Any]:
    event = {
        "id": EVENT,
        "provider_id": PROVIDER,
        "title": "U9 Football Training",
        "event_type": "sport",
        "start_time": "2026-11-20T16:00:00+00:00",
        "end_time": "2026-11-20T17:00:00+00:00",
        "is_all_day": False,
        "location": "Riverside Pitch 2",
        "description": None,
        "capacity": 20,
        "status": "published",
        "version": 1,
        "provider_profiles": {"name": "Riverside FC"},
    }
    event.update(event_overrides)
    return {"id": "res-1", "spots": 2, "seen_version": 1, "provider_events": event}


class TestCalendarEvent:
    def test_reads_as_a_read_only_provider_event(self):
        event = reservations.to_calendar_event(_reservation(), None)
        assert event.id == EVENT
        assert event.source == "provider"
        assert event.action_items == []
        assert event.reservation is not None
        assert event.reservation.spots == 2
        assert event.reservation.provider_name == "Riverside FC"
        assert event.reservation.updated is False
        assert event.reservation.cancelled is False

    def test_is_flagged_updated_while_the_parent_is_behind(self):
        previous = {
            "start_time": "2026-11-20T15:00:00+00:00",
            "end_time": "2026-11-20T16:00:00+00:00",
            "is_all_day": False,
            "location": "Riverside Pitch 2",
            "status": "published",
        }
        event = reservations.to_calendar_event(_reservation(version=2), previous)
        assert event.reservation is not None
        assert event.reservation.updated is True
        assert event.reservation.previous is not None
        assert event.reservation.previous.start_time == datetime(2026, 11, 20, 15, tzinfo=UTC)

    def test_a_cancelled_event_stays_on_the_calendar(self):
        event = reservations.to_calendar_event(_reservation(status="cancelled", version=2), None)
        assert event.reservation is not None
        assert event.reservation.cancelled is True

    def test_tolerates_a_provider_without_a_name(self):
        event = reservations.to_calendar_event(_reservation(provider_profiles=None), None)
        assert event.reservation is not None
        assert event.reservation.provider_name is None

    def test_own_events_default_to_source_own(self):
        own = StoredEvent.model_validate(
            {
                "id": "e1",
                "title": "Dentist",
                "event_type": "other",
                "start_time": "2026-11-20T09:00:00",
                "confidence": 0.9,
            }
        )
        assert own.source == "own"
        assert own.reservation is None

    def test_both_sources_sort_together(self):
        # An own event stored without an offset still sorts against a
        # provider event that has one.
        own = StoredEvent.model_validate(
            {
                "id": "e1",
                "title": "Dentist",
                "event_type": "other",
                "start_time": "2026-11-20T18:00:00",
                "confidence": 0.9,
            }
        )
        reserved = reservations.to_calendar_event(_reservation(), None)
        ordered = sorted([own, reserved], key=reservations.sort_key)
        assert [e.title for e in ordered] == ["U9 Football Training", "Dentist"]


class TestDbRules:
    @pytest.mark.parametrize(
        ("key", "status"),
        [
            ("event_full", 409),
            ("event_not_bookable", 409),
            ("event_not_found", 404),
            ("reservation_not_found", 404),
            ("sign_in_required", 403),
            ("event_has_reservations", 409),
            ("capacity_below_reserved", 409),
        ],
    )
    def test_a_rule_violation_becomes_its_http_error(self, key: str, status: int):
        with pytest.raises(HTTPException) as exc, db_rules():
            raise APIError({"message": key, "code": "P0001"})
        assert exc.value.status_code == status

    def test_other_database_errors_are_not_swallowed(self):
        with pytest.raises(APIError), db_rules():
            raise APIError({"message": "connection reset", "code": "08006"})
