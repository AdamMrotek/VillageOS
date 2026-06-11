import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def _fresh_settings():
    """Settings are cached per process; tests that monkeypatch env vars need the
    next get_settings() call to re-read the environment."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
