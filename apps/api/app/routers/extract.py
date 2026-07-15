import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import get_current_user
from app.core.db import get_admin_db
from app.core.experiments import (
    EXTRACTION_MODEL_FLAG,
    assign_extraction_variant,
    capture_assignment,
)
from app.core.tiers import policy_for, resolve_tier
from app.schemas.events import ExperimentInfo, ExtractRequest, ExtractResponse
from app.services.extraction import VISION_PROVIDER, extract_event, get_vision_model
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

    # A/B arm assignment (move 1, redefined per ADR-019): each arm is a provider
    # stack covering both paths, so vision requests ride the same experiment as
    # text. Server-authoritative + deterministic per user. Disabled (experiment
    # row absent/disabled) -> ("control", None, None): no override, so text is
    # byte-for-byte the pre-experiment path and vision falls back to the pinned
    # default below. Funnel events carry input_type, so per-path analysis
    # filters cleanly.
    is_vision = body.image_data_url is not None
    variant, provider, model = assign_extraction_variant(user["sub"], vision=is_vision)
    if is_vision and provider is None:
        # Experiment disabled (or arm unkeyed): pre-experiment vision default.
        provider, model = VISION_PROVIDER, get_vision_model()

    try:
        response = await extract_event(
            body.raw_text,
            request_id=request_id,
            image_data_url=body.image_data_url,
            provider=provider,
            model=model or policy["model"],
        )
        capture_assignment(user["sub"], variant, provider, model)
        response.experiment = ExperimentInfo(
            flag=EXTRACTION_MODEL_FLAG, variant=variant, provider=provider, model=model
        )
        return response
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
