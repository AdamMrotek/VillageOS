from functools import lru_cache

from fastapi import Depends
from supabase import Client, create_client

from app.core.auth import AuthContext, get_auth
from app.core.config import get_settings, require


def get_user_db(auth: AuthContext = Depends(get_auth)) -> Client:
    """Per-request Supabase client scoped to the caller's JWT.

    Queries run as the authenticated user, so RLS policies enforce
    row ownership at the database layer.
    """
    settings = get_settings()
    client = create_client(
        require(settings.supabase_url, "SUPABASE_URL"),
        require(settings.supabase_publishable_key, "SUPABASE_PUBLISHABLE_KEY"),
    )
    client.postgrest.auth(auth.token)
    return client


@lru_cache(maxsize=1)
def get_admin_db() -> Client:
    """Service-role client that bypasses RLS. Server-only, admin paths only
    (cron jobs, AI ingestion, cross-user reads). Never inject into user routes.
    """
    settings = get_settings()
    return create_client(
        require(settings.supabase_url, "SUPABASE_URL"),
        require(settings.supabase_secret_key, "SUPABASE_SECRET_KEY"),
    )
