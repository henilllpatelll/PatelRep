"""Failed-inspection corrections for rooms flagged ``reclean_requested_at``.

Shared by ``GET /housekeeping/my-rooms`` (shows the housekeeper what to fix) and
``POST /clean-sessions`` (seeds a correction-only checklist), so both read the
same inspection history. Read-only: it never alters inspection records.
"""

from typing import Any

CORRECTION_SECTION = "Corrections"


def load_reclean_details(client: Any, hotel_id: str, room_ids: list[str]) -> dict[str, dict]:
    """Latest failed/conditional inspection per room, with its failed items.

    Returns ``{room_id: {inspection_id, inspected_at, overall_result, notes,
    items: [{id, label, note}]}}``. Rooms with no failed inspection are absent.
    """
    if not room_ids:
        return {}

    inspections = (
        client.table("inspections")
        .select("id, room_id, completed_at, overall_result, notes")
        .eq("tenant_id", hotel_id)
        .in_("room_id", room_ids)
        .in_("overall_result", ["failed", "conditional"])
        .order("completed_at", desc=True)
        .execute()
    ).data or []

    latest: dict[str, dict] = {}
    for insp in inspections:
        room_id = insp.get("room_id")
        if room_id and room_id not in latest:
            latest[room_id] = insp
    if not latest:
        return {}

    inspection_ids = [insp["id"] for insp in latest.values()]
    fail_rows = (
        client.table("inspection_results")
        .select("inspection_id, template_item_id, note")
        .eq("tenant_id", hotel_id)
        .in_("inspection_id", inspection_ids)
        .eq("result", "fail")
        .execute()
    ).data or []

    item_ids = list({r["template_item_id"] for r in fail_rows if r.get("template_item_id")})
    labels: dict[str, str] = {}
    if item_ids:
        labels = {
            i["id"]: i["description"]
            for i in (
                client.table("inspection_template_items")
                .select("id, description")
                .in_("id", item_ids)
                .execute()
            ).data
            or []
        }

    items_by_inspection: dict[str, list[dict]] = {}
    for row in fail_rows:
        note = (row.get("note") or "").strip()
        label = labels.get(row.get("template_item_id")) or note
        if not label:
            continue
        items_by_inspection.setdefault(row["inspection_id"], []).append(
            {
                "id": row.get("template_item_id"),
                "label": label,
                # The inspector's note is only extra detail when it adds to the label.
                "note": note if note and note != label else None,
            }
        )

    return {
        room_id: {
            "inspection_id": insp["id"],
            "inspected_at": insp.get("completed_at"),
            "overall_result": insp.get("overall_result"),
            "notes": (insp.get("notes") or "").strip() or None,
            "items": items_by_inspection.get(insp["id"], []),
        }
        for room_id, insp in latest.items()
    }


def correction_checklist(details: dict | None) -> list[dict]:
    """Session checklist snapshot for a correction-only reclean.

    Every failed item is required, so a reclean cannot be submitted until each
    correction is ticked. Labels are the inspection's own wording.
    """
    items = (details or {}).get("items") or []
    seen: set[str] = set()
    checklist: list[dict] = []
    for item in items:
        label = item["label"]
        if label in seen:
            continue
        seen.add(label)
        checklist.append(
            {
                "item_id": None,
                "section": CORRECTION_SECTION,
                "label": label,
                "is_required": True,
                "checked": False,
                "checked_at": None,
            }
        )
    return checklist
