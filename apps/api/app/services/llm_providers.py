"""LLM provider + model config for extraction.

Two tables the extraction service and the eval both read:

* ``PROVIDERS`` — how to reach each provider (base URL, API-key env, the
  fast/smart/vision models we use, and a default structured-output mode).
  **Production ships only ``openai`` and ``groq``.** The eval calls
  ``register_provider`` to bring back survey candidates (google, openrouter,
  ollama) without shipping them in the request path.

* ``MODEL_MODES`` — ``{model_name: mode}``, the source of truth for a model's
  structured-output mode. A model not listed here falls back to its provider's
  default mode (``ProviderConfig.mode``). The eval extends this with its
  candidates via ``register_provider(..., model_modes=...)``.

Both tables are plain data — no settings, no instructor import — so they stay
cheap to read and safe for the eval to mutate at import time.
"""

from dataclasses import dataclass


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
    # Default structured-output mode ("TOOLS" | "JSON"); overridden per model by
    # MODEL_MODES.
    mode: str
    # The image-reading model.
    vision_model: str
    # Placeholder key for providers with api_key_env=None (Ollama takes any string).
    default_key: str | None = None


# Production roster. Survey/eval-only providers are registered by the eval, not
# shipped here — the request path can only reach what production has keys for.
PROVIDERS: dict[str, ProviderConfig] = {
    "openai": ProviderConfig(
        base_url=None,
        api_key_env="OPENAI_API_KEY",
        fast_model="gpt-5.4-nano",
        smart_model="gpt-5.4-nano",
        vision_model="gpt-5.4-nano",
        mode="TOOLS",
    ),
    "groq": ProviderConfig(
        base_url="https://api.groq.com/openai/v1",
        api_key_env="GROQ_API_KEY",
        fast_model="openai/gpt-oss-20b",
        smart_model="openai/gpt-oss-20b",
        vision_model="qwen/qwen3.6-27b",
        mode="JSON",
    ),
}


# {model_name: instructor mode}. Primary source for a model's structured-output
# mode; unlisted models fall back to their provider's ProviderConfig.mode.
MODEL_MODES: dict[str, str] = {
    "gpt-5.4-nano": "TOOLS",
    "openai/gpt-oss-20b": "JSON",
    "qwen/qwen3.6-27b": "JSON",
}


def register_provider(
    name: str,
    config: ProviderConfig,
    *,
    model_modes: dict[str, str] | None = None,
) -> None:
    """Add or override a provider (and optionally its models' modes) in the registry.

    Production ships only ``openai`` and ``groq``; the eval calls this at import
    to register survey candidates so they resolve through the same client and
    mode path as production. Pass ``model_modes`` for any candidate whose mode
    differs from the provider default (or simply to declare it explicitly).
    """
    PROVIDERS[name] = config
    if model_modes:
        MODEL_MODES.update(model_modes)


# ---------------------------------------------------------------------------
# Extraction experiment arms
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExtractionArm:
    """A named provider stack for one A/B arm — one pinned model per input type.

    Pinning both provider and model in ``extract_event`` disables low-confidence
    escalation, so an arm is exactly one model on each path. Arms are decoupled
    from the production ``PROVIDERS`` defaults on purpose: an experiment can pin a
    model (e.g. Groq qwen) that differs from what that provider serves by default
    (e.g. Groq gpt-oss), without disturbing production.
    """

    provider: str
    text_model: str
    vision_model: str

    def model_for(self, *, vision: bool) -> str:
        return self.vision_model if vision else self.text_model


# The library of arms an extraction experiment can pair. To run a new experiment,
# add the arms you need here (or reuse existing ones), then point the experiment's
# DB config row at their names — e.g. gpt-5.4-nano vs qwen is the pair
# {"openai-nano": <weight>, "groq-qwen": <weight>} with default_variant
# "openai-nano". No assignment-code change, and existing arms are never
# overwritten in place.
EXTRACTION_ARMS: dict[str, ExtractionArm] = {
    "openai-nano": ExtractionArm("openai", "gpt-5.4-nano", "gpt-5.4-nano"),
    "groq-qwen": ExtractionArm("groq", "qwen/qwen3.6-27b", "qwen/qwen3.6-27b"),
    # The current production Groq stack (gpt-oss text, qwen vision), available as
    # an arm for experiments that want to A/B the shipped configuration itself.
    "groq-oss": ExtractionArm("groq", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"),
}
