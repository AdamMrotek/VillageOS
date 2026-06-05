import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.services import events as events_service
from app.services.demo_seed import build_demo_events

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/seed", status_code=201)
async def seed_demo(
    request: Request,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    """Seed a guest's calendar with curated events. Anon-only and idempotent.

    Inserts via the user-scoped client so RLS sets `user_id` to the guest. Costs
    zero tokens — these are fully-formed events, not raw text to extract.
    """
    request_id = getattr(request.state, "request_id", None)

    if not auth.user.get("is_anonymous"):
        raise HTTPException(status_code=403, detail="Seeding is for demo sessions only")

    # Idempotent: a re-click (or a refresh that re-runs the flow) is a no-op.
    if events_service.list_events(db):
        return {"seeded": False}

    logger.info(
        "demo_session_started",
        extra={
            "event": "demo_session_started",
            "request_id": request_id,
            "user_id": auth.user["sub"],
        },
    )

    events = build_demo_events(date.today())
    for event in events:
        events_service.create_event(db, auth.user["sub"], event)

    logger.info(
        "demo_seeded",
        extra={
            "event": "demo_seeded",
            "request_id": request_id,
            "event_count": len(events),
        },
    )
    return {"seeded": True, "event_count": len(events)}
