"""resolve_config — how optional overrides + a tier's slot become a finished model."""

import app.services.extraction as extraction
from app.services.llm_providers import PROVIDERS, ModelSlot


class TestResolveConfigSlot:
    def test_slot_selects_the_matching_provider_model(self):
        # With no explicit model, default_slot names the role and resolve_config
        # reads that field off the active provider — the seam that lets a tier
        # point into PROVIDERS instead of pinning a model name. A slot whose value
        # isn't a real ProviderConfig field would raise here.
        fast = extraction.resolve_config(
            "groq", None, None, "v3", escalate=False, default_slot=ModelSlot.FAST
        )
        smart = extraction.resolve_config(
            "groq", None, None, "v3", escalate=False, default_slot=ModelSlot.SMART
        )
        assert fast.model == PROVIDERS["groq"].fast_model
        assert smart.model == PROVIDERS["groq"].smart_model

    def test_explicit_model_wins_over_slot(self):
        cfg = extraction.resolve_config(
            "groq", "pinned-model", None, "v3", escalate=False, default_slot=ModelSlot.FAST
        )
        assert cfg.model == "pinned-model"
