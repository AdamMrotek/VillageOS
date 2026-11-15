import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from supabase import Client

from app.core.auth import AuthContext, get_auth
from app.core.db import get_admin_db, get_user_db
from app.schemas.profiles import Preferences
from app.services import provider_media

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/account", tags=["account"])


@router.delete("", status_code=204)
async def delete_account(
    request: Request,
    auth: AuthContext = Depends(get_auth),
):
    """Permanently delete the caller's account and all associated data.

    Self-service erasure (UK GDPR right to be forgotten). Deleting the auth user
    cascades to every user-owned table — profiles, events → action_items,
    usage_counters, provider_profiles — via their ON DELETE CASCADE foreign keys
    to auth.users(id), so a single admin call wipes the user's entire footprint.

    Provider cover images live in S3, outside Postgres, so the cascade can't
    reach them; they're swept separately below.

    Needs the service-role client (get_admin_db) because deleting an auth user is
    an admin operation; it's called explicitly here rather than injected, since
    this route deliberately acts on the caller's own identity only.
    """
    user_id = auth.user["sub"]
    request_id = getattr(request.state, "request_id", None)

    # The personal data lives in Postgres — delete that first and treat it as the
    # operation that must succeed. Cover-image cleanup is a best-effort follow-up.
    try:
        get_admin_db().auth.admin.delete_user(user_id)
    except Exception as exc:
        logger.error(
            "account_delete_failed",
            extra={
                "event": "account_delete_failed",
                "request_id": request_id,
                "user_id": user_id,
                "reason": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail="Account deletion failed") from exc

    # Best-effort: a public org logo carries no personal data, so a storage hiccup
    # must not fail a deletion whose personal data is already gone. A leftover
    # object is logged for manual cleanup rather than surfaced to the caller.
    try:
        provider_media.delete_cover_objects(user_id)
    except Exception as exc:
        logger.error(
            "account_media_cleanup_failed",
            extra={
                "event": "account_media_cleanup_failed",
                "request_id": request_id,
                "user_id": user_id,
                "reason": str(exc),
            },
        )

    logger.info(
        "account_deleted",
        extra={
            "event": "account_deleted",
            "request_id": request_id,
            "user_id": user_id,
        },
    )
    return Response(status_code=204)


@router.get("/preferences", response_model=Preferences)
async def get_preferences(
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    rows = db.table("profiles").select("event_emails").eq("id", auth.user["sub"]).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found")
    return rows[0]


@router.put("/preferences", response_model=Preferences)
async def update_preferences(
    body: Preferences,
    auth: AuthContext = Depends(get_auth),
    db: Client = Depends(get_user_db),
):
    """Runs as the caller: RLS limits it to their own row, and column
    privileges limit it to the fields a user may change about themselves."""
    rows = db.table("profiles").update(body.model_dump()).eq("id", auth.user["sub"]).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found")
    return rows[0]
