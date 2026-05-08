# VillageOS — Backend

## Environment variables

Copy the example file and fill in the Supabase JWT secret from **Supabase dashboard → Project Settings → API → JWT Secret**:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description |
|---|---|
| `SUPABASE_JWT_SECRET` | Supabase JWT secret for verifying access tokens |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (default: `http://localhost:3000`) |

---

## Managing Python dependencies

```bash
cd apps/api && source .venv/bin/activate
pip install <package>
pip freeze | grep <package> >> requirements.txt
```

---

## Auth flow (backend side)

FastAPI verifies Supabase JWTs using `PyJWT` with HS256 and the project JWT secret. The `get_current_user` dependency in `auth.py` handles verification on every protected request.

Protected route example:

```python
from auth import get_current_user
from fastapi import Depends

@app.get("/api/example")
async def example(user: dict = Depends(get_current_user)):
    return {"user_id": user["sub"], "email": user["email"]}
```

The decoded claims dict includes `sub` (Supabase user UUID), `email`, `role`, and standard JWT fields.

See [FRONTEND.md](FRONTEND.md#auth-flow-frontend-side) for how the frontend obtains and sends the token.
