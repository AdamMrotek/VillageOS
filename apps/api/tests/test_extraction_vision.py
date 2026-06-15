"""Vision path through extract_event: multimodal message construction, prompt
version defaulting, telemetry, and image redaction — with the LLM client faked."""

from datetime import date
from types import SimpleNamespace
from typing import Any

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


class TestRedaction:
    def test_image_payload_replaced_text_untouched(self):
        # list[Any]: the test exercises the runtime dict shape, not the OpenAI
        # SDK's TypedDict unions that _redact_messages is annotated with.
        messages: list[Any] = [
            {"role": "system", "content": "sys prompt"},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": IMAGE_URL, "detail": "high"}},
                    {"type": "text", "text": "caption"},
                ],
            },
        ]
        redacted = extraction._redact_messages(messages)
        assert redacted[0] == {"role": "system", "content": "sys prompt"}
        assert redacted[1]["content"][0]["image_url"] == f"<redacted image, {len(IMAGE_URL)} chars>"
        assert redacted[1]["content"][1] == {"type": "text", "text": "caption"}
        # The original (sent to the LLM) must keep the real payload.
        assert messages[1]["content"][0]["image_url"]["url"] == IMAGE_URL
