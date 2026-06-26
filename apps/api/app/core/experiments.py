"""Online experiment harness — self-hosted variant assignment + event capture.

Replaces PostHog (dropped 2026-06-26, see SELF_HOSTED_EXPERIMENTS_PLAN.md). The
two jobs PostHog used to do now live in Supabase:

  * **Assignment** — a deterministic hash of (user_id + experiment key), bucketed
    against the weights in the `experiments` config row. No SDK, no network call
    in the hot path beyond a short-cached config read, and no Lambda flush hazard.
    The row is the remote kill-switch: flip `enabled` or change `variants` to
    retune the split with no deploy.
  * **Capture** — events are inserted into `analytics_events` (the A/B readout
    views aggregate over it), replacing posthog.capture().

ADR-019: each arm is a full provider stack — control = OpenAI (gpt-4o-mini text,
gpt-4o vision), treatment = Groq (Llama-4 Scout for both). Assignment is
server-authoritative and deterministic per user, so a caller always sees the
same arm across both input types.

Disabled-by-default: with the experiment row absent or `enabled = false` (or no
Supabase service key), every caller gets ("control", None, None) — the router
applies no provider/model override and production behaviour is byte-for-byte
unchanged (tests + local dev stay green).
"""

import hashlib
import logging
import time
from typing import TypedDict, cast

from app.core.config import get_settings
from app.core.db import get_admin_db

logger = logging.getLogger(__name__)

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


class _ExperimentConfig(TypedDict):
    enabled: bool
    variants: dict[str, float]
    default_variant: str


# Tiny process-local TTL cache for the config row. The hash itself is local; only
# the config fetch touches the network, so caching it keeps the hot path local
# most of the time while bounding kill-switch latency to the TTL on a warm
# Lambda container. Tests reset it via _config_cache.clear().
_CONFIG_TTL_SECONDS = 60.0
_config_cache: dict[str, tuple[float, _ExperimentConfig | None]] = {}


def _fetch_config(key: str) -> _ExperimentConfig | None:
    """Read one experiment's config row via the service-role client, or None when
    unavailable — no Supabase key, missing row, or a transient read error all
    degrade to the disabled path rather than raising into the request."""
    if not get_settings().supabase_secret_key:
        return None
    try:
        res = (
            get_admin_db()
            .table("experiments")
            .select("enabled, variants, default_variant")
            .eq("key", key)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.warning(
            "experiment_config_read_failed",
            extra={"event": "experiment_config_read_failed", "key": key},
        )
        return None
    # postgrest types .data as generic JSON; this query selects the config columns.
    rows = cast(list[_ExperimentConfig], res.data or [])
    return rows[0] if rows else None


def _load_config(key: str) -> _ExperimentConfig | None:
    """`_fetch_config` behind a short TTL cache."""
    now = time.monotonic()
    hit = _config_cache.get(key)
    if hit is not None and now - hit[0] < _CONFIG_TTL_SECONDS:
        return hit[1]
    cfg = _fetch_config(key)
    _config_cache[key] = (now, cfg)
    return cfg


def _bucket(user_id: str, key: str) -> float:
    """Deterministic [0, 1) bucket from (user_id, experiment key). Same inputs ->
    same bucket forever, so a user keeps their arm across calls and input types."""
    digest = hashlib.sha256(f"{user_id}:{key}".encode()).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _pick_variant(bucket: float, weights: dict[str, float], default: str) -> str:
    """The arm whose cumulative (normalised) weight first exceeds `bucket`.

    Variants are walked in sorted order so a given bucket maps to a stable arm.
    An empty or all-zero weight map falls back to `default`.
    """
    total = sum(w for w in weights.values() if w > 0)
    if total <= 0:
        return default
    cumulative = 0.0
    for variant in sorted(weights):
        weight = weights[variant]
        if weight <= 0:
            continue
        cumulative += weight / total
        if bucket < cumulative:
            return variant
    return default  # unreachable barring float drift; keeps the type total


def _has_key(provider: str) -> bool:
    return bool(getattr(get_settings(), _PROVIDER_KEY_ATTR[provider]))


def assign_extraction_variant(
    user_id: str, *, vision: bool = False
) -> tuple[str, str | None, str | None]:
    """Return (variant, provider, model) for the caller's input type.

    Disabled (no/absent/disabled config) -> ("control", None, None): the router
    applies no overrides and the production path is unchanged. Enabled -> the
    deterministically bucketed arm's stack, picking text_model or vision_model per
    `vision`. An arm whose provider key isn't configured downgrades to the default
    arm; if that key is missing too, fall through to (default, None, None) so a
    half-provisioned environment can't 500 inside extract_event's _get_client.
    """
    cfg = _load_config(EXTRACTION_MODEL_FLAG)
    if cfg is None or not cfg.get("enabled"):
        return _DEFAULT_VARIANT, None, None

    default = cfg.get("default_variant") or _DEFAULT_VARIANT
    variant = _pick_variant(_bucket(user_id, EXTRACTION_MODEL_FLAG), cfg.get("variants") or {}, default)
    if variant not in _VARIANT_TO_CONFIG:
        variant = _DEFAULT_VARIANT

    if not _has_key(_VARIANT_TO_CONFIG[variant]["provider"]):
        variant = _DEFAULT_VARIANT
        if not _has_key(_VARIANT_TO_CONFIG[variant]["provider"]):
            return variant, None, None

    arm = _VARIANT_TO_CONFIG[variant]
    return variant, arm["provider"], arm["vision_model" if vision else "text_model"]


def capture_event(distinct_id: str, event: str, properties: dict) -> None:
    """Insert one analytics event via the service-role client. No-op when disabled
    (no Supabase key); swallows failures, because telemetry must never break an
    extraction. The A/B readout views aggregate over this table."""
    if not get_settings().supabase_secret_key:
        return
    try:
        get_admin_db().table("analytics_events").insert(
            {"event": event, "distinct_id": distinct_id, "properties": properties}
        ).execute()
    except Exception:
        logger.warning(
            "analytics_capture_failed",
            extra={"event": "analytics_capture_failed", "event_name": event},
        )


def capture_assignment(user_id: str, variant: str, provider: str | None, model: str | None) -> None:
    """Log the exposure server-side (replaces PostHog's extraction_assigned)."""
    capture_event(
        user_id,
        "extraction_assigned",
        {"variant": variant, "provider": provider, "model": model},
    )
