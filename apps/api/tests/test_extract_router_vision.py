"""Router-level vision behavior (ADR-019): image requests ride the same A/B
flag as text — the assigned arm's stack serves both paths. With the experiment
disabled (assignment passthrough) vision falls back to the configured default
provider's vision model, so prod behaviour with the experiment disabled is
unchanged."""

from datetime import datetime
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request

import app.routers.extract as extract_router
from app.schemas.events import ExtractRequest, ExtractResponse, ParentEvent

IMAGE_URL = "data:image/jpeg;base64,aGVsbG8="
QWEN = "qwen/qwen3.6-27b"


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
    """Stub everything around the router: quota, extraction, experiment."""
    calls = SimpleNamespace(
        extract_kwargs=None,
        assign_args=None,
        assignment=("control", None, None),
        captures=[],
    )

    async def fake_extract_event(raw_text, **kwargs):
        calls.extract_kwargs = {"raw_text": raw_text, **kwargs}
        return _response()

    def fake_assign(user_id, *, vision=False):
        calls.assign_args = {"user_id": user_id, "vision": vision}
        return calls.assignment

    monkeypatch.setattr(extract_router, "get_admin_db", lambda: object())
    monkeypatch.setattr(extract_router, "bump_usage", lambda db, uid: 1)
    monkeypatch.setattr(extract_router, "extract_event", fake_extract_event)
    monkeypatch.setattr(extract_router, "assign_extraction_variant", fake_assign)
    monkeypatch.setattr(extract_router, "capture_assignment", lambda *a: calls.captures.append(a))
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
    async def test_disabled_experiment_falls_back_to_pinned_vision_model(self, harness):
        body = ExtractRequest(image_data_url=IMAGE_URL)
        response = await extract_router.extract(body, _request(), USER)

        default_provider, default_vision_model = extract_router.get_vision_defaults()
        assert harness.assign_args == {"user_id": "u1", "vision": True}
        assert harness.extract_kwargs["provider"] == default_provider
        assert harness.extract_kwargs["model"] == default_vision_model
        assert harness.extract_kwargs["image_data_url"] == IMAGE_URL
        # Exposure + experiment info report the actual routing after fallback:
        # the default provider and its configured vision model, whatever they are.
        assert harness.captures == [
            ("u1", "control", default_provider, default_vision_model)
        ]
        assert response.experiment is not None
        assert response.experiment.variant == "control"

    async def test_assigned_arm_drives_vision_model(self, harness):
        harness.assignment = ("treatment", "groq", QWEN)
        body = ExtractRequest(image_data_url=IMAGE_URL)
        response = await extract_router.extract(body, _request(), USER)

        assert harness.extract_kwargs["provider"] == "groq"
        assert harness.extract_kwargs["model"] == QWEN
        assert harness.captures == [("u1", "treatment", "groq", QWEN)]
        assert response.experiment is not None
        assert response.experiment.variant == "treatment"
        assert response.experiment.model == QWEN

    async def test_caption_forwarded_alongside_image(self, harness):
        body = ExtractRequest(raw_text="for Mia", image_data_url=IMAGE_URL)
        await extract_router.extract(body, _request(), USER)
        assert harness.extract_kwargs["raw_text"] == "for Mia"
        assert harness.extract_kwargs["image_data_url"] == IMAGE_URL


class TestTextRequestUnchanged:
    async def test_assignment_and_exposure_still_fire(self, harness):
        body = ExtractRequest(raw_text="Bake sale Friday 3pm")
        response = await extract_router.extract(body, _request(), USER)

        assert harness.assign_args == {"user_id": "u1", "vision": False}
        assert harness.captures == [("u1", "control", None, None)]
        assert response.experiment is not None
        assert response.experiment.variant == "control"
        # No overrides on the control arm: provider/model flow through as None
        # (model falls back to the tier policy, which is None for free).
        assert harness.extract_kwargs["provider"] is None
        assert harness.extract_kwargs["model"] is None
        assert harness.extract_kwargs["image_data_url"] is None
