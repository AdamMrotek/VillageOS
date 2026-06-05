from datetime import date

from app.schemas.events import EventType
from app.services.demo_seed import build_demo_events

TODAY = date(2026, 6, 5)


class TestBuildDemoEvents:
    def test_returns_a_handful_of_events(self):
        events = build_demo_events(TODAY)
        assert 3 <= len(events) <= 4

    def test_all_dates_are_today_or_later(self):
        # The whole point of relative dating — the demo must never ship a past
        # event. Guards against a regression to hardcoded dates.
        for event in build_demo_events(TODAY):
            assert event.start_time.date() >= TODAY

    def test_dates_are_relative_to_argument(self):
        # Same fixture, a week later → every start_time shifts by a week.
        a = build_demo_events(TODAY)
        b = build_demo_events(date(2026, 6, 12))
        for ea, eb in zip(a, b, strict=True):
            assert (eb.start_time - ea.start_time).days == 7

    def test_showcases_the_product(self):
        events = build_demo_events(TODAY)
        types = {e.event_type for e in events}
        # A buried school event, a birthday, and an all-day deadline.
        assert {EventType.school, EventType.birthday, EventType.deadline} <= types
        assert any(e.is_all_day for e in events)
        # At least one cost action item (the spend-tracking angle).
        assert any(item.cost_estimate_gbp for e in events for item in e.action_items)

    def test_events_are_high_confidence(self):
        # Curated, not extracted — confidence is pinned to 1.0.
        assert all(e.confidence == 1.0 for e in build_demo_events(TODAY))
