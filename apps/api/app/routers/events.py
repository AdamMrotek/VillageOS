from fastapi import APIRouter, Depends, Response
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.schemas.events import (
    ActionItemUpdate,
    ParentEvent,
    StoredActionItem,
    StoredEvent,
)
from app.services import events as events_service

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("", response_model=StoredEvent, status_code=201)
async def create_event(
    body: ParentEvent,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return events_service.create_event(db, auth.user["sub"], body)


@router.get("", response_model=list[StoredEvent])
async def list_events(db: Client = Depends(get_user_db)):
    return events_service.list_events(db)


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: Client = Depends(get_user_db),
):
    events_service.delete_event(db, event_id)
    return Response(status_code=204)


action_items_router = APIRouter(prefix="/api/action_items", tags=["action_items"])


@action_items_router.patch("/{item_id}", response_model=StoredActionItem)
async def update_action_item(
    item_id: str,
    body: ActionItemUpdate,
    db: Client = Depends(get_user_db),
):
    return events_service.set_action_item_done(db, item_id, body.done)
