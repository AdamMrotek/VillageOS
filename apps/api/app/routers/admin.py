"""Admin API — powers the admin.villageos.co.uk dashboard.

Gated to `role = 'admin'`. The role is read from the `profiles` table via the
service-role client, not from the JWT, because `user_metadata.role` is
user-editable and so can't be trusted as an authorization boundary. The
dashboard is the offline extraction-eval viewer (results + golden dataset).
"""

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.db import get_admin_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# The eval runner writes here and the golden cases live here; both are git-tracked
# and ship inside the Lambda bundle (CodeUri: . with no .samignore), so the admin
# dashboard can read them at runtime. `parents[2]` walks app/routers/ -> app/ ->
# apps/api root.
_API_ROOT = Path(__file__).resolve().parents[2]
_RESULTS_JSONL = _API_ROOT / "evals" / "extraction" / "results.jsonl"
_GOLDEN_DIR = _API_ROOT / "tests" / "golden"
_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
# case_id comes from the URL; restrict it to the stem charset before it touches
# the filesystem so a crafted id can't escape the golden dir.
_CASE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


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
        # Log the full exception (type + message + traceback) so a 500 here is
        # diagnosable — the bare event name told us nothing about the cause.
        logger.exception(
            "admin_role_check_failed",
            extra={
                "event": "admin_role_check_failed",
                "user_id": sub,
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail="Could not verify admin role") from exc
    rows = cast(list[dict], res.data or [])
    if not rows or rows[0].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Eval presentation ───────────────────────────────────────────────────────
# Read-only views of the offline extraction eval the CLI produces. The admin app
# replaced the standalone eval-viewer SPA; these endpoints serve what it used to
# read from the JSONL/golden files directly.


class GoldenCase(BaseModel):
    """One golden case as the dashboard renders it: the input the model sees plus
    the partial expected spec it's graded against."""

    case_id: str
    input_text: str
    expected: dict[str, Any]
    has_image: bool
    image_ext: str | None


def _golden_image_path(case_id: str) -> Path | None:
    """The image file for a golden case, or None for a text-only case."""
    for ext in _IMAGE_EXTS:
        candidate = _GOLDEN_DIR / f"{case_id}{ext}"
        if candidate.is_file():
            return candidate
    return None


@router.get("/evals/results")
async def eval_results(_: dict = Depends(require_admin)) -> dict:
    """Every row the eval runner has appended to results.jsonl. The dashboard
    groups them by run client-side. Missing/partial file degrades to no rows."""
    if not _RESULTS_JSONL.is_file():
        return {"rows": []}
    rows: list[dict] = []
    try:
        for line in _RESULTS_JSONL.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                # Append-only JSONL; skip a partial/corrupt trailing line rather
                # than 500 the whole readout.
                continue
    except OSError:
        logger.exception("eval_results_read_failed", extra={"event": "eval_results_read_failed"})
        return {"rows": []}
    return {"rows": rows}


@router.get("/evals/golden")
async def golden_cases(_: dict = Depends(require_admin)) -> dict:
    """The golden dataset: one entry per `<case>.json`. Text cases pair with a
    sibling `.txt`; vision cases carry the input as a `transcript` field."""
    if not _GOLDEN_DIR.is_dir():
        return {"cases": []}
    cases: list[GoldenCase] = []
    for json_path in sorted(_GOLDEN_DIR.glob("*.json")):
        case_id = json_path.stem
        try:
            expected = json.loads(json_path.read_text())
        except (OSError, json.JSONDecodeError):
            logger.warning(
                "golden_case_unreadable",
                extra={"event": "golden_case_unreadable", "case_id": case_id},
            )
            continue
        if not isinstance(expected, dict):
            continue
        txt_path = json_path.with_suffix(".txt")
        if txt_path.is_file():
            input_text = txt_path.read_text()
        else:
            transcript = expected.get("transcript")
            input_text = transcript if isinstance(transcript, str) else ""
        image_path = _golden_image_path(case_id)
        cases.append(
            GoldenCase(
                case_id=case_id,
                input_text=input_text,
                expected=expected,
                has_image=image_path is not None,
                image_ext=image_path.suffix.lstrip(".") if image_path else None,
            )
        )
    return {"cases": [c.model_dump() for c in cases]}


@router.get("/evals/golden/{case_id}/image")
async def golden_case_image(case_id: str, _: dict = Depends(require_admin)) -> FileResponse:
    """The input image for a vision golden case. 404 for text-only cases."""
    if not _CASE_ID_RE.match(case_id):
        raise HTTPException(status_code=400, detail="Invalid case id")
    image_path = _golden_image_path(case_id)
    if image_path is None:
        raise HTTPException(status_code=404, detail="No image for this case")
    # Golden images are immutable fixtures — let the browser keep them in its
    # private cache so re-expanding a case or reloading the page doesn't refetch.
    return FileResponse(image_path, headers={"Cache-Control": "private, max-age=86400"})
