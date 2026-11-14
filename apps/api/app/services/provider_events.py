from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import HTTPException
from supabase import Client

from app.schemas.provider_events import (
    ProviderEventInput,
    ProviderEventStatus,
    StoredProviderEvent,
)

# postgrest types row data as generic JSON; this table always returns objects.
_Row = dict[str, Any]

_TABLE = "provider_events"

# How long after its start an event stays on the public page. Covers events in
# progress and all-day events (stored as a start with no end) without needing
# the viewer's timezone.
_PUBLIC_GRACE = timedelta(days=1)

# Statuses a parent can see. RLS allows the same set, but the owner's JWT also
# reads their own drafts, so the public listing filters explicitly — a provider
# viewing their own public page must see what parents see.
_PUBLIC_STATUSES = [ProviderEventStatus.published.value, ProviderEventStatus.cancelled.value]


def _now() -> datetime:
    return datetime.now(UTC)


def _stored(rows: Any) -> list[StoredProviderEvent]:
    return [StoredProviderEvent.model_validate(row) for row in cast(list[_Row], rows)]


def list_my_events(db: Client, user_id: str) -> list[StoredProviderEvent]:
    """Every event the caller owns, drafts included. The explicit provider_id
    filter is required: SELECT on this table is public for published rows, so
    RLS alone would also return other providers' events."""
    rows = (
        db.table(_TABLE)
        .select("*")
        .eq("provider_id", user_id)
        .order("start_time", desc=False)
        .execute()
        .data
    )
    return _stored(rows)


def list_public_events(db: Client, provider_id: str) -> list[StoredProviderEvent]:
    """A provider's upcoming published (and cancelled) events, soonest first."""
    cutoff = (_now() - _PUBLIC_GRACE).isoformat()
    rows = (
        db.table(_TABLE)
        .select("*")
        .eq("provider_id", provider_id)
        .in_("status", _PUBLIC_STATUSES)
        .gte("start_time", cutoff)
        .order("start_time", desc=False)
        .execute()
        .data
    )
    return _stored(rows)


def create_event(db: Client, user_id: str, event: ProviderEventInput) -> StoredProviderEvent:
    """Create a draft. Events hang off the public profile (FK), so the provider
    page must exist first — checked here to return a clear 409 instead of
    surfacing the foreign-key violation as a 500."""
    has_profile = (
        db.table("provider_profiles").select("user_id").eq("user_id", user_id).execute().data
    )
    if not has_profile:
        raise HTTPException(
            status_code=409, detail="Create your provider page before adding events"
        )

    data = event.model_dump(mode="json")
    # provider_id must be set explicitly — RLS WITH CHECK requires it match auth.uid().
    data["provider_id"] = user_id
    return _stored(db.table(_TABLE).insert(data).execute().data)[0]


def _get_own(db: Client, user_id: str, event_id: str) -> StoredProviderEvent:
    rows = db.table(_TABLE).select("*").eq("id", event_id).eq("provider_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found")
    return _stored(rows)[0]


def update_event(
    db: Client, user_id: str, event_id: str, event: ProviderEventInput
) -> StoredProviderEvent:
    data = event.model_dump(mode="json")
    data["updated_at"] = _now().isoformat()
    # The status guard is part of the UPDATE itself, so a concurrent cancel
    # can't slip between a check and the write.
    rows = (
        db.table(_TABLE)
        .update(data)
        .eq("id", event_id)
        .eq("provider_id", user_id)
        .neq("status", ProviderEventStatus.cancelled.value)
        .execute()
        .data
    )
    if not rows:
        _get_own(db, user_id, event_id)  # 404 if it isn't theirs / doesn't exist
        raise HTTPException(status_code=409, detail="A cancelled event can't be edited")
    return _stored(rows)[0]


def _transition(
    db: Client,
    user_id: str,
    event_id: str,
    *,
    from_status: ProviderEventStatus,
    to_status: ProviderEventStatus,
    conflict: str,
) -> StoredProviderEvent:
    """Move an event between statuses atomically: the expected current status
    is a condition of the UPDATE, so two racing requests can't both succeed."""
    rows = (
        db.table(_TABLE)
        .update({"status": to_status.value, "updated_at": _now().isoformat()})
        .eq("id", event_id)
        .eq("provider_id", user_id)
        .eq("status", from_status.value)
        .execute()
        .data
    )
    if not rows:
        _get_own(db, user_id, event_id)
        raise HTTPException(status_code=409, detail=conflict)
    return _stored(rows)[0]


def publish_event(db: Client, user_id: str, event_id: str) -> StoredProviderEvent:
    current = _get_own(db, user_id, event_id)
    start = current.start_time
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    # All-day events are stored at local midnight, so "today" would already be
    # in the past by the time it's published — allow the same grace as the
    # public listing uses.
    if start < _now() - _PUBLIC_GRACE:
        raise HTTPException(status_code=409, detail="An event in the past can't be published")
    return _transition(
        db,
        user_id,
        event_id,
        from_status=ProviderEventStatus.draft,
        to_status=ProviderEventStatus.published,
        conflict="Only a draft can be published",
    )


def unpublish_event(db: Client, user_id: str, event_id: str) -> StoredProviderEvent:
    return _transition(
        db,
        user_id,
        event_id,
        from_status=ProviderEventStatus.published,
        to_status=ProviderEventStatus.draft,
        conflict="Only a published event can be unpublished",
    )


def cancel_event(db: Client, user_id: str, event_id: str) -> StoredProviderEvent:
    return _transition(
        db,
        user_id,
        event_id,
        from_status=ProviderEventStatus.published,
        to_status=ProviderEventStatus.cancelled,
        conflict="Only a published event can be cancelled",
    )


def delete_event(db: Client, user_id: str, event_id: str) -> None:
    """Delete a draft. Published events are cancelled instead (RLS enforces the
    same rule, so this can't be bypassed by calling PostgREST directly)."""
    rows = (
        db.table(_TABLE)
        .delete()
        .eq("id", event_id)
        .eq("provider_id", user_id)
        .eq("status", ProviderEventStatus.draft.value)
        .execute()
        .data
    )
    if not rows:
        _get_own(db, user_id, event_id)
        raise HTTPException(
            status_code=409, detail="Only a draft can be deleted — cancel the event instead"
        )
