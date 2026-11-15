"""A parent's reservation on a provider's event.

One reservation per parent per event, so the resource is singular and keyed by
the event: PUT sets it (reserve, re-confirm or change the spot count), DELETE
cancels it. The reserved event then appears in the parent's calendar through
`GET /api/events`.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.schemas.reservations import ReservationInput, StoredReservation
from app.services import reservations as service

router = APIRouter(prefix="/api/provider-events", tags=["reservations"])


@router.put("/{event_id}/reservation", response_model=StoredReservation)
async def reserve(
    event_id: UUID,
    body: ReservationInput,
    _: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.reserve(db, str(event_id), body.spots)


@router.delete("/{event_id}/reservation", response_model=StoredReservation)
async def cancel_reservation(
    event_id: UUID,
    _: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return service.cancel(db, str(event_id))


@router.post("/{event_id}/reservation/seen", response_model=StoredReservation)
async def mark_seen(
    event_id: UUID,
    _: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    """The parent opened the event: acknowledge the provider's latest change."""
    return service.mark_seen(db, str(event_id))
