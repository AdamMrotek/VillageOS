import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user
from app.schemas.events import ExtractRequest, ExtractResponse
from app.services.extraction import extract_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extraction"])


@router.post("", response_model=ExtractResponse)
async def extract(
    body: ExtractRequest,
    user: dict = Depends(get_current_user),
) -> ExtractResponse:
    try:
        return await extract_event(body.raw_text)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to extract event")
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while processing the text.",
        ) from e
