"""Online experiment harness — server-side variant assignment via PostHog.

Move 1 (see NEXT_MOVES_1_EXPERIMENT.md) started as a text-model A/B. Redefined
2026-06-12 (ADR-019): each arm is now a full **provider stack** serving both
the text and the vision path. control = the proven OpenAI stack (gpt-4o-mini
text, gpt-4o vision), treatment = the Groq stack (Llama-4 Scout for both,
natively multimodal, ~1/15th the vision cost). The experiment question:
can one cheap provider run the whole extraction surface without quality loss?

Assignment is server-authoritative and deterministic per user, so a caller
always sees the same arm across both input types.

Disabled-by-default: with no POSTHOG_API_KEY the client is None and every caller
gets ("control", None, None) — the router then passes no provider/model override
and production behaviour is byte-for-byte unchanged (tests + local dev stay
green). Mirrors the lazy-singleton pattern in services/extraction.py.
"""

from functools import lru_cache
from typing import TypedDict

import posthog

from app.core.config import get_settings

EXTRACTION_MODEL_FLAG = "extraction-model"

_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct"


class _ArmConfig(TypedDict):
    provider: str
    text_model: str
    vision_model: str


# (variant) -> provider stack. Pinning both provider and model in extract_event
# disables low-confidence escalation, so each arm is exactly one model per path.
_VARIANT_TO_CONFIG: dict[str, _ArmConfig] = {
    "control": {
        "provider": "openai",
        "text_model": "gpt-4o-mini",
        "vision_model": "gpt-4o",
    },
    "treatment": {
        "provider": "groq",
        "text_model": _SCOUT,
        "vision_model": _SCOUT,
    },
}
_DEFAULT_VARIANT = "control"
# Settings field holding each provider's API key (see app/core/config.py).
_PROVIDER_KEY_ATTR = {"groq": "groq_api_key", "openai": "openai_api_key"}


@lru_cache(maxsize=1)
def _client() -> posthog.Posthog | None:
    """Cached PostHog client, or None when unconfigured (experiments disabled)."""
    settings = get_settings()
    if not settings.posthog_api_key:
        return None
    return posthog.Posthog(settings.posthog_api_key, host=settings.posthog_host)


def _has_key(provider: str) -> bool:
    return bool(getattr(get_settings(), _PROVIDER_KEY_ATTR[provider]))


def assign_extraction_variant(
    user_id: str, *, vision: bool = False
) -> tuple[str, str | None, str | None]:
    """Return (variant, provider, model) for the caller's input type.

    Disabled (no PostHog key) -> ("control", None, None): the router applies no
    overrides and the production path is unchanged. Enabled -> the flag's arm's
    stack, picking text_model or vision_model per `vision`. An arm whose
    provider key isn't configured downgrades to the default arm; if that key is
    missing too, fall through to (default, None, None) so a half-provisioned
    environment can't 500 inside extract_event's _get_client.
    """
    client = _client()
    if client is None:
        return _DEFAULT_VARIANT, None, None

    flag = client.get_feature_flag(EXTRACTION_MODEL_FLAG, user_id)
    variant = flag if isinstance(flag, str) and flag in _VARIANT_TO_CONFIG else _DEFAULT_VARIANT

    if not _has_key(_VARIANT_TO_CONFIG[variant]["provider"]):
        variant = _DEFAULT_VARIANT
        if not _has_key(_VARIANT_TO_CONFIG[variant]["provider"]):
            return variant, None, None

    cfg = _VARIANT_TO_CONFIG[variant]
    return variant, cfg["provider"], cfg["vision_model" if vision else "text_model"]


def capture_assignment(user_id: str, variant: str, provider: str | None, model: str | None) -> None:
    """Log the exposure server-side so server logs and PostHog agree. No-op when disabled."""
    client = _client()
    if client is None:
        return
    client.capture(
        user_id,
        "extraction_assigned",
        {
            f"$feature/{EXTRACTION_MODEL_FLAG}": variant,
            "provider": provider,
            "model": model,
        },
    )
