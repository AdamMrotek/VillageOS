from fastapi import APIRouter, Depends
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_user_db
from app.schemas.providers import ProviderProfileInput, StoredProviderProfile
from app.services import providers as providers_service

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("", response_model=list[StoredProviderProfile])
async def search_providers(
    q: str | None = None,
    db: Client = Depends(get_user_db),
):
    return providers_service.search_providers(db, q)


# Declared before "/{user_id}" so "me" isn't captured as a path param.
@router.get("/me", response_model=StoredProviderProfile | None)
async def get_my_provider(
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return providers_service.get_my_provider(db, auth.user["sub"])


@router.put("/me", response_model=StoredProviderProfile)
async def upsert_my_provider(
    body: ProviderProfileInput,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    return providers_service.upsert_my_provider(db, auth.user["sub"], body)


@router.get("/{user_id}", response_model=StoredProviderProfile)
async def get_provider(
    user_id: str,
    db: Client = Depends(get_user_db),
):
    return providers_service.get_provider(db, user_id)
