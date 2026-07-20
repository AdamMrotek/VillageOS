from datetime import date, datetime, time, timedelta

from app.schemas.events import EventType, ParentEvent
from app.schemas.extraction_draft import ParentEventDraft

DATE_TABLE_DAYS = 7

_DEFAULT_TIMES: dict[EventType, time] = {
    EventType.school: time(9, 0),
}
_FALLBACK_TIME = time(10, 0)


def build_date_table(today: date, days: int = DATE_TABLE_DAYS) -> str:
    """Render today + next (days-1) days as a compact ISO/weekday list for the prompt."""
    lines: list[str] = []
    for i in range(days):
        d = today + timedelta(days=i)
        suffix = "  (today)" if i == 0 else ""
        lines.append(f"  {d.strftime('%A')} = {d.isoformat()}{suffix}")
    return "\n".join(lines)


def combine_to_datetime(d: date, t: time | None, event_type: EventType) -> datetime:
    if t is None:
        t = _DEFAULT_TIMES.get(event_type, _FALLBACK_TIME)
    return datetime.combine(d, t)


def draft_to_event(draft: ParentEventDraft) -> ParentEvent:
    # The draft shares every field with ParentEvent except its loose date/time
    # pair, which combine_to_datetime resolves into start_time. Everything else
    # passes straight through, so dump-and-splat rather than restate each field.
    passthrough = draft.model_dump(exclude={"start_date", "start_time_literal"})
    return ParentEvent(
        **passthrough,
        start_time=combine_to_datetime(
            draft.start_date, draft.start_time_literal, draft.event_type
        ),
    )
