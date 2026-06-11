import logging
import os
import time
from dataclasses import dataclass
from datetime import date

import instructor
from openai import AsyncOpenAI

from app.prompts.extraction import get_prompt
from app.schemas.events import ExtractResponse, ParentEvent
from app.schemas.extraction_draft import ParentEventDraft
from app.services.extraction_date import build_date_table, draft_to_event

logger = logging.getLogger("villageos.extraction")

_PROVIDER_CONFIG = {
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key_env": None,
        "default_key": "ollama",
        "fast_model": "llama3.1:8b",
        "smart_model": "llama3.1:8b",
        "mode": "TOOLS",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        "default_key": None,
        # Scout passes the eval reliably in JSON mode and is ~5x cheaper than
        # 70b. Escalation disabled (smart_model = fast_model) because 70b's
        # date-disambiguation bug is independent of confidence.
        "fast_model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "smart_model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "mode": "JSON",
    },
    "openai": {
        "base_url": None,
        "api_key_env": "OPENAI_API_KEY",
        "default_key": None,
        "fast_model": "gpt-4o-mini",
        "smart_model": "gpt-4o",
        "mode": "TOOLS",
    },
}


_clients: dict[tuple[str, str], instructor.AsyncInstructor] = {}


def _resolve_mode(name: str | None, provider_default: str | None = None) -> instructor.Mode:
    name = (name or os.getenv("INSTRUCTOR_MODE") or provider_default or "TOOLS").upper()
    try:
        return instructor.Mode[name]
    except KeyError as e:
        raise ValueError(
            f"Unknown instructor mode '{name}'. Valid: {[m.name for m in instructor.Mode]}"
        ) from e


def _get_client(provider: str, mode: instructor.Mode) -> instructor.AsyncInstructor:
    cache_key = (provider, mode.name)
    if cache_key in _clients:
        return _clients[cache_key]

    if provider not in _PROVIDER_CONFIG:
        raise ValueError(f"Unsupported LLM provider: {provider}")

    cfg = _PROVIDER_CONFIG[provider]
    api_key = (os.getenv(cfg["api_key_env"]) if cfg["api_key_env"] else None) or cfg["default_key"]
    if not api_key:
        raise RuntimeError(
            f"Missing API key for provider '{provider}'. "
            f"Set {cfg['api_key_env']} in the environment."
        )

    openai_client = AsyncOpenAI(base_url=cfg["base_url"], api_key=api_key)
    client = instructor.from_openai(openai_client, mode=mode)
    _clients[cache_key] = client
    return client


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


async def _extract_once(
    client: instructor.AsyncInstructor,
    model: str,
    messages: list[dict],
    version: str,
    today: date,
) -> tuple[ParentEvent, object]:
    """Single LLM call. For v3, ask for ParentEventDraft and combine into ParentEvent."""
    if version == "v3":
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


async def extract_event(
    raw_text: str,
    today: date | None = None,
    *,
    provider: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    mode: str | None = None,
    return_details: bool = False,
    request_id: str | None = None,
) -> ExtractResponse | tuple[ExtractResponse, ExtractionRunDetails]:
    """Extract a structured event from raw text.

    Default behavior (no overrides) preserves the production path: pick provider
    from LLM_PROVIDER, run the fast model, and escalate to smart_model on low
    confidence.

    Overrides (provider/model/prompt_version) pin the call to a single
    configuration with no escalation — used by the eval to compare combinations.
    """
    today = today or date.today()
    version, system_prompt = get_prompt(prompt_version)

    messages = [
        {
            "role": "system",
            "content": system_prompt.format(
                today=today.isoformat(),
                weekday=today.strftime("%A"),
                date_table=build_date_table(today),
            ),
        },
        {"role": "user", "content": raw_text},
    ]

    pinned = provider is not None or model is not None
    resolved_provider = (provider or os.getenv("LLM_PROVIDER", "openai")).lower()
    cfg = _PROVIDER_CONFIG[resolved_provider]
    fast_model = model or cfg["fast_model"]
    smart_model = model or cfg["smart_model"]

    resolved_mode = _resolve_mode(mode, cfg.get("mode"))
    client = _get_client(resolved_provider, resolved_mode)

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
            "messages": messages,
        },
    )

    llm_start = time.perf_counter()

    used_model = fast_model
    event, completion = await _extract_once(client, used_model, messages, version, today)
    prompt_tokens = completion.usage.prompt_tokens if completion.usage else 0
    completion_tokens = completion.usage.completion_tokens if completion.usage else 0
    total_tokens = completion.usage.total_tokens if completion.usage else 0

    if not pinned and event.confidence < 0.7 and fast_model != smart_model:
        used_model = smart_model
        event, completion = await _extract_once(client, used_model, messages, version, today)
        prompt_tokens += completion.usage.prompt_tokens if completion.usage else 0
        completion_tokens += completion.usage.completion_tokens if completion.usage else 0
        total_tokens += completion.usage.total_tokens if completion.usage else 0

    llm_duration_ms = round((time.perf_counter() - llm_start) * 1000, 1)

    response = ExtractResponse(
        event=event,
        model_used=used_model,
        tokens_used=total_tokens,
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
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "confidence": event.confidence,
            "input_length_chars": len(raw_text),
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
            tokens_used=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            llm_duration_ms=llm_duration_ms,
            input_length_chars=len(raw_text),
        )
        return response, details
    return response
