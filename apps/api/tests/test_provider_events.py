"""Provider events — schema validation and the service's status rules.

The service is exercised against an in-memory stand-in for the PostgREST query
builder, so these run without a database. That covers the rules the *service*
owns (ownership filters, status transitions, the public listing filter). RLS
itself is declared in the migration and guarded by test_rls_coverage.py.
"""

import uuid
from datetime import UTC, datetime, timedelta
from operator import itemgetter
from typing import Any, cast

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from supabase import Client

from app.schemas.provider_events import ProviderEventInput, ProviderEventUpdate
from app.services import provider_events as service

PROVIDER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Query:
    """Records filters and applies them to the fake table on execute()."""

    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows
        self._op = "select"
        self._payload: dict[str, Any] = {}
        self._filters: list[Any] = []
        self._order: str | None = None

    def select(self, *_: str):
        return self

    def insert(self, data: dict[str, Any]):
        self._op, self._payload = "insert", data
        return self

    def update(self, data: dict[str, Any]):
        self._op, self._payload = "update", data
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col: str, vals: list[Any]):
        self._filters.append(lambda r: r.get(col) in vals)
        return self

    def gte(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) >= val)
        return self

    def order(self, col: str, desc: bool = False):
        self._order = col
        return self

    def execute(self):
        if self._op == "insert":
            now = datetime.now(UTC).isoformat()
            row = {
                "id": str(uuid.uuid4()),
                "status": "draft",
                "version": 1,
                "created_at": now,
                "updated_at": now,
                **self._payload,
            }
            self._rows.append(row)
            return _Result([row])

        matched = [r for r in self._rows if all(f(r) for f in self._filters)]
        if self._op == "update":
            for r in matched:
                r.update(self._payload)
        elif self._op == "delete":
            for r in matched:
                self._rows.remove(r)
        elif self._order:
            matched.sort(key=itemgetter(self._order))
        return _Result([dict(r) for r in matched])


class _Result:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class _Rpc:
    def __init__(self, data: list[dict[str, Any]]):
        self._data = data

    def execute(self):
        return _Result(self._data)


class _FakeDb:
    def __init__(self, *, with_profile: bool = True):
        self.tables: dict[str, list[dict[str, Any]]] = {
            "provider_events": [],
            "provider_profiles": [{"user_id": PROVIDER}] if with_profile else [],
            "reservations": [],
        }
        # Who the JWT says is calling. Only the database functions need it —
        # the real ones read auth.uid(); table queries filter explicitly.
        self.acting_as = PROVIDER

    def table(self, name: str) -> _Query:
        return _Query(self.tables[name])

    def rpc(self, name: str, params: dict[str, Any]) -> _Rpc:
        """Stand-ins for the database functions the service calls. The real
        ones (and the trigger behind them) are tested against Postgres in
        supabase/tests/provider_events.sh."""
        if name == "provider_event_spots_taken":
            taken: dict[str, int] = {}
            for r in self.tables["reservations"]:
                if r["status"] == "confirmed" and r["event_id"] in params["p_event_ids"]:
                    taken[r["event_id"]] = taken.get(r["event_id"], 0) + r["spots"]
            return _Rpc([{"event_id": k, "spots_taken": v} for k, v in taken.items()])
        if name == "update_provider_event":
            matched = [
                r
                for r in self.tables["provider_events"]
                if r["id"] == params["p_event_id"]
                and r["provider_id"] == self.acting_as
                and r["status"] != "cancelled"
            ]
            for r in matched:
                r.update(params["p_event"])
            return _Rpc([dict(r) for r in matched])
        raise AssertionError(f"unexpected rpc: {name}")


def _db(**kwargs: Any) -> Client:
    return cast(Client, _FakeDb(**kwargs))


def _input(**overrides: Any) -> ProviderEventInput:
    start = datetime.now(UTC) + timedelta(days=7)
    fields: dict[str, Any] = {
        "title": "U9 Football Training",
        "event_type": "sport",
        "start_time": start,
        "end_time": start + timedelta(hours=1),
        "location": "Riverside Pitch 2",
        "capacity": 20,
    }
    fields.update(overrides)
    return ProviderEventInput(**fields)


