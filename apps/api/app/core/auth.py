import logging
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import get_settings, require

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        supabase_url = require(get_settings().supabase_url, "SUPABASE_URL")
        _jwks_client = PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json")
    return _jwks_client


@dataclass
class AuthContext:
    user: dict
    token: str


async def get_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> AuthContext:
    request_id = getattr(request.state, "request_id", None)
    token = credentials.credentials
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload: dict = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired") from None
    except jwt.InvalidTokenError as exc:
        logger.warning(
            "auth_failed",
            extra={
                "event": "auth_failed",
                "request_id": request_id,
                "reason": str(exc),
            },
        )
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    return AuthContext(user=payload, token=token)


async def get_current_user(auth: AuthContext = Depends(get_auth)) -> dict:
    return auth.user
