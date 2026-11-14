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

from app.schemas.provider_events import ProviderEventInput
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


class _FakeDb:
    def __init__(self, *, with_profile: bool = True):
        self.tables: dict[str, list[dict[str, Any]]] = {
            "provider_events": [],
            "provider_profiles": [{"user_id": PROVIDER}] if with_profile else [],
        }

    def table(self, name: str) -> _Query:
        return _Query(self.tables[name])


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
        updated = service.update_event(db, PROVIDER, event.id, _input(title="Moved", capacity=5))
        assert updated.title == "Moved"
        assert updated.capacity == 5

    def test_published_event_stays_published_when_edited(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        assert service.update_event(db, PROVIDER, event.id, _input()).status == "published"

    def test_cancelled_event_cannot_be_edited(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        service.cancel_event(db, PROVIDER, event.id)
        with pytest.raises(HTTPException) as exc:
            service.update_event(db, PROVIDER, event.id, _input(title="Nope"))
        assert _status(exc) == 409

    def test_another_provider_gets_404(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        with pytest.raises(HTTPException) as exc:
            service.update_event(db, OTHER, event.id, _input(title="Hijack"))
        assert _status(exc) == 404

    def test_unknown_event_is_404(self):
        with pytest.raises(HTTPException) as exc:
            service.update_event(_db(), PROVIDER, str(uuid.uuid4()), _input())
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

        assert [e.title for e in service.list_public_events(db, PROVIDER)] == ["Live"]

    def test_public_listing_keeps_cancelled_events(self):
        db = _db()
        event = service.create_event(db, PROVIDER, _input())
        service.publish_event(db, PROVIDER, event.id)
        service.cancel_event(db, PROVIDER, event.id)

        assert [e.status for e in service.list_public_events(db, PROVIDER)] == ["cancelled"]

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

        titles = [e.title for e in service.list_public_events(db, PROVIDER)]
        assert titles == ["Sooner", "Later"]
