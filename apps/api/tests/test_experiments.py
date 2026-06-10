"""Move 1 — online experiment harness: server-side variant assignment.

Covers the safety contract that keeps the experiment from changing production
behaviour until it's deliberately turned on: disabled-by-default, deterministic
mapping, and a provider-key guard so a half-provisioned env can't 500.
"""

import app.core.experiments as experiments
from app.core.experiments import (
    EXTRACTION_MODEL_FLAG,
    assign_extraction_variant,
    capture_assignment,
)


class _FakeClient:
    """Stand-in for posthog.Posthog: returns a fixed flag, records captures."""

    def __init__(self, flag_value):
        self._flag_value = flag_value
        self.captures = []

    def get_feature_flag(self, flag, user_id):
        self.captures_flag = (flag, user_id)
        return self._flag_value

    def capture(self, user_id, event, properties):
        self.captures.append((user_id, event, properties))


def _use_client(monkeypatch, client):
    """Point the module at a fake client (or None for the disabled path)."""
    monkeypatch.setattr(experiments, "_client", lambda: client)


class TestDisabled:
    """No PostHog key -> the experiment is inert and prod behaviour is unchanged."""

    def test_assignment_is_passthrough_control(self, monkeypatch):
        _use_client(monkeypatch, None)
        # (None, None) provider/model => the router applies no override, so the
        # extract_event call is byte-for-byte the pre-experiment path.
        assert assign_extraction_variant("u1") == ("control", None, None)

    def test_capture_is_noop(self, monkeypatch):
        _use_client(monkeypatch, None)
        # Must not raise even though there's no client to capture with.
        capture_assignment("u1", "control", None, None)


class TestAssignment:
    def test_treatment_maps_to_openai(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_client(monkeypatch, _FakeClient("treatment"))
        assert assign_extraction_variant("u1") == ("treatment", "openai", "gpt-4o-mini")

    def test_control_maps_to_groq_scout(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        _use_client(monkeypatch, _FakeClient("control"))
        variant, provider, model = assign_extraction_variant("u1")
        assert (variant, provider) == ("control", "groq")
        assert model == "meta-llama/llama-4-scout-17b-16e-instruct"

    def test_unknown_flag_value_falls_back_to_control(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        _use_client(monkeypatch, _FakeClient(None))  # flag off / not found
        assert assign_extraction_variant("u1")[0] == "control"

    def test_same_flag_value_is_stable_across_calls(self, monkeypatch):
        # Determinism is PostHog's bucketing; here we assert our mapping is pure.
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_client(monkeypatch, _FakeClient("treatment"))
        assert assign_extraction_variant("u1") == assign_extraction_variant("u1")


class TestProviderKeyGuard:
    """An arm whose provider key is unset must downgrade to control, not 500."""

    def test_treatment_without_openai_key_downgrades(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        _use_client(monkeypatch, _FakeClient("treatment"))
        variant, provider, _ = assign_extraction_variant("u1")
        assert (variant, provider) == ("control", "groq")


class TestCapture:
    def test_capture_emits_namespaced_feature_property(self, monkeypatch):
        fake = _FakeClient("treatment")
        _use_client(monkeypatch, fake)
        capture_assignment("u1", "treatment", "openai", "gpt-4o-mini")
        assert fake.captures == [
            (
                "u1",
                "extraction_assigned",
                {
                    f"$feature/{EXTRACTION_MODEL_FLAG}": "treatment",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
            )
        ]
