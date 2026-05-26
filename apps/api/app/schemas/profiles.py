from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class Role(StrEnum):
    parent = "parent"
    admin = "admin"
    provider = "provider"


class Profile(BaseModel):
    id: str
    role: Role
    full_name: str | None = None
    created_at: datetime
