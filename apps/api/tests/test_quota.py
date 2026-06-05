"""Part D — tiered quota: tier resolution, atomic bump, and the extract gate."""

import pytest
from fastapi import HTTPException

import app.routers.extract as extract_router
from app.core.tiers import TIER_POLICY, policy_for, resolve_tier
from app.services.usage import bump_usage


class TestResolveTier:
    def test_anonymous_is_demo(self):
        assert resolve_tier({"is_anonymous": True, "sub": "g1"}) == "demo"

    def test_registered_defaults_to_free(self):
        assert resolve_tier({"sub": "u1"}) == "free"

    def test_app_metadata_tier_wins_for_registered(self):
        assert resolve_tier({"sub": "u1", "app_metadata": {"tier": "pro"}}) == "pro"

    def test_anonymous_ignores_app_metadata(self):
        # A guest is demo regardless of any tier claim that rides along.
        user = {"is_anonymous": True, "app_metadata": {"tier": "pro"}}
        assert resolve_tier(user) == "demo"


class TestTierPolicy:
    def test_demo_is_capped_on_provider_default_model(self):
        # model None → use the configured provider's cheap default (groq Scout
        # in prod); pinning an OpenAI name would break under LLM_PROVIDER=groq.
        assert TIER_POLICY["demo"] == {"daily_cap": 15, "model": None}

    def test_free_capped_on_default_model(self):
        assert TIER_POLICY["free"]["daily_cap"] == 50
        assert TIER_POLICY["free"]["model"] is None

    def test_pro_is_unlimited(self):
        assert TIER_POLICY["pro"]["daily_cap"] is None

    def test_unknown_tier_falls_back_to_free(self):
        assert policy_for("enterprise") is TIER_POLICY["free"]


class _FakeRpc:
    def __init__(self, value):
        self._value = value
        self.called_with = None

    def rpc(self, name, params):
        self.called_with = (name, params)
        return self

    def execute(self):
        return type("Result", (), {"data": self._value})()


class TestBumpUsage:
    def test_calls_rpc_and_returns_count(self):
        fake = _FakeRpc(7)
        assert bump_usage(fake, "user-123") == 7
        assert fake.called_with == ("bump_usage", {"p_user_id": "user-123"})


class TestExtractQuotaGate:
    """The 429 path fires before the LLM, so it's exercisable without a model."""

    def _gate(self, *, tier_user, count, monkeypatch):
        """Replay the router's gate logic with bump_usage/admin_db stubbed."""
        monkeypatch.setattr(extract_router, "get_admin_db", lambda: object())
        monkeypatch.setattr(extract_router, "bump_usage", lambda db, uid: count)

        tier = resolve_tier(tier_user)
        policy = policy_for(tier)
        if policy["daily_cap"] is not None:
            used = extract_router.bump_usage(extract_router.get_admin_db(), tier_user["sub"])
            if used > policy["daily_cap"]:
                raise HTTPException(status_code=429, detail="capped")
        return tier

    def test_demo_over_cap_raises_429(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            self._gate(
                tier_user={"is_anonymous": True, "sub": "g1"},
                count=16,  # cap is 15
                monkeypatch=monkeypatch,
            )
        assert exc.value.status_code == 429

    def test_demo_at_cap_passes(self, monkeypatch):
        assert (
            self._gate(
                tier_user={"is_anonymous": True, "sub": "g1"},
                count=15,  # exactly at cap → allowed
                monkeypatch=monkeypatch,
            )
            == "demo"
        )

    def test_pro_skips_metering(self, monkeypatch):
        # daily_cap None → bump_usage never consulted; any count is irrelevant.
        assert (
            self._gate(
                tier_user={"sub": "u1", "app_metadata": {"tier": "pro"}},
                count=9999,
                monkeypatch=monkeypatch,
            )
            == "pro"
        )
