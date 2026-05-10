from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user
from app.schemas.events import ExtractRequest, ExtractResponse
from app.services.extraction import extract_event

router = APIRouter(prefix="/api/extract", tags=["extraction"])


@router.post("", response_model=ExtractResponse)
async def extract(
    body: ExtractRequest,
    user: dict = Depends(get_current_user),
) -> ExtractResponse:
    try:
        return await extract_event(body.raw_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
