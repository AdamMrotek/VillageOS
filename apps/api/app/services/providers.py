from datetime import UTC, datetime

from fastapi import HTTPException
from supabase import Client

from app.schemas.providers import ProviderProfileInput, StoredProviderProfile


def search_providers(db: Client, q: str | None) -> list[StoredProviderProfile]:
    """Public directory search. Matches provider name (case-insensitive substring)."""
    query = db.table("provider_profiles").select("*").order("name", desc=False)
    if q:
        query = query.ilike("name", f"%{q}%")
    rows = query.execute().data
    return [StoredProviderProfile.model_validate(row) for row in rows]


def get_provider(db: Client, user_id: str) -> StoredProviderProfile:
    rows = db.table("provider_profiles").select("*").eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Provider not found")
    return StoredProviderProfile.model_validate(rows[0])


def get_my_provider(db: Client, user_id: str) -> StoredProviderProfile | None:
    rows = db.table("provider_profiles").select("*").eq("user_id", user_id).execute().data
    if not rows:
        return None
    return StoredProviderProfile.model_validate(rows[0])


def upsert_my_provider(
    db: Client, user_id: str, profile: ProviderProfileInput
) -> StoredProviderProfile:
    # user_id must be set explicitly — RLS WITH CHECK requires it match auth.uid().
    data = profile.model_dump(mode="json")
    data["user_id"] = user_id
    data["updated_at"] = datetime.now(UTC).isoformat()

    row = db.table("provider_profiles").upsert(data).execute().data[0]
    return StoredProviderProfile.model_validate(row)
