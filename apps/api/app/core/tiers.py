"""Caller tiers — drive both the daily quota and which model a caller gets.

Tier is resolved straight off the verified JWT with no extra DB round-trip:
Supabase copies `app_metadata` into the access token, and the `is_anonymous`
claim marks demo guests. See Demo-plan.md Part D.
"""

from app.services.llm_providers import ModelSlot

# A tier the JWT advertises but we don't recognise falls back to this policy.
DEFAULT_TIER = "free"


def resolve_tier(user: dict) -> str:
    """Map a verified JWT payload to a tier name.

    Demo is *derived* from the anonymous-guest claim; everyone else defaults to
    `free` unless `app_metadata.tier` upgrades them.
    """
    if user.get("is_anonymous"):
        return "demo"
    return user.get("app_metadata", {}).get("tier", DEFAULT_TIER)


# daily_cap None → unlimited (no metering, no counter write)
# slot           → which model *role* in the active provider this tier gets,
#                  resolved against PROVIDERS at request time (see ModelSlot).
#
# Tiers name a role (FAST/SMART/…), never a concrete model: the model must match
# the active LLM_PROVIDER, and PROVIDERS is the single source of truth for which
# model fills each role per provider. Pinning a name here would send it to
# *whatever* provider is configured and fail whenever that provider doesn't serve
# it. Every tier is FAST today; the cap is the real cost backstop. Bump a tier to
# SMART here (nowhere else) to give it the better model up front.
TIER_POLICY: dict[str, dict] = {
    "demo": {"daily_cap": 15, "slot": ModelSlot.FAST},  # cheap default, tight cap
    "free": {"daily_cap": 50, "slot": ModelSlot.FAST},
    "pro": {"daily_cap": None, "slot": ModelSlot.FAST},
}


def policy_for(tier: str) -> dict:
    """Policy for a tier, falling back to the default tier for unknown values."""
    return TIER_POLICY.get(tier, TIER_POLICY[DEFAULT_TIER])
