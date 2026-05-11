from fastapi import HTTPException
from supabase import Client

from app.schemas.events import ParentEvent, StoredActionItem, StoredEvent


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


def list_events(db: Client, user_id: str) -> list[StoredEvent]:
    event_rows = (
        db.table("events")
        .select("*")
        .eq("user_id", user_id)
        .order("start_time", desc=False)
        .execute()
        .data
    )
    if not event_rows:
        return []

    event_ids = [row["id"] for row in event_rows]
    item_rows = (
        db.table("action_items")
        .select("*")
        .in_("event_id", event_ids)
        .execute()
        .data
    )

    items_by_event: dict[str, list[dict]] = {}
    for item in item_rows:
        items_by_event.setdefault(item["event_id"], []).append(item)

    return [
        StoredEvent.model_validate(
            {**row, "action_items": items_by_event.get(row["id"], [])}
        )
        for row in event_rows
    ]


def delete_event(db: Client, user_id: str, event_id: str) -> None:
    deleted = (
        db.table("events")
        .delete()
        .eq("id", event_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Event not found")


def set_action_item_done(
    db: Client, user_id: str, item_id: str, done: bool
) -> StoredActionItem:
    # Service role bypasses RLS, so verify ownership explicitly.
    item_rows = (
        db.table("action_items").select("event_id").eq("id", item_id).execute().data
    )
    if not item_rows:
        raise HTTPException(status_code=404, detail="Action item not found")

    event_id = item_rows[0]["event_id"]
    owner_rows = (
        db.table("events")
        .select("id")
        .eq("id", event_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not owner_rows:
        raise HTTPException(status_code=404, detail="Action item not found")

    updated = (
        db.table("action_items")
        .update({"done": done})
        .eq("id", item_id)
        .execute()
        .data
    )
    return StoredActionItem.model_validate(updated[0])
