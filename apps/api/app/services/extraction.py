"""LLM event extraction: turn raw text and/or a photo into a structured ParentEvent.

`extract_event` picks a prompt/provider/model, calls the LLM (via `instructor`,
which validates the reply against the Pydantic schema and retries on malformed
output), optionally escalates to a smarter model on low confidence, and returns
the event with optional telemetry.
"""

import logging
import os
import time
from dataclasses import dataclass
from datetime import date
from typing import Literal, overload

import instructor
from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletion,
    ChatCompletionContentPartParam,
    ChatCompletionMessageParam,
)

from app.core.config import get_settings
from app.prompts.extraction import VISION_VERSION, get_prompt
from app.schemas.events import ExtractResponse, ParentEvent
from app.schemas.extraction_draft import ParentEventDraft
from app.services.extraction_date import build_date_table, draft_to_event
from app.services.extraction_fake import fake_extract_event
from app.services.llm_providers import MODEL_MODES, PROVIDERS, ModelSlot

logger = logging.getLogger("villageos.extraction")


def get_vision_defaults() -> tuple[str, str]:
    """Default (provider, vision_model) for image requests.

    Vision rides the same provider as the text default (LLM_PROVIDER); every
    provider in PROVIDERS ships a vision model, so this always resolves. Used
    when the experiment is disabled or the assigned arm's provider key is missing.
    """
    provider = get_settings().llm_provider.lower()
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        raise ValueError(f"Unsupported LLM provider: {provider}")
    return provider, cfg.vision_model


# One client per (provider, mode) pair, cached for the process so requests share
# connection pools.
_clients: dict[tuple[str, str], instructor.AsyncInstructor] = {}


def _mode_enum(name: str) -> instructor.Mode:
    """Look up an instructor.Mode by name (case-insensitive), raising on unknown."""
    try:
        return instructor.Mode[name.upper()]
    except KeyError as e:
        valid = [m.name for m in instructor.Mode]
        raise ValueError(f"Unknown instructor mode '{name}'. Valid: {valid}") from e


def _get_client(provider: str, mode: instructor.Mode) -> instructor.AsyncInstructor:
    cache_key = (provider, mode.name)
    if cache_key in _clients:
        return _clients[cache_key]

    if provider not in PROVIDERS:
        raise ValueError(f"Unsupported LLM provider: {provider}")

    cfg = PROVIDERS[provider]
    api_key = cfg.default_key
    if cfg.api_key_env:
        api_key = getattr(get_settings(), cfg.api_key_env.lower()) or api_key
    if not api_key:
        raise RuntimeError(
            f"Missing API key for provider '{provider}'. Set {cfg.api_key_env} in the environment."
        )

    openai_client = AsyncOpenAI(base_url=cfg.base_url, api_key=api_key)
    client = instructor.from_openai(openai_client, mode=mode)
    _clients[cache_key] = client
    return client


def _build_messages(
    system_prompt: str,
    today: date,
    raw_text: str | None,
    image_data_url: str | None,
) -> list[ChatCompletionMessageParam]:
    """System prompt (with today's date filled in) + the user's text/image."""
    user_content: str | list[ChatCompletionContentPartParam]
    if image_data_url:
        # detail="high" to read small print (times, prices, return-slip deadlines).
        parts: list[ChatCompletionContentPartParam] = [
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}}
        ]
        if raw_text:
            parts.append({"type": "text", "text": raw_text})
        user_content = parts
    else:
        user_content = raw_text or ""

    return [
        {
            "role": "system",
            "content": system_prompt.format(
                today=today.isoformat(),
                weekday=today.strftime("%A"),
                date_table=build_date_table(today),
            ),
        },
        {"role": "user", "content": user_content},
    ]


def _describe_input(raw_text: str | None, image_data_url: str | None) -> tuple[str, int | None]:
    """Input shape for telemetry: ("text" | "image" | "text+image", decoded image bytes)."""
    if not image_data_url:
        return "text", None
    base64_payload = image_data_url.split(",", 1)[1]
    image_bytes = (len(base64_payload) * 3) // 4  # base64: 4 chars encode 3 bytes
    return ("text+image" if raw_text else "image"), image_bytes


async def _extract_once(
    client: instructor.AsyncInstructor,
    model: str,
    messages: list[ChatCompletionMessageParam],
    version: str,
    today: date,
) -> tuple[ParentEvent, ChatCompletion]:
    """Single LLM call. For v3*, ask for ParentEventDraft and combine into ParentEvent."""
    if version.startswith("v3"):
        draft, completion = await client.chat.completions.create_with_completion(
            model=model,
            response_model=ParentEventDraft,
            max_retries=2,
            messages=messages,
        )
        return draft_to_event(draft), completion
    event, completion = await client.chat.completions.create_with_completion(
        model=model,
        response_model=ParentEvent,
        max_retries=2,
        messages=messages,
    )
    return event, completion


