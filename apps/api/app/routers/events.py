from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import get_current_user
from app.core.db import get_supabase
from app.schemas.events import ParentEvent, StoredEvent
from app.services import events as events_service

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("", response_model=StoredEvent, status_code=201)
async def create_event(
    body: ParentEvent,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    return events_service.create_event(db, user["sub"], body)


@router.get("", response_model=list[StoredEvent])
async def list_events(
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    return events_service.list_events(db, user["sub"])
