"""Central typed configuration — the single place env vars enter the API.

Every setting the service reads is declared here as a typed field; nothing
else in `app/` touches `os.environ`. Fields keep permissive defaults so the
app imports cleanly in tests/CI with no environment configured — callers that
*need* a value validate at point of use with a clear error naming the env var.

Settings reads `os.environ` only — entry points (main.py, eval scripts) call
`load_dotenv()` first, so `.env` works in dev and `monkeypatch.setenv/delenv`
behaves predictably in tests. `get_settings()` is cached per process
(Lambda-friendly); tests clear the cache via the autouse fixture in
`tests/conftest.py`.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # Supabase — see .env.example for where each key comes from.
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""

    # LLM providers
    llm_provider: str = "openai"
    instructor_mode: str | None = None
    openai_api_key: str | None = None
    groq_api_key: str | None = None

    # Provider-cover uploads (S3 presigned POST → CloudFront)
    aws_region: str = "eu-north-1"
    provider_cover_bucket: str | None = None
    provider_cover_cdn_domain: str | None = None

    # App
    allowed_origins: str = "http://localhost:3000"
    log_level: str = "INFO"

    @property
    def allowed_origins_list(self) -> list[str]:
        return self.allowed_origins.split(",")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def require(value: str | None, env_name: str) -> str:
    """Assert an optional setting is configured, at the point it's first needed.

    Settings fields stay optional so the app imports with no environment
    (tests, partial local configs, routes that never touch the value); callers
    that can't proceed without one fail here with the env var named.
    """
    if not value:
        raise RuntimeError(f"Missing required configuration: {env_name} (see .env.example).")
    return value
