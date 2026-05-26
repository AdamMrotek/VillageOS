from datetime import date, datetime, time

from app.schemas.events import EventType, ParentEvent
from app.schemas.extraction_draft import ParentEventDraft
from app.services.extraction_date import (
    build_date_table,
    combine_to_datetime,
    draft_to_event,
)

# Eval's frozen "today" — Sunday 2026-05-10.
SUNDAY = date(2026, 5, 10)


class TestBuildDateTable:
    def test_seven_rows_with_today_marker(self):
        table = build_date_table(SUNDAY)
        lines = table.splitlines()
        assert len(lines) == 7
        # First row covers today and is marked.
        assert "Sunday = 2026-05-10" in lines[0]
        assert "(today)" in lines[0]
        # Last row is today + 6 days.
        assert "Saturday = 2026-05-16" in lines[6]
        assert "(today)" not in lines[6]

    def test_custom_days_param(self):
        assert len(build_date_table(SUNDAY, days=3).splitlines()) == 3


class TestCombineToDatetime:
    def test_with_literal_time(self):
        assert combine_to_datetime(date(2026, 5, 15), time(12, 0), EventType.school) == datetime(
            2026, 5, 15, 12, 0
        )

    def test_school_default_time(self):
        assert combine_to_datetime(date(2026, 5, 15), None, EventType.school) == datetime(
            2026, 5, 15, 9, 0
        )

    def test_non_school_default_time(self):
        assert combine_to_datetime(date(2026, 5, 16), None, EventType.sport) == datetime(
            2026, 5, 16, 10, 0
        )


class TestDraftToEvent:
    def _make_draft(self, **overrides) -> ParentEventDraft:
        base = dict(
            title="Test event",
            event_type=EventType.school,
            start_date=date(2026, 5, 15),
            start_time_literal=time(12, 0),
            confidence=0.9,
        )
        base.update(overrides)
        return ParentEventDraft(**base)

    def test_combines_date_and_time_into_parent_event(self):
        event = draft_to_event(self._make_draft())
        assert isinstance(event, ParentEvent)
        assert event.start_time == datetime(2026, 5, 15, 12, 0)
        assert event.title == "Test event"
        assert event.event_type == EventType.school

    def test_default_time_applied_when_time_omitted(self):
        draft = self._make_draft(
            start_date=date(2026, 6, 5),
            start_time_literal=None,
        )
        event = draft_to_event(draft)
        # School default time applies when literal time omitted.
        assert event.start_time == datetime(2026, 6, 5, 9, 0)

    def test_iso_string_coerces_to_date(self):
        # Pydantic should accept ISO date strings — that's what the LLM emits.
        draft = ParentEventDraft.model_validate(
            {
                "title": "Football",
                "event_type": "sport",
                "start_date": "2026-05-16",
                "start_time_literal": "09:00",
                "confidence": 0.9,
            }
        )
        assert draft.start_date == date(2026, 5, 16)
        event = draft_to_event(draft)
        assert event.start_time == datetime(2026, 5, 16, 9, 0)
