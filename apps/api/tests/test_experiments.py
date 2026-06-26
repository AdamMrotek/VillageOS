"""Move 1 — self-hosted experiment harness (PostHog dropped 2026-06-26).

Covers the safety contract that keeps the experiment from changing production
behaviour until it's deliberately turned on (disabled-by-default, provider-key
guard), the determinism of the hash-based assignment, and the analytics capture
path that replaced posthog.capture().
"""

import app.core.experiments as experiments
from app.core.experiments import (
    EXTRACTION_MODEL_FLAG,
    _bucket,
    _pick_variant,
    assign_extraction_variant,
    capture_assignment,
    capture_event,
)

SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct"


def _use_config(monkeypatch, config):
    """Point assignment at a fixed experiment config (or None for disabled),
    bypassing the Supabase read + TTL cache."""
    monkeypatch.setattr(experiments, "_load_config", lambda key: config)


def _enabled(variants, default_variant="control"):
    return {"enabled": True, "variants": variants, "default_variant": default_variant}


class _FakeTable:
    """Records .insert(...).execute() payloads for the capture tests."""

    def __init__(self, sink):
        self._sink = sink

    def insert(self, row):
        self._sink.append(row)
        return self

    def execute(self):
        return type("R", (), {"data": []})()


class _FakeDB:
    def __init__(self):
        self.inserted = []

    def table(self, name):
        assert name == "analytics_events"
        return _FakeTable(self.inserted)


class TestDisabled:
    """No/absent/disabled config -> inert experiment, prod behaviour unchanged."""

    def test_no_config_is_passthrough_control(self, monkeypatch):
        _use_config(monkeypatch, None)
        # (None, None) provider/model => the router applies no override, so the
        # extract_event call is byte-for-byte the pre-experiment path.
        assert assign_extraction_variant("u1") == ("control", None, None)

    def test_disabled_flag_is_passthrough_control(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_config(monkeypatch, {"enabled": False, "variants": {"control": 1.0}, "default_variant": "control"})
        assert assign_extraction_variant("u1") == ("control", None, None)

    def test_capture_is_noop_without_supabase_key(self, monkeypatch):
        # No SUPABASE_SECRET_KEY in the test env -> capture short-circuits and
        # must not raise even though there's no DB to write to.
        monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
        capture_assignment("u1", "control", None, None)


class TestBucketing:
    """The hash that replaced PostHog's deterministic flag bucketing."""

    def test_bucket_is_in_unit_interval(self):
        for uid in ("u1", "u2", "abc", "00000000-0000-0000-0000-000000000000"):
            assert 0.0 <= _bucket(uid, EXTRACTION_MODEL_FLAG) < 1.0

    def test_bucket_is_deterministic(self):
        assert _bucket("u1", "k") == _bucket("u1", "k")
        assert _bucket("u1", "k") != _bucket("u2", "k")

    def test_pick_walks_weights_in_stable_order(self):
        weights = {"control": 0.5, "treatment": 0.5}
        assert _pick_variant(0.0, weights, "control") == "control"
        assert _pick_variant(0.49, weights, "control") == "control"
        assert _pick_variant(0.5, weights, "control") == "treatment"
        assert _pick_variant(0.99, weights, "control") == "treatment"

    def test_pick_empty_weights_falls_back_to_default(self):
        assert _pick_variant(0.3, {}, "control") == "control"
        assert _pick_variant(0.3, {"control": 0.0, "treatment": 0.0}, "treatment") == "treatment"


class TestAssignment:
    """ADR-019: each arm is a provider stack serving both input types."""

    def test_control_maps_to_openai_stack(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_config(monkeypatch, _enabled({"control": 1.0}))
        assert assign_extraction_variant("u1") == ("control", "openai", "gpt-4o-mini")
        assert assign_extraction_variant("u1", vision=True) == ("control", "openai", "gpt-4o")

    def test_treatment_maps_to_groq_stack(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        _use_config(monkeypatch, _enabled({"treatment": 1.0}))
        assert assign_extraction_variant("u1") == ("treatment", "groq", SCOUT)
        assert assign_extraction_variant("u1", vision=True) == ("treatment", "groq", SCOUT)

    def test_assignment_is_stable_across_calls(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
        _use_config(monkeypatch, _enabled({"control": 0.5, "treatment": 0.5}))
        assert assign_extraction_variant("u1") == assign_extraction_variant("u1")

    def test_unknown_variant_in_weights_falls_back_to_control(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_config(monkeypatch, _enabled({"mystery": 1.0}, default_variant="mystery"))
        assert assign_extraction_variant("u1")[0] == "control"


class TestProviderKeyGuard:
    """An arm whose provider key is unset must downgrade, not 500."""

    def test_treatment_without_groq_key_downgrades_to_control(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        _use_config(monkeypatch, _enabled({"treatment": 1.0}))
        variant, provider, _ = assign_extraction_variant("u1")
        assert (variant, provider) == ("control", "openai")

    def test_both_keys_missing_falls_through_to_passthrough(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        _use_config(monkeypatch, _enabled({"treatment": 1.0}))
        # No usable arm: behave like the disabled experiment so the router applies
        # no override instead of 500ing in _get_client.
        assert assign_extraction_variant("u1") == ("control", None, None)


class TestCapture:
    def test_capture_assignment_inserts_event_row(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")
        fake = _FakeDB()
        monkeypatch.setattr(experiments, "get_admin_db", lambda: fake)
        capture_assignment("u1", "treatment", "openai", "gpt-4o-mini")
        assert fake.inserted == [
            {
                "event": "extraction_assigned",
                "distinct_id": "u1",
                "properties": {"variant": "treatment", "provider": "openai", "model": "gpt-4o-mini"},
            }
        ]

    def test_capture_event_swallows_db_errors(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

        def _boom():
            raise RuntimeError("supabase down")

        monkeypatch.setattr(experiments, "get_admin_db", _boom)
        # Telemetry must never break an extraction.
        capture_event("u1", "extraction_shown", {"variant": "control"})


class TestConfigCache:
    """The TTL cache amortises the config read without hiding a kill-switch flip
    for longer than the TTL."""

    def test_fetch_is_cached_within_ttl(self, monkeypatch):
        experiments._config_cache.clear()
        calls = {"n": 0}

        def _fetch(key):
            calls["n"] += 1
            return _enabled({"control": 1.0})

        monkeypatch.setattr(experiments, "_fetch_config", _fetch)
        experiments._load_config(EXTRACTION_MODEL_FLAG)
        experiments._load_config(EXTRACTION_MODEL_FLAG)
        assert calls["n"] == 1
        experiments._config_cache.clear()
