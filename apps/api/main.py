from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.routers import account, admin, demo, events, extract, health, providers

# Populate os.environ from .env before the first get_settings() call below.
# Nothing reads configuration at import time, so this no longer needs to
# precede the app imports.
load_dotenv()
configure_logging()

app = FastAPI(title="VillageOS API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestContextMiddleware)

app.include_router(health.router)
app.include_router(events.router)
app.include_router(events.action_items_router)
app.include_router(extract.router)
app.include_router(demo.router)
app.include_router(providers.router)
app.include_router(account.router)
app.include_router(admin.router)


@app.get("/api/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "user_id": user.get("sub"),
        "email": user.get("email"),
        "role": user.get("role"),
    }
