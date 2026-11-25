"""The Discover home page (docs/PROVIDER_EVENTS_PLAN.md §4).

The page renders whatever rows the API returns, in order, so adding,
reordering or personalising rows never needs a frontend change.
"""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.provider_events import ListedProviderEvent
from app.schemas.providers import ProviderCategory, StoredProviderProfile


class DiscoverKind(StrEnum):
    """The kind chips at the top of the page."""

    all = "all"
    event = "event"
    venue = "venue"
    entertainer = "entertainer"


class DiscoverEvent(ListedProviderEvent):
    """An event card: the event, how full it is, and who runs it."""

    provider_name: str | None = None
    provider_category: ProviderCategory | None = None


class EventRow(BaseModel):
    id: str
    title: str
    item_type: Literal["event"] = "event"
    items: list[DiscoverEvent]


class ProviderRow(BaseModel):
    id: str
    title: str
    item_type: Literal["provider"] = "provider"
    items: list[StoredProviderProfile]


DiscoverRow = Annotated[EventRow | ProviderRow, Field(discriminator="item_type")]


class FeaturedEvent(BaseModel):
    item_type: Literal["event"] = "event"
    item: DiscoverEvent


class FeaturedProvider(BaseModel):
    item_type: Literal["provider"] = "provider"
    item: StoredProviderProfile


Featured = Annotated[FeaturedEvent | FeaturedProvider, Field(discriminator="item_type")]


class DiscoverHome(BaseModel):
    """`featured` is the large card above the rows; null when there is
    nothing to feature. Empty rows are never sent."""

    featured: Featured | None = None
    rows: list[DiscoverRow]