def _update(**overrides: Any) -> ProviderEventUpdate:
    return ProviderEventUpdate(**_input(**overrides).model_dump())


def _status(exc: pytest.ExceptionInfo[HTTPException]) -> int:
    return exc.value.status_code


class TestProviderEventInput:
    def test_valid_event(self):
        event = _input()
        assert event.capacity == 20
        assert event.is_all_day is False

    def test_capacity_is_optional(self):
        assert _input(capacity=None).capacity is None

    @pytest.mark.parametrize("capacity", [0, -1])
    def test_capacity_must_be_positive(self, capacity):
        with pytest.raises(ValidationError):
            _input(capacity=capacity)

    def test_inherits_title_limit(self):
        with pytest.raises(ValidationError):
            _input(title="x" * 61)

    def test_inherits_end_after_start(self):
        start = datetime.now(UTC) + timedelta(days=1)
        with pytest.raises(ValidationError):
            _input(start_time=start, end_time=start - timedelta(hours=1))

    def test_has_no_parent_only_fields(self):
        # Confidence and action items belong to a parent's extracted event.
        assert "confidence" not in ProviderEventInput.model_fields
        assert "action_items" not in ProviderEventInput.model_fields


class TestCreate:
    def test_creates_a_draft_owned_by_the_caller(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        assert event.status == "draft"
        assert event.provider_id == PROVIDER
        assert event.version == 1

    def test_requires_a_provider_page(self):
        with pytest.raises(HTTPException) as exc:
            service.create_event(_db(with_profile=False), PROVIDER, _input())
        assert _status(exc) == 409


class TestStatusTransitions:
    def test_publish_then_cancel(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        assert service.publish_event(db, PROVIDER, event.id).status == "published"
        assert service.cancel_event(db, PROVIDER, event.id).status == "cancelled"

    def test_unpublish_returns_to_draft(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        assert service.unpublish_event(db, PROVIDER, event.id).status == "draft"

    def test_cannot_publish_twice(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        with pytest.raises(HTTPException) as exc:
            service.publish_event(db, PROVIDER, event.id)
        assert _status(exc) == 409

    def test_cannot_cancel_a_draft(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        with pytest.raises(HTTPException) as exc:
            service.cancel_event(db, PROVIDER, event.id)
        assert _status(exc) == 409

    def test_cancelled_is_terminal(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        service.cancel_event(db, PROVIDER, event.id)
        for action in (service.publish_event, service.unpublish_event, service.cancel_event):
            with pytest.raises(HTTPException) as exc:
                action(db, PROVIDER, event.id)
            assert _status(exc) == 409

    def test_cannot_publish_a_past_event(self):
        db = _db()
        start = datetime.now(UTC) - timedelta(days=3)
        event = service.create_event(
            db, PROVIDER, _input(start_time=start, end_time=start + timedelta(hours=1))
        )
        with pytest.raises(HTTPException) as exc:
            service.publish_event(db, PROVIDER, event.id)
        assert _status(exc) == 409

    def test_another_provider_gets_404(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        with pytest.raises(HTTPException) as exc:
            service.publish_event(db, OTHER, event.id)
        assert _status(exc) == 404


class TestUpdate:
    def test_updates_fields(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        updated = service.update_event(db, PROVIDER, event.id, _update(title="Moved", capacity=5))
        assert updated.title == "Moved"
        assert updated.capacity == 5

    def test_published_event_stays_published_when_edited(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        assert service.update_event(db, PROVIDER, event.id, _update()).status == "published"

    def test_cancelled_event_cannot_be_edited(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        service.cancel_event(db, PROVIDER, event.id)
        with pytest.raises(HTTPException) as exc:
            service.update_event(db, PROVIDER, event.id, _update(title="Nope"))
        assert _status(exc) == 409

    def test_another_provider_gets_404(self):
        fake = _FakeDb()
        db = cast(Client, fake)
        event = service.create_event(db, PROVIDER, _input())
        fake.acting_as = OTHER
        with pytest.raises(HTTPException) as exc:
            service.update_event(db, OTHER, event.id, _update(title="Hijack"))
        assert _status(exc) == 404
        assert fake.tables["provider_events"][0]["title"] != "Hijack"

    def test_unknown_event_is_404(self):
        with pytest.raises(HTTPException) as exc:
            service.update_event(_db(), PROVIDER, str(uuid.uuid4()), _update())
        assert _status(exc) == 404


class TestDelete:
    def test_deletes_a_draft(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.delete_event(db, PROVIDER, event.id)
        assert service.list_my_events(db, PROVIDER) == []

    def test_published_event_cannot_be_deleted(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        with pytest.raises(HTTPException) as exc:
            service.delete_event(db, PROVIDER, event.id)
        assert _status(exc) == 409
        assert len(service.list_my_events(db, PROVIDER)) == 1


class TestListings:
    def test_my_events_include_drafts_but_not_other_providers(self):
        fake = _FakeDb()
        fake.tables["provider_profiles"].append({"user_id": OTHER})
        db = cast(Client, fake)
        service.create_event(db, PROVIDER, _input(title="Mine"))
        theirs = service.create_event(db, OTHER, _input(title="Theirs"))
        service.publish_event(db, OTHER, theirs.id)

        assert [e.title for e in service.list_my_events(db, PROVIDER)] == ["Mine"]

    def test_public_listing_hides_drafts_even_from_the_owner(self):
        db = _db()
        service.create_event(db, PROVIDER, _input(title="Draft"))
        live = service.create_event(db, PROVIDER, _input(title="Live"))
        service.publish_event(db, PROVIDER, live.id)

        assert [e.title for e in service.list_public_events(db, OTHER, PROVIDER)] == ["Live"]

    def test_public_listing_keeps_cancelled_events(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        service.cancel_event(db, PROVIDER, event.id)

        assert [e.status for e in service.list_public_events(db, OTHER, PROVIDER)] == ["cancelled"]

    def test_public_listing_drops_past_events_and_sorts_soonest_first(self):
        fake = _FakeDb()
        db = cast(Client, fake)
        now = datetime.now(UTC)
        later = service.create_event(db, PROVIDER, _input(title="Later"))
        sooner = service.create_event(
            db,
            PROVIDER,
            _input(
                title="Sooner",
                start_time=now + timedelta(days=1),
                end_time=now + timedelta(days=1, hours=1),
            ),
        )
        old = service.create_event(db, PROVIDER, _input(title="Old"))
        for event in (later, sooner, old):
            service.publish_event(db, PROVIDER, event.id)
        # Age the third event after publishing (a past event can't be published).
        for row in fake.tables["provider_events"]:
            if row["id"] == old.id:
                row["start_time"] = (now - timedelta(days=5)).isoformat()
                row["end_time"] = (now - timedelta(days=5) + timedelta(hours=1)).isoformat()

        titles = [e.title for e in service.list_public_events(db, OTHER, PROVIDER)]
        assert titles == ["Sooner", "Later"]


class TestSpots:
    def _reserve(self, fake: _FakeDb, event_id: str, user_id: str, spots: int, status: str):
        fake.tables["reservations"].append(
            {"event_id": event_id, "user_id": user_id, "spots": spots, "status": status}
        )

    def test_listing_counts_confirmed_spots_and_the_callers_own(self):
        fake = _FakeDb()
        db = cast(Client, fake)
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        self._reserve(fake, event.id, OTHER, 2, "confirmed")
        self._reserve(fake, event.id, "33333333-3333-3333-3333-333333333333", 3, "confirmed")
        self._reserve(fake, event.id, "44444444-4444-4444-4444-444444444444", 4, "cancelled")

        [listed] = service.list_public_events(db, OTHER, PROVIDER)
        assert listed.spots_taken == 5
        assert listed.my_spots == 2

    def test_provider_sees_the_attendee_count_but_holds_no_spots(self):
        fake = _FakeDb()
        db = cast(Client, fake)
        event = service.create_event(db, PROVIDER, _input())
        self._reserve(fake, event.id, OTHER, 2, "confirmed")

        [listed] = service.list_my_events(db, PROVIDER)
        assert listed.spots_taken == 2
        assert listed.my_spots == 0
