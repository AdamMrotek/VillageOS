"""Events a provider publishes on their public page.

Shares the `/api/providers` prefix with routers/providers.py. Every path here
has at least two segments (`/me/events…`, `/{provider_id}/events`), so none of
them can be captured by that router's single-segment `/{user_id}` route.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.schemas.provider_events import ProviderEventInput, StoredProviderEvent
from app.services import provider_events as service

router = APIRouter(prefix="/api/providers", tags=["provider-events"])


@router.get("/me/events", response_model=list[StoredProviderEvent])
async def list_my_events(
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.list_my_events(db, auth.user["sub"])


@router.post("/me/events", response_model=StoredProviderEvent, status_code=201)
async def create_event(
    body: ProviderEventInput,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.create_event(db, auth.user["sub"], body)


@router.put("/me/events/{event_id}", response_model=StoredProviderEvent)
async def update_event(
    event_id: UUID,
    body: ProviderEventInput,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.update_event(db, auth.user["sub"], str(event_id), body)


@router.post("/me/events/{event_id}/publish", response_model=StoredProviderEvent)
async def publish_event(
    event_id: UUID,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.publish_event(db, auth.user["sub"], str(event_id))


@router.post("/me/events/{event_id}/unpublish", response_model=StoredProviderEvent)
async def unpublish_event(
    event_id: UUID,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.unpublish_event(db, auth.user["sub"], str(event_id))


@router.post("/me/events/{event_id}/cancel", response_model=StoredProviderEvent)
async def cancel_event(
    event_id: UUID,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.cancel_event(db, auth.user["sub"], str(event_id))


@router.delete("/me/events/{event_id}", status_code=204)
async def delete_event(
    event_id: UUID,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    service.delete_event(db, auth.user["sub"], str(event_id))
    return Response(status_code=204)


@router.get("/{provider_id}/events", response_model=list[StoredProviderEvent])
async def list_provider_events(
    provider_id: UUID,
    db: Client = Depends(get_user_db),
):
    return service.list_public_events(db, str(provider_id))
