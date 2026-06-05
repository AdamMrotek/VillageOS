"""Caller tiers — drive both the daily quota and which model a caller gets.

Tier is resolved straight off the verified JWT with no extra DB round-trip:
Supabase copies `app_metadata` into the access token, and the `is_anonymous`
claim marks demo guests. See Demo-plan.md Part D.
"""

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


# daily_cap None  → unlimited (no metering, no counter write)
# model     None  → use the configured provider's default fast model
#
# Demo deliberately leaves `model` as None rather than pinning a name: the model
# must match the active LLM_PROVIDER (prod runs groq, whose default fast model is
# the cheap, eval-vetted Scout). Pinning an OpenAI name like "gpt-4o-mini" would
# be sent to *whatever* provider is configured and fail on groq. The 15/day cap
# is the real cost backstop here, not the model choice.
TIER_POLICY: dict[str, dict] = {
    "demo": {"daily_cap": 15, "model": None},  # cheap default model, tight cap
    "free": {"daily_cap": 50, "model": None},
    "pro": {"daily_cap": None, "model": None},
}


def policy_for(tier: str) -> dict:
    """Policy for a tier, falling back to the default tier for unknown values."""
    return TIER_POLICY.get(tier, TIER_POLICY[DEFAULT_TIER])
