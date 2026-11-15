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


class ProviderEventUpdate(ProviderEventInput):
    """An edit to an existing event. `notify_attendees` is the "Notify
    attendees" box on the edit form: unticked, a time or place change still
    shows as "Updated" in the app but queues no email."""

    notify_attendees: bool = True


class StoredProviderEvent(ProviderEventInput):
    model_config = ConfigDict(extra="ignore")

    id: str
    provider_id: str
    status: ProviderEventStatus
    version: int
    created_at: datetime
    updated_at: datetime


class ListedProviderEvent(StoredProviderEvent):
    """An event in a listing, with how full it is. `my_spots` is the caller's
    own confirmed reservation (0 = not reserved)."""

    spots_taken: int = 0
    my_spots: int = 0
