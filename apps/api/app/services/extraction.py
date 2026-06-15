"""LLM event extraction: turn raw text and/or a photo into a structured ParentEvent.

What one `extract_event` call does, in order:

1. Pick a system prompt (the vision variant when an image is attached).
2. Pick a provider + model — from settings, or pinned by the caller (the eval
   harness pins specific combos to compare them).
3. Build the chat messages and call the LLM. `instructor` validates the reply
   against our Pydantic schema and retries automatically if it's malformed.
4. If the model reports low confidence, retry once on the provider's smarter
   (more expensive) model.
5. Return the event — plus run telemetry when the caller asks for it.

Names starting with `_` are private to this module; everything else is the
public surface (used by the extract router and the eval harness).
"""

import logging
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

logger = logging.getLogger("villageos.extraction")


# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderConfig:
    """How to reach one LLM provider and which of its models we use."""

    # None means the OpenAI SDK default (api.openai.com).
    base_url: str | None
    # Env var holding the API key; its lowercase form is the Settings field
    # name. None means no real key is needed (local Ollama).
    api_key_env: str | None
    fast_model: str
    # Escalation target on low confidence. Same as fast_model = no escalation.
    smart_model: str
    # How instructor requests structured output: "TOOLS" or "JSON".
    mode: str
    # Only set for providers that can read images.
    vision_model: str | None = None
    # Placeholder key for providers with api_key_env=None (Ollama takes any string).
    default_key: str | None = None


_PROVIDERS: dict[str, ProviderConfig] = {
    "ollama": ProviderConfig(
        base_url="http://localhost:11434/v1",
        api_key_env=None,
        default_key="ollama",
        fast_model="llama3.1:8b",
        smart_model="llama3.1:8b",
        mode="TOOLS",
    ),
    "groq": ProviderConfig(
        base_url="https://api.groq.com/openai/v1",
        api_key_env="GROQ_API_KEY",
        # Scout passes the eval reliably in JSON mode and is ~5x cheaper than
        # 70b. Escalation disabled (smart_model = fast_model) because 70b's
        # date-disambiguation bug is independent of confidence.
        fast_model="meta-llama/llama-4-scout-17b-16e-instruct",
        smart_model="meta-llama/llama-4-scout-17b-16e-instruct",
        mode="JSON",
    ),
    "openai": ProviderConfig(
        base_url=None,
        api_key_env="OPENAI_API_KEY",
        fast_model="gpt-4o-mini",
        smart_model="gpt-4o",
        vision_model="gpt-4o",
        mode="TOOLS",
    ),
}

# Default vision route when the experiment is disabled or the assigned arm's
# provider key is missing (ADR-019 folds vision into the A/B arms; before that
# this pin was the only vision path). Content-part messages are confirmed
# working under Groq JSON mode (eval run 2026-06-12), so both arms can serve
# images.
VISION_PROVIDER = "openai"


def get_vision_model() -> str:
    vision_model = _PROVIDERS[VISION_PROVIDER].vision_model
    if vision_model is None:
        raise RuntimeError(f"Provider '{VISION_PROVIDER}' has no vision model configured.")
    return vision_model


# ---------------------------------------------------------------------------
# Client setup
# ---------------------------------------------------------------------------

# One client per (provider, mode) pair, created on first use and reused for
# the life of the process so every request shares connection pools.
_clients: dict[tuple[str, str], instructor.AsyncInstructor] = {}


def _resolve_mode(override: str | None, provider_default: str) -> instructor.Mode:
    """Turn a mode name into the instructor.Mode enum.

    Precedence: caller override > INSTRUCTOR_MODE setting > provider default.
    """
    name = (override or get_settings().instructor_mode or provider_default).upper()
    try:
        return instructor.Mode[name]
    except KeyError as e:
        valid = [m.name for m in instructor.Mode]
        raise ValueError(f"Unknown instructor mode '{name}'. Valid: {valid}") from e


def _get_client(provider: str, mode: instructor.Mode) -> instructor.AsyncInstructor:
    cache_key = (provider, mode.name)
    if cache_key in _clients:
        return _clients[cache_key]

    if provider not in _PROVIDERS:
        raise ValueError(f"Unsupported LLM provider: {provider}")

    cfg = _PROVIDERS[provider]
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


# ---------------------------------------------------------------------------
# Building the request
# ---------------------------------------------------------------------------


def _build_messages(
    system_prompt: str,
    today: date,
    raw_text: str | None,
    image_data_url: str | None,
) -> list[ChatCompletionMessageParam]:
    """System prompt (with today's date filled in) + the user's text/image."""
    user_content: str | list[ChatCompletionContentPartParam]
    if image_data_url:
        # OpenAI accepts data: URLs directly; detail="high" because the value in
        # a leaflet is the small print (times, prices, return-slip deadlines).
        parts: list[ChatCompletionContentPartParam] = [
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}}
        ]
        if raw_text:
            parts.append({"type": "text", "text": raw_text})
        user_content = parts
    else:
        # Text-only requests must stay a plain string (the pre-vision contract).
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


