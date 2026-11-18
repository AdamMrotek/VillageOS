"""Discover home: rule-based browse rows (R1 in docs/PROVIDER_EVENTS_PLAN.md §4.4).

`home()` reads what the rows need; `build_home()` decides the rows from it and
does no I/O, so the rules are tested without a database.

Rows, in order: This week · New on VillageOS · Popular venues · Entertainers ·
one row of events per provider category. Past, full, draft and cancelled
events never appear. Empty rows are dropped, and when fewer than
`_MIN_ROWS` remain the page falls back to "All events" / "All providers".
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from supabase import Client

from app.schemas.discover import (
    DiscoverEvent,
    DiscoverHome,
    DiscoverKind,
    DiscoverRow,
    EventRow,
    Featured,
    FeaturedEvent,
    FeaturedProvider,
    ProviderRow,
)
from app.schemas.provider_events import ProviderEventStatus
from app.schemas.providers import ProviderCategory, ProviderKind, StoredProviderProfile
from app.services import reservations

_Row = dict[str, Any]

# Cards per row. Rows scroll sideways, but a long tail adds payload and little
# else; "All events" on a provider's own page is the place for everything.
_ROW_LIMIT = 12

# Upcoming events read per request. R1 has no paging; at this size the page is
# one indexed range scan (provider_events_published_start).
_EVENT_LIMIT = 200

_THIS_WEEK = timedelta(days=7)
_NEW_PROVIDER = timedelta(days=30)
# The featured event is the most reserved one starting this soon.
_FEATURED_WINDOW = timedelta(days=14)
# All-day events are stored at local midnight with no end, so they stay
# listed through their day (same grace as a provider's public page).
_ALL_DAY_GRACE = timedelta(days=1)

# Below this many rows the page looks empty, so the fallback rows are added.
_MIN_ROWS = 3

# One events row per category, in this order. "Other" gets no row of its own;
# its events still show in "This week" and the fallback.
_CATEGORY_ROWS: dict[ProviderCategory, str] = {
    ProviderCategory.sports_club: "Sports clubs",
    ProviderCategory.school: "Schools",
    ProviderCategory.library: "Libraries",
    ProviderCategory.community: "Community",
    ProviderCategory.council: "Council",
}


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def is_upcoming(event: DiscoverEvent, now: datetime) -> bool:
    """Not started yet; an all-day event counts as upcoming through its day."""
    start = _aware(event.start_time)
    return start > now - _ALL_DAY_GRACE if event.is_all_day else start > now


def is_full(event: DiscoverEvent) -> bool:
    return event.capacity is not None and event.spots_taken >= event.capacity


def home(db: Client, user_id: str, kind: DiscoverKind) -> DiscoverHome:
    now = _now()
    providers = [
        StoredProviderProfile.model_validate(row)
        for row in cast(list[_Row], db.table("provider_profiles").select("*").execute().data)
    ]
    events = _upcoming_events(db, user_id, providers, now)
    venue_ids = [p.user_id for p in providers if p.kind == ProviderKind.venue]
    popularity = _reservation_counts(db, venue_ids)
    return build_home(events, providers, popularity, kind, now)


def _upcoming_events(
    db: Client, user_id: str, providers: list[StoredProviderProfile], now: datetime
) -> list[DiscoverEvent]:
    """Published events that haven't happened and still have room, soonest
    first, with how full they are and who runs them."""
    rows = cast(
        list[_Row],
        db.table("provider_events")
        .select("*")
        .eq("status", ProviderEventStatus.published.value)
        .gte("start_time", (now - _ALL_DAY_GRACE).isoformat())
        .order("start_time", desc=False)
        .limit(_EVENT_LIMIT)
        .execute()
        .data,
    )
    ids = [row["id"] for row in rows]
    taken = reservations.spots_taken(db, ids)
    mine = reservations.my_spots(db, user_id, ids)
    by_id = {p.user_id: p for p in providers}

    events = []
    for row in rows:
        provider = by_id.get(row["provider_id"])
        event = DiscoverEvent.model_validate(
            {
                **row,
                "spots_taken": taken.get(row["id"], 0),
                "my_spots": mine.get(row["id"], 0),
                "provider_name": provider.name if provider else None,
                "provider_category": provider.category if provider else None,
            }
        )
        if is_upcoming(event, now) and not is_full(event):
            events.append(event)
    return events


def _reservation_counts(db: Client, provider_ids: list[str]) -> dict[str, int]:
    """Confirmed reservations per provider. Totals only — the function runs as
    the definer because parents can't read each other's reservations."""
    if not provider_ids:
        return {}
    rows = cast(
        list[_Row],
        db.rpc("provider_reservation_counts", {"p_provider_ids": provider_ids}).execute().data,
    )
    return {row["provider_id"]: row["reservations"] for row in rows}


def build_home(
    events: list[DiscoverEvent],
    providers: list[StoredProviderProfile],
    popularity: dict[str, int],
    kind: DiscoverKind,
    now: datetime,
) -> DiscoverHome:
    """Decide the rows. `events` are bookable and soonest first; `popularity`
    is confirmed reservations per provider id."""
    by_name = sorted(providers, key=lambda p: p.name.lower())

    venues = sorted(
        (p for p in by_name if p.kind == ProviderKind.venue),
        key=lambda p: -popularity.get(p.user_id, 0),
    )
    # Only call them popular once someone has reserved with one of them.
    venues_title = "Popular venues" if any(popularity.get(v.user_id) for v in venues) else "Venues"
    entertainers = [p for p in by_name if p.kind == ProviderKind.entertainer]
    new = sorted(
        (p for p in providers if _aware(p.created_at) >= now - _NEW_PROVIDER),
        key=lambda p: _aware(p.created_at),
        reverse=True,
    )

    rows: list[DiscoverRow] = [
        EventRow(
            id="events-this-week",
            title="This week",
            items=[e for e in events if _aware(e.start_time) < now + _THIS_WEEK],
        ),
        ProviderRow(id="new-providers", title="New on VillageOS", items=new),
        ProviderRow(id="popular-venues", title=venues_title, items=venues),
        ProviderRow(id="entertainers", title="Entertainers", items=entertainers),
        *(
            EventRow(
                id=f"category-{category.value}",
                title=title,
                items=[e for e in events if e.provider_category == category],
            )
            for category, title in _CATEGORY_ROWS.items()
        ),
    ]
    rows = _for_kind(rows, kind)

    if len(rows) < _MIN_ROWS:
        for fallback in _for_kind(_fallback_rows(kind, events, by_name), kind):
            if fallback.items and not any(_same_items(fallback, row) for row in rows):
                rows.append(fallback)

    for row in rows:
        row.items = row.items[:_ROW_LIMIT]

    return DiscoverHome(featured=_featured(kind, events, venues, entertainers, new, now), rows=rows)


def _for_kind(rows: list[DiscoverRow], kind: DiscoverKind) -> list[DiscoverRow]:
    """Keep what the selected chip asks for, and drop rows left empty."""
    kept: list[DiscoverRow] = []
    for row in rows:
        if isinstance(row, EventRow):
            if kind not in (DiscoverKind.all, DiscoverKind.event):
                continue
        elif kind == DiscoverKind.event:
            continue
        elif kind != DiscoverKind.all:
            wanted = ProviderKind(kind.value)
            row = row.model_copy(update={"items": [p for p in row.items if p.kind == wanted]})
        if row.items:
            kept.append(row)
    return kept


def _fallback_rows(
    kind: DiscoverKind, events: list[DiscoverEvent], providers: list[StoredProviderProfile]
) -> list[DiscoverRow]:
    providers_title = {
        DiscoverKind.venue: "All venues",
        DiscoverKind.entertainer: "All entertainers",
    }.get(kind, "All providers")
    return [
        EventRow(id="all-events", title="All events", items=events),
        ProviderRow(id="all-providers", title=providers_title, items=providers),
    ]


def _item_ids(row: DiscoverRow) -> list[str]:
    if isinstance(row, EventRow):
        return [e.id for e in row.items]
    return [p.user_id for p in row.items]


def _same_items(a: DiscoverRow, b: DiscoverRow) -> bool:
    """A fallback row that repeats an existing row adds nothing."""
    return a.item_type == b.item_type and set(_item_ids(a)) == set(_item_ids(b))


def _featured(
    kind: DiscoverKind,
    events: list[DiscoverEvent],
    venues: list[StoredProviderProfile],
    entertainers: list[StoredProviderProfile],
    new: list[StoredProviderProfile],
    now: datetime,
) -> Featured | None:
    """Events: the most reserved one in the next two weeks, soonest on a tie,
    else the next one. Providers (when there are no events, or a provider
    chip is selected): the most popular venue, else the newest provider."""
    if kind in (DiscoverKind.all, DiscoverKind.event) and events:
        soon = [e for e in events if _aware(e.start_time) < now + _FEATURED_WINDOW]
        # `events` is soonest first and max() keeps the first of equals.
        best = max(soon, key=lambda e: e.spots_taken) if soon else events[0]
        return FeaturedEvent(item=best)

    pool = {
        DiscoverKind.venue: venues,
        DiscoverKind.entertainer: entertainers,
        DiscoverKind.all: venues or new,
    }.get(kind, [])
    return FeaturedProvider(item=pool[0]) if pool else None
