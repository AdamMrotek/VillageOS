from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProviderCategory(StrEnum):
    school = "school"
    sports_club = "sports_club"
    community = "community"
    council = "council"
    library = "library"
    other = "other"


class ProviderProfileInput(BaseModel):
    """Public organisation details a provider edits about themselves."""

    name: str = Field(..., description="Organisation name")
    category: ProviderCategory
    description: str | None = Field(None, description="Up to a few sentences, max 600 chars")
    location: str | None = None
    website: str | None = None
    image_url: str | None = Field(None, description="CloudFront URL of the cover")
    tags: list[str] = []

    @field_validator("name")
    @classmethod
    def name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 120:
            raise ValueError("name must be 120 characters or fewer")
        return v

    @field_validator("description")
    @classmethod
    def description_clean(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 600:
            raise ValueError("description must be 600 characters or fewer")
        return v or None


class StoredProviderProfile(ProviderProfileInput):
    model_config = ConfigDict(extra="ignore")

    user_id: str
    created_at: datetime
    updated_at: datetime


class CoverUploadRequest(BaseModel):
    """The browser tells us the file's MIME type so we can sign for it."""

    content_type: str


class CoverUploadTicket(BaseModel):
    """A presigned POST plus the URL the cover will live at once uploaded."""

    url: str  # S3 endpoint to POST the multipart form to
    fields: dict[str, str]  # signed policy fields — sent as form fields
    image_url: str  # final CloudFront URL to persist on the profile
    max_bytes: int  # so the client can pre-check and keep the message in sync
