from app.prompts.extraction import v1, v2, v3, v3_vision

VERSIONS = {
    v1.VERSION: v1.SYSTEM_PROMPT,
    v2.VERSION: v2.SYSTEM_PROMPT,
    v3.VERSION: v3.SYSTEM_PROMPT,
    v3_vision.VERSION: v3_vision.SYSTEM_PROMPT,
}

CURRENT_VERSION = v3.VERSION
CURRENT_PROMPT = v3.SYSTEM_PROMPT

# Default for calls that include an image: v3 plus a vision addendum.
VISION_VERSION = v3_vision.VERSION


def get_prompt(version: str | None = None) -> tuple[str, str]:
    """Return (version, prompt_template). Pass None for the current version."""
    if version is None:
        return CURRENT_VERSION, CURRENT_PROMPT
    if version not in VERSIONS:
        raise ValueError(
            f"Unknown extraction prompt version '{version}'. Known: {sorted(VERSIONS)}"
        )
    return version, VERSIONS[version]