@dataclass
class _TokenUsage:
    """Token counts summed across the fast call and any escalation call."""

    prompt: int = 0
    completion: int = 0
    total: int = 0

    def add(self, completion: ChatCompletion) -> None:
        if completion.usage:
            self.prompt += completion.usage.prompt_tokens
            self.completion += completion.usage.completion_tokens
            self.total += completion.usage.total_tokens


@dataclass
class ExtractionRunDetails:
    """Per-call telemetry the eval consumes; not part of the API response."""

    provider: str
    model: str
    prompt_version: str
    mode: str
    tokens_used: int
    prompt_tokens: int
    completion_tokens: int
    llm_duration_ms: float
    input_length_chars: int
    # "text" | "image" | "text+image", and the decoded image size when present.
    input_type: str = "text"
    image_bytes: int | None = None


@dataclass(frozen=True)
class ExtractConfig:
    """A fully-resolved extraction configuration.

    `resolve_config` decides everything `run_extraction` needs; the executor just
    runs it. `escalate_to` names a smarter model to retry once when confidence
    < 0.7; None (or a value equal to `model`) means no escalation.
    """

    provider: str
    model: str
    mode: instructor.Mode
    prompt_version: str | None = None
    escalate_to: str | None = None


async def run_extraction(
    raw_text: str | None,
    image_data_url: str | None,
    config: ExtractConfig,
    *,
    today: date,
    request_id: str | None = None,
) -> tuple[ExtractResponse, ExtractionRunDetails]:
    """Run one extraction for a fully-resolved config and return it with telemetry.

    The fast call always runs; the escalation call runs only when
    `config.escalate_to` names a different model and the fast reply's confidence
    is low.
    """
    version, system_prompt = get_prompt(config.prompt_version)
    client = _get_client(config.provider, config.mode)

    messages = _build_messages(system_prompt, today, raw_text, image_data_url)
    input_type, image_bytes = _describe_input(raw_text, image_data_url)

    # User content, so DEBUG only. Logged before the call so it survives a
    # failure. The base64 image is never logged — keeps user photos out of logs.
    logger.debug(
        "extraction_prompt",
        extra={
            "event": "extraction_prompt",
            "request_id": request_id,
            "provider": config.provider,
            "model": config.model,
            "prompt_version": version,
            "system_prompt": messages[0]["content"],
            "raw_text": raw_text,
            "input_type": input_type,
        },
    )

    llm_start = time.perf_counter()
    tokens = _TokenUsage()

    used_model = config.model
    event, completion = await _extract_once(client, used_model, messages, version, today)
    tokens.add(completion)

    if config.escalate_to and config.escalate_to != config.model and event.confidence < 0.7:
        used_model = config.escalate_to
        event, completion = await _extract_once(client, used_model, messages, version, today)
        tokens.add(completion)

    llm_duration_ms = round((time.perf_counter() - llm_start) * 1000, 1)

    response = ExtractResponse(event=event, model_used=used_model, tokens_used=tokens.total)

    logger.info(
        "extraction_completed",
        extra={
            "event": "extraction_completed",
            "request_id": request_id,
            "model": used_model,
            "provider": config.provider,
            "prompt_version": version,
            "mode": config.mode.name,
            "llm_duration_ms": llm_duration_ms,
            "prompt_tokens": tokens.prompt,
            "completion_tokens": tokens.completion,
            "total_tokens": tokens.total,
            "confidence": event.confidence,
            "input_length_chars": len(raw_text or ""),
            "input_type": input_type,
            "image_bytes": image_bytes,
        },
    )

    # Full extracted payload — user content, so DEBUG only.
    logger.debug(
        "extraction_result",
        extra={
            "event": "extraction_result",
            "request_id": request_id,
            "result": event.model_dump(mode="json"),
        },
    )

    details = ExtractionRunDetails(
        provider=config.provider,
        model=used_model,
        prompt_version=version,
        mode=config.mode.name,
        tokens_used=tokens.total,
        prompt_tokens=tokens.prompt,
        completion_tokens=tokens.completion,
        llm_duration_ms=llm_duration_ms,
        input_length_chars=len(raw_text or ""),
        input_type=input_type,
        image_bytes=image_bytes,
    )
    return response, details


