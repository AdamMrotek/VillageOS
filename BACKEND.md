# VillageOS — Backend

## Environment variables

Copy the example file and fill in the Clerk values from **Clerk dashboard → API Keys**:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description |
|---|---|
| `CLERK_JWKS_URL` | Clerk JWKS endpoint for JWT verification |
| `CLERK_ISSUER` | Clerk issuer URL |

---

## Managing Python dependencies

```bash
cd apps/api && source .venv/bin/activate
pip install <package>
pip freeze | grep <package> >> requirements.txt
```

---

## Auth flow (backend side)

FastAPI verifies the Clerk JWT using the `get_current_user` dependency, which fetches Clerk's JWKS and validates the token on every request.

Protected route example:

```python
from auth import get_current_user
from fastapi import Depends

@app.get("/api/example")
async def example(user: dict = Depends(get_current_user)):
    return {"user_id": user["sub"]}
```

The decoded claims dict includes `sub` (Clerk user ID) and standard JWT fields.

See [FRONTEND.md](FRONTEND.md#auth-flow-frontend-side) for how the frontend obtains and sends the token.
