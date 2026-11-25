"""The parent-facing Discover home page (docs/PROVIDER_EVENTS_PLAN.md §4)."""

from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.schemas.discover import DiscoverHome, DiscoverKind
from app.services import discover as service

router = APIRouter(prefix="/api/discover", tags=["discover"])


@router.get("/home", response_model=DiscoverHome)
async def discover_home(
    kind: DiscoverKind = DiscoverKind.all,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    """The browse page: a featured item and an ordered list of rows. `kind` is
    the chip the parent selected."""
    return service.home(db, auth.user["sub"], kind)
