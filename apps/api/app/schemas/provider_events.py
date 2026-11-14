from datetime import datetime
from enum import StrEnum

from pydantic import ConfigDict, Field

from app.schemas.events import EventCore


class ProviderEventStatus(StrEnum):
    draft = "draft"
    published = "published"
    cancelled = "cancelled"


class ProviderEventInput(EventCore):
    """What a provider edits about an event. Status is not editable here — it
    only moves through the publish / unpublish / cancel endpoints."""

    capacity: int | None = Field(None, gt=0, description="Spots available; null = unlimited")


class StoredProviderEvent(ProviderEventInput):
    model_config = ConfigDict(extra="ignore")

    id: str
    provider_id: str
    status: ProviderEventStatus
    version: int
    created_at: datetime
    updated_at: datetime
