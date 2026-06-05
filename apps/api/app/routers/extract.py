import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import get_current_user
from app.core.db import get_admin_db
from app.core.tiers import policy_for, resolve_tier
from app.schemas.events import ExtractRequest, ExtractResponse
from app.services.extraction import extract_event
from app.services.usage import bump_usage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extraction"])


@router.post("", response_model=ExtractResponse)
async def extract(
    body: ExtractRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> ExtractResponse:
    request_id = getattr(request.state, "request_id", None)

    # Cost guard: resolve the caller's tier off the JWT, then meter against a
    # per-identity daily quota before touching the paid model. Unlimited tiers
    # (daily_cap None) skip the counter write entirely.
    tier = resolve_tier(user)
    policy = policy_for(tier)

    if policy["daily_cap"] is not None:
        daily_count = bump_usage(get_admin_db(), user["sub"])
        if daily_count > policy["daily_cap"]:
            logger.info(
                "quota_exceeded",
                extra={
                    "event": "quota_exceeded",
                    "request_id": request_id,
                    "tier": tier,
                },
            )
            raise HTTPException(
                status_code=429,
                detail="Daily limit reached — sign up for more.",
            )
        logger.info(
            "extract_metered",
            extra={
                "event": "extract_metered",
                "request_id": request_id,
                "tier": tier,
                "daily_count": daily_count,
            },
        )

    try:
        return await extract_event(
            body.raw_text, request_id=request_id, model=policy["model"]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "extraction_failed",
            extra={
                "event": "extraction_failed",
                "request_id": request_id,
                "path": request.url.path,
            },
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while processing the text.",
        ) from e
