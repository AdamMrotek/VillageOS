"""Vision path through extract_event: multimodal message construction, prompt
version defaulting, and telemetry — with the LLM client faked."""

from datetime import date
from types import SimpleNamespace

import pytest

import app.services.extraction as extraction
from app.schemas.extraction_draft import ParentEventDraft

TODAY = date(2026, 5, 10)
IMAGE_URL = "data:image/jpeg;base64," + "A" * 400  # 400 b64 chars -> 300 bytes


def _draft() -> ParentEventDraft:
    return ParentEventDraft(
        title="Bake Sale",
        event_type="fundraiser",
        start_date=date(2026, 5, 15),
        confidence=0.9,
    )


class _FakeCompletions:
    def __init__(self):
        self.calls: list[dict] = []

    async def create_with_completion(self, **kwargs):
        self.calls.append(kwargs)
        usage = SimpleNamespace(prompt_tokens=100, completion_tokens=20, total_tokens=120)
        return _draft(), SimpleNamespace(usage=usage)


@pytest.fixture
def fake_llm(monkeypatch):
    completions = _FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(extraction, "_get_client", lambda provider, mode: client)
    return completions


async def _run(fake_llm, **kwargs):
    response, details = await extraction.extract_event(
        kwargs.pop("raw_text", None),
        today=TODAY,
        provider="openai",
        return_details=True,
        **kwargs,
    )
    return response, details, fake_llm.calls[-1]


class TestMessageConstruction:
    async def test_image_only_builds_content_parts(self, fake_llm):
        _, _, call = await _run(fake_llm, image_data_url=IMAGE_URL)
        content = call["messages"][1]["content"]
        assert isinstance(content, list)
        assert content[0] == {
            "type": "image_url",
            "image_url": {"url": IMAGE_URL, "detail": "high"},
        }
        # No caption -> no text part.
        assert len(content) == 1

    async def test_caption_appended_as_text_part(self, fake_llm):
        _, _, call = await _run(fake_llm, raw_text="for Mia", image_data_url=IMAGE_URL)
        content = call["messages"][1]["content"]
        assert content[1] == {"type": "text", "text": "for Mia"}

    async def test_text_only_content_stays_a_plain_string(self, fake_llm):
        # The pre-vision contract: text requests must be byte-identical.
        _, _, call = await _run(fake_llm, raw_text="Bake sale Friday 3pm")
        assert call["messages"][1]["content"] == "Bake sale Friday 3pm"


class TestPromptVersion:
    async def test_image_defaults_to_vision_variant(self, fake_llm):
        _, details, call = await _run(fake_llm, image_data_url=IMAGE_URL)
        assert details.prompt_version == "v3v"
        assert "## Image input" in call["messages"][0]["content"]

    async def test_text_defaults_to_v3(self, fake_llm):
        _, details, _ = await _run(fake_llm, raw_text="Bake sale Friday 3pm")
        assert details.prompt_version == "v3"

    async def test_explicit_version_wins_over_vision_default(self, fake_llm):
        _, details, _ = await _run(fake_llm, image_data_url=IMAGE_URL, prompt_version="v3")
        assert details.prompt_version == "v3"


class TestTelemetry:
    async def test_image_only(self, fake_llm):
        _, details, _ = await _run(fake_llm, image_data_url=IMAGE_URL)
        assert details.input_type == "image"
        assert details.image_bytes == 300
        assert details.input_length_chars == 0

    async def test_text_plus_image(self, fake_llm):
        _, details, _ = await _run(fake_llm, raw_text="for Mia", image_data_url=IMAGE_URL)
        assert details.input_type == "text+image"
        assert details.input_length_chars == len("for Mia")

    async def test_text_only(self, fake_llm):
        _, details, _ = await _run(fake_llm, raw_text="Bake sale Friday 3pm")
        assert details.input_type == "text"
        assert details.image_bytes is None
