from datetime import UTC, datetime
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EventType(StrEnum):
    school = "school"
    sport = "sport"
    birthday = "birthday"
    fundraiser = "fundraiser"
    meeting = "meeting"
    deadline = "deadline"
    other = "other"


class ActionItem(BaseModel):
    description: str
    cost_estimate_gbp: float | None = None
    urgent: bool = False
    done: bool = False

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("action item description cannot be empty")
        return v


class StoredActionItem(ActionItem):
    model_config = ConfigDict(extra="ignore")

    id: str


class ActionItemUpdate(BaseModel):
    done: bool


class ParentEvent(BaseModel):
    title: str = Field(..., description="Short title, max 60 chars")
    event_type: EventType
    start_time: datetime = Field(
        ...,
        description="ISO 8601. Infer year from context; default to next occurrence if ambiguous",
    )
    end_time: datetime | None = None
    is_all_day: bool = False
    location: str | None = None
    description: str | None = Field(None, description="Up to a few sentences, max 240 chars")
    action_items: list[ActionItem] = []
    confidence: float = Field(..., ge=0.0, le=1.0, description="Extraction confidence, 0 to 1")

    @field_validator("title")
    @classmethod
    def title_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title cannot be empty")
        if len(v) > 60:
            raise ValueError("title must be 60 characters or fewer")
        return v

    @field_validator("description")
    @classmethod
    def description_clean(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 240:
            raise ValueError("description must be 240 characters or fewer")
        return v or None

    @field_validator("start_time")
    @classmethod
    def start_time_sane(cls, v: datetime) -> datetime:
        v_aware = v.replace(tzinfo=UTC) if v.tzinfo is None else v
        if v_aware.year < 2000:
            raise ValueError("start_time year is suspiciously far in the past")
        return v

    @model_validator(mode="after")
    def end_after_start(self) -> Self:
        if self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class StoredEvent(ParentEvent):
    model_config = ConfigDict(extra="ignore")

    id: str
    # Pydantic supports narrowing a field's type in a subclass; mypy flags it
    # because list is invariant, but nothing writes ActionItems through the base.
    action_items: list[StoredActionItem] = []  # type: ignore[assignment]


class ExtractRequest(BaseModel):
    raw_text: str = Field(..., min_length=10, max_length=8000)


class ExperimentInfo(BaseModel):
    """Which A/B arm produced this extraction. Surfaced so the web client can tag
    its funnel events with the server-authoritative variant (see move 1)."""

    flag: str
    variant: str  # "control" | "treatment"
    provider: str | None = None  # "groq" | "openai"
    model: str | None = None


class ExtractResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    event: ParentEvent
    model_used: str
    tokens_used: int
    experiment: ExperimentInfo | None = None
