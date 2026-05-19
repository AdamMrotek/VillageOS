# VillageOS — Backend

## Environment variables

Copy the example file and fill in the Supabase JWT secret from **Supabase dashboard → Project Settings → API → JWT Secret**:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL — used to fetch JWKS public keys for asymmetric JWT verification |
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

FastAPI verifies Supabase JWTs **asymmetrically** (RS256/ES256). On first call, `PyJWKClient` fetches Supabase's public signing keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and caches them; subsequent requests verify against the cached keys. No shared JWT secret is stored on the server. The `get_current_user` dependency in `app/core/auth.py` handles verification on every protected request.

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
| `SupabaseServiceRoleKey` | Supabase → Settings → API → service_role key |
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
