"""Analytics ingest — the client-emitted half of the extraction funnel.

Replaces the web app's PostHog `capture()` calls (dropped 2026-06-26). The
browser POSTs the three UX events here; `distinct_id` is taken from the verified
JWT `sub`, never the body, so a caller can only ever write events as themselves.
The server-emitted `extraction_assigned` is captured in /api/extract, not here.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.experiments import capture_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Only the funnel's client-side events. Keep this in lockstep with the web
# tracker (apps/web/src/lib/analytics.ts) and the readout views.
_ALLOWED_EVENTS = {"extraction_shown", "extraction_accepted", "extraction_discarded"}


class AnalyticsEvent(BaseModel):
    event: str
    properties: dict = Field(default_factory=dict)


@router.post("/events", status_code=204)
async def capture(body: AnalyticsEvent, user: dict = Depends(get_current_user)) -> None:
    """Record a client funnel event under the caller's identity."""
    if body.event not in _ALLOWED_EVENTS:
        raise HTTPException(status_code=422, detail="Unknown analytics event")
    capture_event(user["sub"], body.event, body.properties)
