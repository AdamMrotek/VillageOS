"""Admin API — powers the admin.villageos.co.uk dashboard.

Gated to `role = 'admin'`. The role is read from the `profiles` table via the
service-role client, not from the JWT, because `user_metadata.role` is
user-editable and so can't be trusted as an authorization boundary. The
experiment readouts come straight from the Postgres views that replaced the
PostHog HogQL tiles (see supabase migration + apps/api/EXPERIMENT_DASHBOARD.md).
"""

import logging
from typing import cast

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user
from app.core.db import get_admin_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """403 unless the caller's profile row has role = 'admin'."""
    sub = user.get("sub")
    try:
        res = get_admin_db().table("profiles").select("role").eq("id", sub).limit(1).execute()
    except Exception as exc:
        logger.error("admin_role_check_failed", extra={"event": "admin_role_check_failed", "user_id": sub})
        raise HTTPException(status_code=500, detail="Could not verify admin role") from exc
    rows = cast(list[dict], res.data or [])
    if not rows or rows[0].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/experiments/extraction")
async def extraction_experiment(_: dict = Depends(require_admin)) -> dict:
    """The two A/B readouts the dashboard renders: outcomes per arm, and per-field
    edit rate. Read direction only at low N (see EXPERIMENTS.md)."""
    db = get_admin_db()
    outcomes = db.table("experiment_extraction_outcomes").select("*").execute().data or []
    field_edits = db.table("experiment_extraction_field_edits").select("*").execute().data or []
    return {"outcomes": outcomes, "field_edits": field_edits}
