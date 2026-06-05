"""Curated seed events for the public demo.

Dates are computed as offsets from "today" at call time — never hardcoded — so
the demo never rots (per the Today / SSR convention). Each event is a complete,
hand-authored ParentEvent (the golden `.json` files are extraction *assertions*,
not full events, so they aren't reusable here).
"""

from datetime import date, datetime, time, timedelta

from app.schemas.events import ActionItem, EventType, ParentEvent


def _at(today: date, *, days: int, hour: int = 9, minute: int = 0) -> datetime:
    return datetime.combine(today + timedelta(days=days), time(hour, minute))


def build_demo_events(today: date) -> list[ParentEvent]:
    """Three curated events that make the demo calendar look alive:
    a buried-in-a-thread school trip, a birthday with a cost action item,
    and an all-day deadline. All dated relative to `today`.
    """
    return [
        # 1. The "buried in a WhatsApp thread" school trip — the product's reason
        #    to exist. Lands mid-week with a permission slip + payment to chase.
        ParentEvent(
            title="Year 4 trip to the Science Museum",
            event_type=EventType.school,
            start_time=_at(today, days=3, hour=8, minute=45),
            end_time=_at(today, days=3, hour=15, minute=30),
            location="Science Museum, Exhibition Road",
            description=(
                "Coach leaves school at 8:45am sharp. Packed lunch needed, "
                "no nuts. Wear school uniform."
            ),
            action_items=[
                ActionItem(
                    description="Return signed permission slip",
                    urgent=True,
                ),
                ActionItem(
                    description="Pay £12 trip contribution",
                    cost_estimate_gbp=12.0,
                ),
            ],
            confidence=1.0,
        ),
        # 2. Birthday with a cost action item — shows the spend-tracking angle.
        ParentEvent(
            title="Mia's 7th birthday party",
            event_type=EventType.birthday,
            start_time=_at(today, days=5, hour=14, minute=0),
            end_time=_at(today, days=5, hour=16, minute=0),
            location="Jungle Play, Riverside Retail Park",
            description="Drop-off party. RSVP to Mia's mum by text.",
            action_items=[
                ActionItem(
                    description="Buy birthday present",
                    cost_estimate_gbp=15.0,
                ),
                ActionItem(description="Reply to RSVP"),
            ],
            confidence=1.0,
        ),
        # 3. All-day deadline — exercises the is_all_day path and an urgent task.
        ParentEvent(
            title="School photo order deadline",
            event_type=EventType.deadline,
            start_time=_at(today, days=2, hour=0, minute=0),
            is_all_day=True,
            description="Last day to order school photos online before prices rise.",
            action_items=[
                ActionItem(
                    description="Order photos using the code on the proof sheet",
                    urgent=True,
                ),
            ],
            confidence=1.0,
        ),
    ]