def _fake_extraction(
    raw_text: str | None,
    image_data_url: str | None,
    version: str,
) -> tuple[ExtractResponse, ExtractionRunDetails]:
    """E2E seam for LLM_PROVIDER=fake: canned fixtures, no client/network/key.

    Also requires E2E_FAKE_LLM=1 (set only by the test/CI e2e job) so a stray
    LLM_PROVIDER=fake in a real environment fails loudly instead of serving
    fixtures to users.
    """
    if os.getenv("E2E_FAKE_LLM") != "1":
        raise ValueError(
            "LLM_PROVIDER=fake requires E2E_FAKE_LLM=1 (test/e2e runs only); "
            "refusing to serve canned fixtures outside a test environment"
        )
    input_type, image_bytes = _describe_input(raw_text, image_data_url)
    response = ExtractResponse(event=fake_extract_event(raw_text), model_used="fake", tokens_used=0)
    details = ExtractionRunDetails(
        provider="fake",
        model="fake",
        prompt_version=version,
        mode="FAKE",
        tokens_used=0,
        prompt_tokens=0,
        completion_tokens=0,
        llm_duration_ms=0.0,
        input_length_chars=len(raw_text or ""),
        input_type=input_type,
        image_bytes=image_bytes,
    )
    return response, details


def resolve_config(
    provider: str | None,
    model: str | None,
    mode: str | None,
    prompt_version: str,
    *,
    escalate: bool,
    default_slot: ModelSlot = ModelSlot.FAST,
) -> ExtractConfig:
    """Resolve optional overrides + settings into a finished ExtractConfig.

    Provider comes from the override or LLM_PROVIDER; the model from the override
    or, absent one, the active provider's `default_slot` model (fast by default;
    the caller's tier picks the slot). The mode comes from the override, the
    model's MODEL_MODES entry, or the provider default, in that order.
    `escalate=True` wires escalate_to to the provider's smart_model (production
    default); False leaves it off (eval and A/B arms).
    """
    resolved_provider = (provider or get_settings().llm_provider).lower()
    if resolved_provider not in PROVIDERS:
        raise ValueError(f"Unsupported LLM provider: {resolved_provider}")
    cfg = PROVIDERS[resolved_provider]
    resolved_model = model or getattr(cfg, default_slot.value)
    return ExtractConfig(
        provider=resolved_provider,
        model=resolved_model,
        mode=_mode_enum(mode or MODEL_MODES.get(resolved_model) or cfg.mode),
        prompt_version=prompt_version,
        escalate_to=cfg.smart_model if escalate else None,
    )


# @overload: return_details=False yields ExtractResponse, True yields
# (response, details). The undecorated function below is the one that runs.


@overload
async def extract_event(
    raw_text: str | None,
    today: date | None = None,
    *,
    image_data_url: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    mode: str | None = None,
    default_slot: ModelSlot = ModelSlot.FAST,
    return_details: Literal[False] = False,
    request_id: str | None = None,
) -> ExtractResponse: ...


@overload
async def extract_event(
    raw_text: str | None,
    today: date | None = None,
    *,
    image_data_url: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    mode: str | None = None,
    default_slot: ModelSlot = ModelSlot.FAST,
    return_details: Literal[True],
    request_id: str | None = None,
) -> tuple[ExtractResponse, ExtractionRunDetails]: ...


async def extract_event(
    raw_text: str | None,
    today: date | None = None,
    *,
    image_data_url: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    mode: str | None = None,
    default_slot: ModelSlot = ModelSlot.FAST,
    return_details: bool = False,
    request_id: str | None = None,
) -> ExtractResponse | tuple[ExtractResponse, ExtractionRunDetails]:
    """Extract a structured event from raw text and/or an image.

    Default behavior (no overrides) preserves the production path: pick provider
    from LLM_PROVIDER, run the fast model, and escalate to smart_model on low
    confidence.

    Overrides (provider/model/prompt_version) pin the call to a single
    configuration with no escalation — used by the eval to compare combinations.

    `image_data_url` (a `data:image/...;base64,...` URL) adds the image to the
    user message; the caller is expected to pin a vision-capable provider/model
    (see get_vision_defaults). The schema layer guarantees at
    least one of raw_text / image_data_url is present.
    """
    today = today or date.today()

    # Default to the vision prompt when an image is attached.
    if prompt_version is None and image_data_url:
        prompt_version = VISION_VERSION
    version, _ = get_prompt(prompt_version)

    if (provider or get_settings().llm_provider).lower() == "fake":
        response, details = _fake_extraction(raw_text, image_data_url, version)
    else:
        # A pinned call (explicit provider or model) skips escalation; the
        # default production path retries on the smart_model.
        pinned = provider is not None or model is not None
        config = resolve_config(
            provider, model, mode, version, escalate=not pinned, default_slot=default_slot
        )
        response, details = await run_extraction(
            raw_text, image_data_url, config, today=today, request_id=request_id
        )

    return (response, details) if return_details else response
