from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing_extensions import Self


class EventType(str, Enum):
    school     = "school"
    sport      = "sport"
    birthday   = "birthday"
    fundraiser = "fundraiser"
    meeting    = "meeting"
    deadline   = "deadline"
    other      = "other"


class ActionItem(BaseModel):
    description: str
    cost_estimate_gbp: Optional[float] = None
    urgent: bool = False

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


class ParentEvent(BaseModel):
    title: str               = Field(..., description="Short title, max 60 chars")
    event_type: EventType
    start_time: datetime     = Field(..., description="ISO 8601. Infer year from context; default to next occurrence if ambiguous")
    end_time: Optional[datetime] = None
    is_all_day: bool         = False
    location: Optional[str]  = None
    description: Optional[str] = Field(None, description="One sentence summary, max 120 chars")
    action_items: list[ActionItem] = []
    confidence: float        = Field(..., ge=0.0, le=1.0, description="Extraction confidence, 0 to 1")

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
    def description_clean(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 120:
            raise ValueError("description must be 120 characters or fewer")
        return v or None

    @field_validator("start_time")
    @classmethod
    def start_time_sane(cls, v: datetime) -> datetime:
        v_aware = v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v
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
    action_items: list[StoredActionItem] = []


class ExtractRequest(BaseModel):
    raw_text: str = Field(..., min_length=10, max_length=8000)


class ExtractResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    event: ParentEvent
    model_used: str
    tokens_used: int
