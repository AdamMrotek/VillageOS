from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.events import ActionItem, EventType


class ParentEventDraft(BaseModel):
    """LLM-facing schema. Resolved to ParentEvent by extraction_date.draft_to_event.

    The LLM is given a 7-day date table in the prompt and emits `start_date` as
    an ISO date string. No discriminated union, no calendar math in Python.
    """

    model_config = ConfigDict(protected_namespaces=())

    title: str
    event_type: EventType
    start_date: date = Field(
        description=(
            "ISO date (YYYY-MM-DD) of the event. Pick from the date table in "
            "the system prompt when the text uses a relative phrase; otherwise "
            "use the explicit calendar date from the text."
        ),
    )
    start_time_literal: Optional[time] = None
    end_time: Optional[datetime] = None
    is_all_day: bool = False
    location: Optional[str] = None
    description: Optional[str] = None
    action_items: list[ActionItem] = []
    confidence: float = Field(ge=0.0, le=1.0)