def _redact_messages(
    messages: list[ChatCompletionMessageParam],
) -> list[dict]:
    """Copy of `messages` safe for logging: base64 image payloads replaced with
    a placeholder so user photos never reach CloudWatch."""
    redacted: list[dict] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            redacted.append(dict(message))
            continue
        safe_parts: list[dict] = [
            {
                "type": "image_url",
                "image_url": f"<redacted image, {len(part['image_url']['url'])} chars>",
            }
            if part.get("type") == "image_url"
            else dict(part)
            for part in content
        ]
        redacted.append({**message, "content": safe_parts})
    return redacted


# ---------------------------------------------------------------------------
# Calling the LLM
# ---------------------------------------------------------------------------


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
    # The same two instruments the online extraction_completed log records, so
    # the offline eval and production read identical metrics — enabling the
    # offline↔online cost/latency comparison.
    llm_duration_ms: float
    input_length_chars: int
    # "text" | "image" | "text+image" — and the decoded image size, when present.
    input_type: str = "text"
    image_bytes: int | None = None


# The @overload blocks below exist only for the type checker: they tell it
# that return_details=False yields an ExtractResponse and return_details=True
# yields a (response, details) tuple. The undecorated function is the one
# that actually runs.


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
    (see VISION_PROVIDER / get_vision_model). The schema layer guarantees at
    least one of raw_text / image_data_url is present.
    """
    today = today or date.today()

    # 1. Pick the prompt (vision variant when an image is attached).
    if prompt_version is None and image_data_url:
        prompt_version = VISION_VERSION
    version, system_prompt = get_prompt(prompt_version)

    # 2. Resolve provider, models, and client. A pinned call (explicit
    #    provider or model) never escalates — the eval needs each combo to
    #    answer for itself.
    pinned = provider is not None or model is not None
    resolved_provider = (provider or get_settings().llm_provider).lower()
    if resolved_provider not in _PROVIDERS:
        raise ValueError(f"Unsupported LLM provider: {resolved_provider}")
    cfg = _PROVIDERS[resolved_provider]
    fast_model = model or cfg.fast_model
    smart_model = model or cfg.smart_model
    resolved_mode = _resolve_mode(mode, cfg.mode)
    client = _get_client(resolved_provider, resolved_mode)

    # 3. Build the request.
    messages = _build_messages(system_prompt, today, raw_text, image_data_url)
    input_type, image_bytes = _describe_input(raw_text, image_data_url)

    # Full prompt sent to the model — user content + large, so DEBUG only
    # (LOG_LEVEL=DEBUG). Logged before the call so it survives a failed request.
    logger.debug(
        "extraction_prompt",
        extra={
            "event": "extraction_prompt",
            "request_id": request_id,
            "provider": resolved_provider,
            "model": fast_model,
            "prompt_version": version,
            "messages": _redact_messages(messages),
        },
    )

    # 4. Call the LLM; one retry on the smart model if confidence is low.
    llm_start = time.perf_counter()
    tokens = _TokenUsage()

    used_model = fast_model
    event, completion = await _extract_once(client, used_model, messages, version, today)
    tokens.add(completion)

    if not pinned and event.confidence < 0.7 and fast_model != smart_model:
        used_model = smart_model
        event, completion = await _extract_once(client, used_model, messages, version, today)
        tokens.add(completion)

    llm_duration_ms = round((time.perf_counter() - llm_start) * 1000, 1)

    # 5. Package the response and log telemetry.
    response = ExtractResponse(
        event=event,
        model_used=used_model,
        tokens_used=tokens.total,
    )

    logger.info(
        "extraction_completed",
        extra={
            "event": "extraction_completed",
            "request_id": request_id,
            "model": used_model,
            "provider": resolved_provider,
            "prompt_version": version,
            "mode": resolved_mode.name,
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

    # Full extracted payload — user content, so gated behind DEBUG (LOG_LEVEL=DEBUG).
    logger.debug(
        "extraction_result",
        extra={
            "event": "extraction_result",
            "request_id": request_id,
            "result": event.model_dump(mode="json"),
        },
    )

    if return_details:
        details = ExtractionRunDetails(
            provider=resolved_provider,
            model=used_model,
            prompt_version=version,
            mode=resolved_mode.name,
            tokens_used=tokens.total,
            prompt_tokens=tokens.prompt,
            completion_tokens=tokens.completion,
            llm_duration_ms=llm_duration_ms,
            input_length_chars=len(raw_text or ""),
            input_type=input_type,
            image_bytes=image_bytes,
        )
        return response, details
    return response
