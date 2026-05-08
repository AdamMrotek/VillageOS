# VillageOS — Development Reference

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| pnpm | 11 | `npm i -g pnpm` |
| Python | ≥ 3.11 | [python.org](https://python.org) |
| Turbo | via pnpm | included in dev deps |

---

## One-time setup

### 1. Install JS dependencies
```bash
pnpm install
```

### 2. Bootstrap the Python API
```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

**Frontend** — copy and fill in Supabase keys:
```bash
cp apps/web/.env.local.example apps/web/.env.local
```

**Backend** — copy and fill in the Supabase JWT secret:
```bash
cp apps/api/.env.example apps/api/.env
```

See [FRONTEND.md](FRONTEND.md#environment-variables) and [BACKEND.md](BACKEND.md#environment-variables) for the required keys in each service.

---

## Running the stack

### Full stack (recommended)
Starts Next.js on port 3000 and FastAPI on port 8000 in parallel via Turborepo.

> The Python venv must be active before running this, or uvicorn must be in your PATH.

```bash
source apps/api/.venv/bin/activate   # if not already active
pnpm dev
```

### Individual services
```bash
# Next.js only
pnpm dev --filter @repo/web

# FastAPI only (from apps/api with venv active)
cd apps/api && python -m uvicorn main:app --reload --port 8000
```

---

## Port reference

| Service | URL |
|---|---|
| Next.js | http://localhost:3000 |
| FastAPI | http://localhost:8000 |
| FastAPI docs | http://localhost:8000/docs |

---

## Further reading

- [FRONTEND.md](FRONTEND.md) — Next.js env setup, dependencies, build/lint, shadcn, auth
- [BACKEND.md](BACKEND.md) — FastAPI env setup, Python dependencies, auth
