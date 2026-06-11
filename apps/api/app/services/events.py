from typing import Any, cast

from fastapi import HTTPException
from supabase import Client

from app.schemas.events import ParentEvent, StoredActionItem, StoredEvent

# postgrest types row data as generic JSON; these tables always return objects.
_Row = dict[str, Any]


def create_event(db: Client, user_id: str, event: ParentEvent) -> StoredEvent:
    # user_id must be set explicitly — RLS WITH CHECK requires it match auth.uid()
    event_data = event.model_dump(mode="json", exclude={"action_items"})
    event_data["user_id"] = user_id

    event_row = cast(_Row, db.table("events").insert(event_data).execute().data[0])
    event_id = event_row["id"]

    stored_items: list[_Row] = []
    if event.action_items:
        items_data = [
            {**item.model_dump(mode="json"), "event_id": event_id} for item in event.action_items
        ]
        stored_items = cast(list[_Row], db.table("action_items").insert(items_data).execute().data)

    return StoredEvent.model_validate({**event_row, "action_items": stored_items})


def list_events(db: Client) -> list[StoredEvent]:
    event_rows = cast(
        list[_Row], db.table("events").select("*").order("start_time", desc=False).execute().data
    )
    if not event_rows:
        return []

    event_ids = [row["id"] for row in event_rows]
    item_rows = cast(
        list[_Row],
        db.table("action_items").select("*").in_("event_id", event_ids).execute().data,
    )

    items_by_event: dict[str, list[_Row]] = {}
    for item in item_rows:
        items_by_event.setdefault(item["event_id"], []).append(item)

    return [
        StoredEvent.model_validate({**row, "action_items": items_by_event.get(row["id"], [])})
        for row in event_rows
    ]


def delete_event(db: Client, event_id: str) -> None:
    deleted = db.table("events").delete().eq("id", event_id).execute().data
    if not deleted:
        raise HTTPException(status_code=404, detail="Event not found")


def set_action_item_done(db: Client, item_id: str, done: bool) -> StoredActionItem:
    updated = db.table("action_items").update({"done": done}).eq("id", item_id).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Action item not found")
    return StoredActionItem.model_validate(updated[0])
