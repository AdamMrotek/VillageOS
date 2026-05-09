from supabase import Client

from app.schemas.events import ParentEvent, StoredEvent


def create_event(db: Client, user_id: str, event: ParentEvent) -> StoredEvent:
    # Insert the event row — action_items go to their own table
    event_data = event.model_dump(mode="json", exclude={"action_items"})
    event_data["user_id"] = user_id

    event_row = db.table("events").insert(event_data).execute().data[0]
    event_id = event_row["id"]

    # Insert action items as child rows
    stored_items: list[dict] = []
    if event.action_items:
        items_data = [
            {**item.model_dump(mode="json"), "event_id": event_id}
            for item in event.action_items
        ]
        stored_items = db.table("action_items").insert(items_data).execute().data

    return StoredEvent.model_validate({**event_row, "action_items": stored_items})
