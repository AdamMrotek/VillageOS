from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe. Bare 200 — no dependency checks (see ADR-014)."""
    return {"status": "ok"}
