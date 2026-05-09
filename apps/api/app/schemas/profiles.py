from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class Role(str, Enum):
    parent   = "parent"
    admin    = "admin"
    provider = "provider"


class Profile(BaseModel):
    id: str
    role: Role
    full_name: Optional[str] = None
    created_at: datetime
