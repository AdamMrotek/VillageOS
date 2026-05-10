from app.prompts.extraction import v1, v2

VERSIONS = {
    v1.VERSION: v1.SYSTEM_PROMPT,
    v2.VERSION: v2.SYSTEM_PROMPT,
}

CURRENT_VERSION = v2.VERSION
CURRENT_PROMPT = v2.SYSTEM_PROMPT


def get_prompt(version: str | None = None) -> tuple[str, str]:
    """Return (version, prompt_template). Pass None for the current version."""
    if version is None:
        return CURRENT_VERSION, CURRENT_PROMPT
    if version not in VERSIONS:
        raise ValueError(
            f"Unknown extraction prompt version '{version}'. "
            f"Known: {sorted(VERSIONS)}"
        )
    return version, VERSIONS[version]
