"""Admin API — powers the admin.villageos.co.uk dashboard.

Gated to `role = 'admin'`. The role is read from the `profiles` table via the
service-role client, not from the JWT, because `user_metadata.role` is
user-editable and so can't be trusted as an authorization boundary. The
experiment readouts come straight from the Postgres views that replaced the
PostHog HogQL tiles (see supabase migration + apps/api/EXPERIMENTS.md).
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.db import get_admin_db
from app.core.experiments import EXTRACTION_MODEL_FLAG, invalidate_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _is_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """403 unless the caller's profile row has role = 'admin'."""
    sub = user.get("sub")
    if not _is_uuid(sub):
        # A signature-valid token with no usable `sub` (e.g. not a user access
        # token) is an auth failure, not a server error — and never an admin.
        # Guarding here also stops a non-UUID `sub` reaching the UUID `id`
        # column, which Postgres would reject as a 500. Log the claim keys so an
        # unexpected token shape is diagnosable.
        logger.warning(
            "admin_missing_subject",
            extra={"event": "admin_missing_subject", "claims": sorted(user.keys())},
        )
        raise HTTPException(status_code=401, detail="Token has no user subject")
    try:
        res = get_admin_db().table("profiles").select("role").eq("id", sub).limit(1).execute()
    except Exception as exc:
        logger.error("admin_role_check_failed", extra={"event": "admin_role_check_failed", "user_id": sub})
        raise HTTPException(status_code=500, detail="Could not verify admin role") from exc
    rows = cast(list[dict], res.data or [])
    if not rows or rows[0].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class ExperimentConfig(BaseModel):
    """The extraction A/B's config row — its enabled flag plus the split it would
    apply when on. The admin dashboard reads this to render the toggle."""

    enabled: bool
    variants: dict[str, float]
    default_variant: str


class ExperimentConfigUpdate(BaseModel):
    enabled: bool


def _extraction_config_row() -> ExperimentConfig:
    """The seeded `extraction-model` row, or 404 if the seed migration never ran."""
    db = get_admin_db()
    res = (
        db.table("experiments")
        .select("enabled, variants, default_variant")
        .eq("key", EXTRACTION_MODEL_FLAG)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict], res.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Experiment not configured")
    return ExperimentConfig(**rows[0])


@router.get("/experiments/extraction/config")
async def get_extraction_config(_: dict = Depends(require_admin)) -> ExperimentConfig:
    """Current config for the extraction A/B — powers the dashboard's enable toggle."""
    return _extraction_config_row()


@router.patch("/experiments/extraction/config")
async def update_extraction_config(
    body: ExperimentConfigUpdate, _: dict = Depends(require_admin)
) -> ExperimentConfig:
    """Flip the extraction A/B's kill-switch. Invalidates the API's config cache so
    the change applies on the next extraction rather than after the TTL window."""
    db = get_admin_db()
    res = (
        db.table("experiments")
        .update({"enabled": body.enabled, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("key", EXTRACTION_MODEL_FLAG)
        .execute()
    )
    rows = cast(list[dict], res.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Experiment not configured")
    invalidate_config(EXTRACTION_MODEL_FLAG)
    return ExperimentConfig(**rows[0])


@router.get("/experiments/extraction")
async def extraction_experiment(_: dict = Depends(require_admin)) -> dict:
    """The two A/B readouts the dashboard renders: outcomes per arm, and per-field
    edit rate. Read direction only at low N (see EXPERIMENTS.md).

    A transient view/DB error degrades to empty readouts (the dashboard shows its
    "no data yet" state) rather than surfacing a raw 500 — consistent with how the
    rest of the admin/capture paths fail soft."""
    db = get_admin_db()
    try:
        outcomes = db.table("experiment_extraction_outcomes").select("*").execute().data or []
        field_edits = db.table("experiment_extraction_field_edits").select("*").execute().data or []
    except Exception:
        logger.exception("experiment_readout_failed", extra={"event": "experiment_readout_failed"})
        return {"outcomes": [], "field_edits": []}
    return {"outcomes": outcomes, "field_edits": field_edits}
