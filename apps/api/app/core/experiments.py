"""Online experiment harness — server-side variant assignment via PostHog.

Move 1 (see NEXT_MOVES_1_EXPERIMENT.md): a feature-flagged A/B on the extraction
*model*. control = the cheap incumbent (groq Scout, today's prod default),
treatment = the pricier gpt-4o-mini. Assignment is server-authoritative and
deterministic per user, so a caller always sees the same arm.

Disabled-by-default: with no POSTHOG_API_KEY the client is None and every caller
gets ("control", None, None) — the router then passes no provider/model override
and production behaviour is byte-for-byte unchanged (tests + local dev stay
green). Mirrors the lazy-singleton pattern in services/extraction.py.
"""

import os
from functools import lru_cache

import posthog

EXTRACTION_MODEL_FLAG = "extraction-model"

# (variant) -> (provider, model). Each arm is a single pinned configuration;
# passing both provider and model to extract_event disables the low-confidence
# escalation, so each arm is exactly one model.
_VARIANT_TO_CONFIG: dict[str, tuple[str, str]] = {
    "control": ("groq", "meta-llama/llama-4-scout-17b-16e-instruct"),
    "treatment": ("openai", "gpt-4o-mini"),
}
_DEFAULT_VARIANT = "control"
_PROVIDER_KEY_ENV = {"groq": "GROQ_API_KEY", "openai": "OPENAI_API_KEY"}


@lru_cache(maxsize=1)
def _client() -> posthog.Posthog | None:
    """Cached PostHog client, or None when unconfigured (experiments disabled)."""
    key = os.getenv("POSTHOG_API_KEY")
    if not key:
        return None
    return posthog.Posthog(key, host=os.getenv("POSTHOG_HOST", "https://eu.i.posthog.com"))


def assign_extraction_variant(user_id: str) -> tuple[str, str | None, str | None]:
    """Return (variant, provider, model). Deterministic per user; safe when disabled.

    Disabled (no PostHog key) -> ("control", None, None): the router applies no
    overrides and the production path is unchanged. Enabled -> the flag's arm,
    but downgraded to control if that arm's provider key isn't configured, so a
    half-provisioned environment can't 500 inside extract_event's _get_client.
    """
    client = _client()
    if client is None:
        return _DEFAULT_VARIANT, None, None

    flag = client.get_feature_flag(EXTRACTION_MODEL_FLAG, user_id)
    variant = flag if isinstance(flag, str) and flag in _VARIANT_TO_CONFIG else _DEFAULT_VARIANT
    provider, model = _VARIANT_TO_CONFIG[variant]

    if not os.getenv(_PROVIDER_KEY_ENV[provider]):
        variant = _DEFAULT_VARIANT
        provider, model = _VARIANT_TO_CONFIG[_DEFAULT_VARIANT]
    return variant, provider, model


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
