"""Router-level vision behavior: an image request pins the configured default
provider's vision model (no escalation), while a text request flows through with
no provider/model override (the env-default production path)."""

from datetime import datetime
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request

import app.routers.extract as extract_router
from app.schemas.events import ExtractRequest, ExtractResponse, ParentEvent

IMAGE_URL = "data:image/jpeg;base64,aGVsbG8="


def _response() -> ExtractResponse:
    return ExtractResponse(
        event=ParentEvent(
            title="Bake Sale",
            event_type="fundraiser",
            start_time=datetime(2026, 5, 15, 15, 0),
            confidence=0.9,
        ),
        model_used="gpt-4o",
        tokens_used=120,
    )


@pytest.fixture
def harness(monkeypatch):
    """Stub the quota + extraction seams around the router."""
    calls = SimpleNamespace(extract_kwargs=None)

    async def fake_extract_event(raw_text, **kwargs):
        calls.extract_kwargs = {"raw_text": raw_text, **kwargs}
        return _response()

    monkeypatch.setattr(extract_router, "get_admin_db", lambda: object())
    monkeypatch.setattr(extract_router, "bump_usage", lambda db, uid: 1)
    monkeypatch.setattr(extract_router, "extract_event", fake_extract_event)
    return calls


def _request() -> Request:
    # The router only reads .state.request_id and .url.path; a namespace
    # stands in for a real starlette Request.
    return cast(
        Request,
        SimpleNamespace(
            state=SimpleNamespace(request_id="req-1"),
            url=SimpleNamespace(path="/api/extract"),
        ),
    )


USER = {"sub": "u1"}


class TestVisionRequest:
    async def test_image_pins_default_vision_model(self, harness):
        body = ExtractRequest(image_data_url=IMAGE_URL)
        await extract_router.extract(body, _request(), USER)

        default_provider, default_vision_model = extract_router.get_vision_defaults()
        assert harness.extract_kwargs["provider"] == default_provider
        assert harness.extract_kwargs["model"] == default_vision_model
        assert harness.extract_kwargs["image_data_url"] == IMAGE_URL

    async def test_caption_forwarded_alongside_image(self, harness):
        body = ExtractRequest(raw_text="for Mia", image_data_url=IMAGE_URL)
        await extract_router.extract(body, _request(), USER)
        assert harness.extract_kwargs["raw_text"] == "for Mia"
        assert harness.extract_kwargs["image_data_url"] == IMAGE_URL


class TestTextRequest:
    async def test_text_flows_through_without_overrides(self, harness):
        body = ExtractRequest(raw_text="Bake sale Friday 3pm")
        await extract_router.extract(body, _request(), USER)

        # No overrides on the text path: provider/model flow through as None so
        # extract_event runs the env default with low-confidence escalation.
        assert harness.extract_kwargs["provider"] is None
        assert harness.extract_kwargs["model"] is None
        assert harness.extract_kwargs["image_data_url"] is None
