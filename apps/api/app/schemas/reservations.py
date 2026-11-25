from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

# Mirrors the CHECK on reservations.spots and the guard in reserve_spot().
MAX_SPOTS = 10


class ReservationStatus(StrEnum):
    confirmed = "confirmed"
    cancelled = "cancelled"


class ReservationInput(BaseModel):
    spots: int = Field(1, ge=1, le=MAX_SPOTS, description="Places to hold, 1 to 10")


class StoredReservation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    event_id: str
    spots: int
    status: ReservationStatus
    seen_version: int
    created_at: datetime
