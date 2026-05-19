# VillageOS — Backend

## Environment variables

Copy the example file and fill in the Supabase keys from **Supabase dashboard → Project Settings → API Keys**:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL — used to fetch JWKS public keys for asymmetric JWT verification |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` — used to build per-request, JWT-scoped clients in user routes; RLS is enforced |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` — server-only, bypasses RLS. Reserved for admin paths (cron jobs, AI ingestion). Never expose to the browser |
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

FastAPI verifies Supabase JWTs **asymmetrically** (RS256/ES256). On first call, `PyJWKClient` fetches Supabase's public signing keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and caches them; subsequent requests verify against the cached keys. No shared JWT secret is stored on the server.

`app/core/auth.py` exposes two dependencies:

- **`get_auth`** — returns an `AuthContext(user, token)` for routes that need to forward the raw JWT (e.g. to scope a Supabase client).
- **`get_current_user`** — thin wrapper that returns just the decoded payload; use when the route doesn't touch the DB.

```python
from app.core.auth import get_current_user
from fastapi import Depends

@app.get("/api/example")
async def example(user: dict = Depends(get_current_user)):
    return {"user_id": user["sub"], "email": user["email"]}
```

The decoded claims dict includes `sub` (Supabase user UUID), `email`, `role`, and standard JWT fields.

### Database access pattern

`app/core/db.py` provides two clients:

- **`get_user_db`** — per-request Supabase client built with the **publishable key**, scoped to the caller's JWT (`client.postgrest.auth(token)`). Queries run as the authenticated user, so **RLS policies enforce row ownership at the database layer**. Use this for every user-facing route.
- **`get_admin_db`** — cached service-role client built with the **secret key**. Bypasses RLS. Reserved for admin paths (cron jobs, AI ingestion, cross-user reads). Never inject into user routes.

This means service-layer code does **not** need to filter by `user_id` — RLS does it. The one exception is `INSERT`s, which must include `user_id` so the `WITH CHECK (auth.uid() = user_id)` policy passes.

See [FRONTEND.md](FRONTEND.md#auth-flow-frontend-side) for how the frontend obtains and sends the token.

---

## Deploying to AWS Lambda

The API is packaged as a Lambda function fronted by API Gateway (HTTP API). FastAPI runs via the [Mangum](https://github.com/jordaneremieff/mangum) ASGI adapter — see `lambda_handler.py`.

### Prerequisites

```bash
brew install awscli aws-sam-cli
aws configure   # paste IAM access key + secret, default region (e.g. eu-west-1)
```

Set a **billing alert** in the AWS console (Billing → Budgets) before first deploy.

### First deploy

From `apps/api`:

```bash
sam build
sam deploy --guided
```

The guided prompt asks for stack name (`villageos-api`), region, and the parameter values declared in `template.yaml`:

| Parameter | Source |
|---|---|
| `SupabaseUrl` | Supabase → Settings → API → Project URL (Lambda fetches JWKS from `{url}/auth/v1/.well-known/jwks.json`) |
| `SupabasePublishableKey` | Supabase → Settings → API Keys → publishable key (`sb_publishable_...`) |
| `SupabaseSecretKey` | Supabase → Settings → API Keys → secret key (`sb_secret_...`) |
| `OpenAiApiKey` | platform.openai.com → API keys |
| `GroqApiKey` | console.groq.com → API keys (optional) |
| `LlmProvider` | `openai` or `groq` |
| `AllowedOrigins` | comma-separated, e.g. `https://villageos.dev,http://localhost:3000` |

Accept the `Save arguments to configuration file` prompt — subsequent deploys are just `sam deploy`.

The output `ApiUrl` is the base URL to put in the frontend's `NEXT_PUBLIC_API_URL` env var.

### Subsequent deploys

```bash
sam build && sam deploy
```

### Tailing logs

```bash
sam logs -n ApiFunction --stack-name villageos-api --tail
```
