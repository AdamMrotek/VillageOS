"""Discover home — the R1 row rules (docs/PROVIDER_EVENTS_PLAN.md §4).

`build_home()` is pure, so most tests hand it events and providers directly.
`home()` is exercised once against a small stand-in for the query builder to
check what it reads and what it filters out before the rules run.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from supabase import Client

from app.factories import ProviderProfileFactory
from app.schemas.discover import (
    DiscoverEvent,
    DiscoverHome,
    DiscoverKind,
    EventRow,
    FeaturedEvent,
    FeaturedProvider,
    ProviderRow,
)
from app.schemas.providers import ProviderCategory, ProviderKind, StoredProviderProfile
from app.services import discover

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
VIEWER = "99999999-9999-9999-9999-999999999999"


def _provider(**overrides: Any) -> StoredProviderProfile:
    overrides.setdefault("created_at", NOW - timedelta(days=90))
    return ProviderProfileFactory.build_stored(**overrides)


def _event(provider: StoredProviderProfile, *, days: float, **overrides: Any) -> DiscoverEvent:
    start = NOW + timedelta(days=days)
    fields: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "provider_id": provider.user_id,
        "provider_name": provider.name,
        "provider_category": provider.category,
        "title": f"Event in {days} days",
        "event_type": "sport",
        "start_time": start,
        "end_time": start + timedelta(hours=1),
        "capacity": None,
        "status": "published",
        "version": 1,
        "created_at": NOW,
        "updated_at": NOW,
    }
    fields.update(overrides)
    return DiscoverEvent.model_validate(fields)


def _build(
    events: list[DiscoverEvent],
    providers: list[StoredProviderProfile],
    popularity: dict[str, int] | None = None,
    kind: DiscoverKind = DiscoverKind.all,
) -> DiscoverHome:
    return discover.build_home(events, providers, popularity or {}, kind, NOW)


def _rows(home: DiscoverHome) -> dict[str, list[str]]:
    """Row id → item ids, in order."""
    return {row.id: discover._item_ids(row) for row in home.rows}


class _Catalogue:
    """A village with a bit of everything: the "done when" case."""

    def __init__(self):
        self.club = _provider(name="Riverside FC", category=ProviderCategory.sports_club)
        self.school = _provider(name="Oakfield Primary", category=ProviderCategory.school)
        self.pool = _provider(
            name="Millbrook Pool", category=ProviderCategory.council, kind=ProviderKind.venue
        )
        self.soft_play = _provider(
            name="Jungle Soft Play",
            category=ProviderCategory.other,
            kind=ProviderKind.venue,
            created_at=NOW - timedelta(days=3),
        )
        self.magician = _provider(
            name="Marvo the Magician",
            category=ProviderCategory.other,
            kind=ProviderKind.entertainer,
        )
        self.providers = [self.club, self.school, self.pool, self.soft_play, self.magician]
        self.training = _event(self.club, days=2)
        self.fair = _event(self.school, days=5)
        self.tournament = _event(self.club, days=12)


@pytest.fixture
def village() -> _Catalogue:
    return _Catalogue()


class TestRows:
    def test_rows_in_order_mixing_events_venues_and_entertainers(self, village):
        home = _build([village.training, village.fair, village.tournament], village.providers)
        assert [row.id for row in home.rows] == [
            "events-this-week",
            "new-providers",
            "popular-venues",
            "entertainers",
            "category-sports_club",
            "category-school",
        ]
        assert {row.item_type for row in home.rows} == {"event", "provider"}

    def test_this_week_is_the_next_seven_days(self, village):
        home = _build([village.training, village.fair, village.tournament], village.providers)
        assert _rows(home)["events-this-week"] == [village.training.id, village.fair.id]

    def test_new_on_villageos_is_the_last_30_days_newest_first(self, village):
        newest = _provider(name="Brand New Club", created_at=NOW - timedelta(hours=1))
        home = _build([], [*village.providers, newest])
        assert _rows(home)["new-providers"] == [newest.user_id, village.soft_play.user_id]

    def test_venues_rank_by_confirmed_reservations(self, village):
        home = _build([], village.providers, popularity={village.pool.user_id: 4})
        row = next(r for r in home.rows if r.id == "popular-venues")
        assert row.title == "Popular venues"
        assert _rows(home)["popular-venues"] == [village.pool.user_id, village.soft_play.user_id]

    def test_venues_without_reservations_are_not_called_popular(self, village):
        home = _build([], village.providers)
        row = next(r for r in home.rows if r.id == "popular-venues")
        assert row.title == "Venues"
        # Alphabetical when nobody has reserved anywhere.
        assert _rows(home)["popular-venues"] == [village.soft_play.user_id, village.pool.user_id]

    def test_entertainers_row(self, village):
        assert _rows(_build([], village.providers))["entertainers"] == [village.magician.user_id]

    def test_one_events_row_per_category(self, village):
        home = _build([village.training, village.fair, village.tournament], village.providers)
        rows = _rows(home)
        assert rows["category-sports_club"] == [village.training.id, village.tournament.id]
        assert rows["category-school"] == [village.fair.id]
        titles = {row.id: row.title for row in home.rows}
        assert titles["category-sports_club"] == "Sports clubs"

    def test_empty_rows_are_dropped(self, village):
        home = _build([village.training], village.providers)
        assert "category-school" not in _rows(home)
        assert all(row.items for row in home.rows)

    def test_rows_are_capped(self, village):
        many = [_event(village.club, days=1 + i / 10) for i in range(20)]
        home = _build(many, village.providers)
        assert len(_rows(home)["events-this-week"]) == discover._ROW_LIMIT


class TestFallback:
    def test_too_little_content_falls_back_to_all_events_and_providers(self):
        # One old "other" organiser with one event a month away fills no themed
        # row, so "All events" / "All providers" make up the page.
        club = _provider(name="Riverside FC", category=ProviderCategory.other)
        far = _event(club, days=30)
        home = _build([far], [club])
        assert [row.id for row in home.rows] == ["all-events", "all-providers"]

    def test_a_fallback_row_that_repeats_a_row_is_skipped(self):
        club = _provider(name="Riverside FC", category=ProviderCategory.sports_club)
        soon = _event(club, days=1)
        home = _build([soon], [club])
        # "This week" and "Sports clubs" already hold the one event.
        assert [row.id for row in home.rows] == [
            "events-this-week",
            "category-sports_club",
            "all-providers",
        ]

    def test_nothing_at_all(self):
        home = _build([], [])
        assert home.rows == []
        assert home.featured is None


class TestKindChips:
    def test_events_only(self, village):
        home = _build([village.training, village.fair], village.providers, kind=DiscoverKind.event)
        assert all(isinstance(row, EventRow) for row in home.rows)
        assert home.rows

    def test_venues_only(self, village):
        home = _build([village.training], village.providers, kind=DiscoverKind.venue)
        assert all(isinstance(row, ProviderRow) for row in home.rows)
        ids = {i for row in home.rows for i in discover._item_ids(row)}
        assert ids == {village.pool.user_id, village.soft_play.user_id}
        # "New on VillageOS" keeps only its venue.
        assert _rows(home)["new-providers"] == [village.soft_play.user_id]
        assert isinstance(home.featured, FeaturedProvider)
        assert home.featured.item.kind == ProviderKind.venue

    def test_entertainers_only(self, village):
        home = _build([village.training], village.providers, kind=DiscoverKind.entertainer)
        assert _rows(home) == {"entertainers": [village.magician.user_id]}


class TestFeatured:
    def test_most_reserved_event_in_the_next_two_weeks(self, village):
        busy = village.tournament.model_copy(update={"spots_taken": 9})
        home = _build([village.training, village.fair, busy], village.providers)
        assert isinstance(home.featured, FeaturedEvent)
        assert home.featured.item.id == busy.id

    def test_soonest_on_a_tie(self, village):
        home = _build([village.training, village.fair], village.providers)
        assert isinstance(home.featured, FeaturedEvent)
        assert home.featured.item.id == village.training.id

    def test_next_event_when_none_is_soon(self, village):
        later = _event(village.club, days=40)
        home = _build([later], village.providers)
        assert isinstance(home.featured, FeaturedEvent)
        assert home.featured.item.id == later.id

    def test_most_popular_venue_when_there_are_no_events(self, village):
        home = _build([], village.providers, popularity={village.pool.user_id: 2})
        assert isinstance(home.featured, FeaturedProvider)
        assert home.featured.item.user_id == village.pool.user_id


class TestEventFilters:
    def test_past_events_are_out(self, village):
        assert not discover.is_upcoming(_event(village.club, days=-0.1), NOW)
        assert discover.is_upcoming(_event(village.club, days=0.1), NOW)

    def test_all_day_events_stay_through_their_day(self, village):
        today = _event(village.club, days=-0.5, is_all_day=True, end_time=None)
        assert discover.is_upcoming(today, NOW)

    def test_full_events_are_out(self, village):
        assert discover.is_full(_event(village.club, days=1, capacity=3, spots_taken=3))
        assert not discover.is_full(_event(village.club, days=1, capacity=3, spots_taken=2))
        assert not discover.is_full(_event(village.club, days=1, capacity=None, spots_taken=50))


# --- home(): what it reads ---------------------------------------------------


class _Query:
    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows
        self._filters: list[Any] = []
        self._limit: int | None = None

    def select(self, *_: str):
        return self

    def eq(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col: str, vals: list[Any]):
        self._filters.append(lambda r: r.get(col) in vals)
        return self

    def gte(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) >= val)
        return self

    def order(self, col: str, desc: bool = False):
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def execute(self):
        rows = [dict(r) for r in self._rows if all(f(r) for f in self._filters)]
        rows.sort(key=lambda r: r.get("start_time", ""))
        return _Result(rows[: self._limit])


class _Result:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data

    def execute(self):
        return self  # rpc() results are executed like queries


class _FakeDb:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {
            "provider_profiles": [],
            "provider_events": [],
            "reservations": [],
        }

    def table(self, name: str) -> _Query:
        return _Query(self.tables[name])

    def rpc(self, name: str, params: dict[str, Any]):
        confirmed = [r for r in self.tables["reservations"] if r["status"] == "confirmed"]
        events = {e["id"]: e for e in self.tables["provider_events"]}
        totals: dict[str, int] = {}
        if name == "provider_event_spots_taken":
            for r in confirmed:
                if r["event_id"] in params["p_event_ids"]:
                    totals[r["event_id"]] = totals.get(r["event_id"], 0) + r["spots"]
            return _Result([{"event_id": k, "spots_taken": v} for k, v in totals.items()])
        if name == "provider_reservation_counts":
            for r in confirmed:
                pid = events[r["event_id"]]["provider_id"]
                if pid in params["p_provider_ids"]:
                    totals[pid] = totals.get(pid, 0) + 1
            return _Result([{"provider_id": k, "reservations": v} for k, v in totals.items()])
        raise AssertionError(f"unexpected rpc: {name}")


def _event_row(provider_id: str, start: datetime, **overrides: Any) -> dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "provider_id": provider_id,
        "title": "Training",
        "event_type": "sport",
        "start_time": start.isoformat(),
        "end_time": None,
        "is_all_day": False,
        "location": None,
        "description": None,
        "capacity": None,
        "status": "published",
        "version": 1,
        "created_at": NOW.isoformat(),
        "updated_at": NOW.isoformat(),
    }
    row.update(overrides)
    return row


class TestHome:
    @pytest.fixture
    def db(self, monkeypatch) -> _FakeDb:
        monkeypatch.setattr(discover, "_now", lambda: NOW)
        fake = _FakeDb()
        club = _provider(name="Riverside FC", category=ProviderCategory.sports_club)
        venue = _provider(name="Millbrook Pool", kind=ProviderKind.venue)
        fake.tables["provider_profiles"] = [p.model_dump(mode="json") for p in (club, venue)]
        # A profile written before `kind` existed reads as an organiser.
        del fake.tables["provider_profiles"][0]["kind"]
        soon = NOW + timedelta(days=1)
        fake.tables["provider_events"] = [
            _event_row(club.user_id, soon, id="open", title="Open", capacity=10),
            _event_row(club.user_id, soon, id="full", title="Full", capacity=1),
            _event_row(club.user_id, NOW - timedelta(hours=1), id="past", title="Past"),
            _event_row(club.user_id, soon, id="draft", title="Draft", status="draft"),
            _event_row(club.user_id, soon, id="gone", title="Gone", status="cancelled"),
            _event_row(venue.user_id, soon, id="swim", title="Swim"),
        ]
        fake.tables["reservations"] = [
            {"event_id": "full", "user_id": "x", "spots": 1, "status": "confirmed"},
            {"event_id": "open", "user_id": VIEWER, "spots": 2, "status": "confirmed"},
            {"event_id": "swim", "user_id": "y", "spots": 1, "status": "confirmed"},
            {"event_id": "swim", "user_id": "z", "spots": 1, "status": "cancelled"},
        ]
        return fake

    def test_only_bookable_events_reach_the_rows(self, db):
        home = discover.home(cast(Client, db), VIEWER, DiscoverKind.all)
        row = next(r for r in home.rows if r.id == "events-this-week")
        assert isinstance(row, EventRow)
        assert {e.id for e in row.items} == {"open", "swim"}

    def test_event_cards_carry_spots_the_viewers_reservation_and_the_provider(self, db):
        home = discover.home(cast(Client, db), VIEWER, DiscoverKind.all)
        row = next(r for r in home.rows if r.id == "events-this-week")
        assert isinstance(row, EventRow)
        open_ = next(e for e in row.items if e.id == "open")
        assert (open_.spots_taken, open_.my_spots) == (2, 2)
        assert (open_.provider_name, open_.provider_category) == (
            "Riverside FC",
            ProviderCategory.sports_club,
        )

    def test_venue_popularity_counts_confirmed_reservations(self, db):
        home = discover.home(cast(Client, db), VIEWER, DiscoverKind.all)
        row = next(r for r in home.rows if r.id == "popular-venues")
        assert row.title == "Popular venues"

    def test_a_profile_without_kind_is_an_organiser(self, db):
        home = discover.home(cast(Client, db), VIEWER, DiscoverKind.venue)
        ids = {i for row in home.rows for i in discover._item_ids(row)}
        assert len(ids) == 1
