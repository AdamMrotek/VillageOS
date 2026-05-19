import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")

_bearer = HTTPBearer()


@dataclass
class AuthContext:
    user: dict
    token: str


async def get_auth(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> AuthContext:
    token = credentials.credentials
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload: dict = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
    return AuthContext(user=payload, token=token)


async def get_current_user(auth: AuthContext = Depends(get_auth)) -> dict:
    return auth.user
