import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import get_current_user
from app.schemas.events import ExtractRequest, ExtractResponse
from app.services.extraction import extract_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extraction"])


@router.post("", response_model=ExtractResponse)
async def extract(
    body: ExtractRequest,
    request: Request,
    user: dict = Depends(get_current_user),
) -> ExtractResponse:
    request_id = getattr(request.state, "request_id", None)
    try:
        return await extract_event(body.raw_text, request_id=request_id)
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
