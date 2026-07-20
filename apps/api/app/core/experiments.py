"""Online experiment harness — self-hosted variant assignment + event capture.

Replaces PostHog (dropped 2026-06-26, see apps/api/EXPERIMENTS.md). The
two jobs PostHog used to do now live in Supabase:

  * **Assignment** — a deterministic hash of (user_id + experiment key), bucketed
    against the weights in the `experiments` config row. No SDK, no network call
    in the hot path beyond a short-cached config read, and no Lambda flush hazard.
    The row is the remote kill-switch: flip `enabled` or change `variants` to
    retune the split with no deploy.
  * **Capture** — events are inserted into `analytics_events` (the A/B readout
    views aggregate over it), replacing posthog.capture().

ADR-019: each arm is a full provider stack serving both input types. The arms
themselves are declarative config — `EXTRACTION_ARMS` in app.services.llm_providers
— so a new experiment is a matter of pointing the DB row's `variants` at two arm
names (e.g. "openai-nano" vs "groq-qwen"), never editing an arm in place.
Assignment is server-authoritative and deterministic per user, so a caller always
sees the same arm across both input types.

Disabled-by-default: with the experiment row absent or `enabled = false` (or no
Supabase service key), every caller gets (_PASSTHROUGH_VARIANT, None, None) — no
provider/model override, so extraction uses the env defaults (LLM_PROVIDER, which
also drives the vision route for images) and production behaviour is byte-for-byte
unchanged (tests + local dev stay green).
"""

import hashlib
import logging
import time
from typing import TypedDict, cast

from app.core.config import get_settings
from app.core.db import get_admin_db
from app.services.llm_providers import EXTRACTION_ARMS, PROVIDERS, ExtractionArm

logger = logging.getLogger(__name__)

EXTRACTION_MODEL_FLAG = "extraction-model"

# Label recorded when no experiment arm is applied — the caller isn't enrolled
# (experiment off) or the assigned arm can't be served. It is NOT an arm name: it
# carries (provider, model) = (None, None), so extraction falls back to the env
# defaults (LLM_PROVIDER, which also drives the vision route for images),
# byte-for-byte the pre-experiment path. This is the analytics baseline group.
_PASSTHROUGH_VARIANT = "control"


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


def invalidate_config(key: str) -> None:
    """Drop the cached config row for `key` so the next read re-fetches. Called
    after an admin writes the row (e.g. toggling `enabled`) so the kill-switch
    flip takes effect at once, rather than within the TTL window."""
    _config_cache.pop(key, None)


def _bucket(user_id: str, key: str) -> float:
    """Deterministic [0, 1) bucket from (user_id, experiment key). Same inputs ->
    same bucket forever, so a user keeps their arm across calls and input types."""
    digest = hashlib.sha256(f"{user_id}:{key}".encode()).hexdigest()
    # Divide by 2**32 (the count of 8-hex-digit values), not 2**32 - 1 (the max),
    # so the result is a true half-open [0, 1): a digest of "ffffffff" yields
    # 0.99999…, never exactly 1.0 (which would match no arm in _pick_variant).
    return int(digest[:8], 16) / 0x100000000


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
    """True if `provider` is usable — known to the registry and either keyless
    (e.g. local Ollama) or with its configured API key set."""
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        return False
    if cfg.api_key_env is None:
        return True
    return bool(getattr(get_settings(), cfg.api_key_env.lower(), None))


def _usable_arm(variant: str) -> ExtractionArm | None:
    """The arm for `variant`, or None if it isn't a known arm or its provider has
    no key — either way it can't be served, so the caller falls back to env."""
    arm = EXTRACTION_ARMS.get(variant)
    return arm if arm is not None and _has_key(arm.provider) else None


def assign_extraction_variant(
    user_id: str, *, vision: bool = False
) -> tuple[str, str | None, str | None]:
    """Return (variant, provider, model) for the caller's input type.

    Not enrolled — the experiment is off, or the bucketed arm can't be served
    (unknown, or its provider key is unset) — returns
    (_PASSTHROUGH_VARIANT, None, None): no override, so extraction uses the env
    defaults (LLM_PROVIDER, which also drives the vision route). This both keeps the
    production path unchanged when the experiment is off and stops a
    half-provisioned arm from 500ing inside extract_event's _get_client.

    Enrolled — returns the deterministically bucketed arm's stack, picking
    text_model or vision_model per `vision`.
    """
    cfg = _load_config(EXTRACTION_MODEL_FLAG)
    if cfg is None or not cfg.get("enabled"):
        return _PASSTHROUGH_VARIANT, None, None

    default = cfg.get("default_variant") or _PASSTHROUGH_VARIANT
    variant = _pick_variant(
        _bucket(user_id, EXTRACTION_MODEL_FLAG), cfg.get("variants") or {}, default
    )

    arm = _usable_arm(variant)
    if arm is None:
        # Can't serve the assignment — fall back to the env default, not a pinned
        # stand-in arm. LLM_PROVIDER (which also drives the vision route) decides.
        return _PASSTHROUGH_VARIANT, None, None

    return variant, arm.provider, arm.model_for(vision=vision)


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
