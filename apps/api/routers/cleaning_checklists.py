import logging

from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import require_role, get_current_user, CurrentUser
from models.requests import UpdateChecklistTemplateRequest
from core.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/housekeeping/checklists", tags=["cleaning-checklists"])

CLEAN_TYPES = ("DEP", "FULL", "LIGHT", "DEFAULT")

# Mirrors the seed data in migration 054 — used to lazily seed tenants created
# after that migration ran, and to restore defaults.
DEFAULT_CHECKLISTS: dict[str, tuple[str, list[tuple[str, str, bool]]]] = {
    "DEP": ("Departure Clean", [
        ("Bedroom", "Strip beds and remove used linens", True),
        ("Bedroom", "Make beds with fresh linens", True),
        ("Bathroom", "Clean and sanitize bathroom", True),
        ("Bathroom", "Replace towels and bath amenities", True),
        ("General", "Vacuum floors including under bed", False),
        ("General", "Dust surfaces and check HVAC", False),
        ("General", "Empty trash and reline bins", False),
        ("General", "Check drawers and safe for guest items", False),
        ("General", "Final walkthrough and set thermostat", False),
    ]),
    "FULL": ("Full Linen Change", [
        ("Bedroom", "Change bed linens", True),
        ("Bathroom", "Clean and sanitize bathroom", True),
        ("Bathroom", "Replace towels", False),
        ("General", "Restock amenities", False),
        ("General", "Vacuum floors", False),
        ("General", "Empty trash", False),
    ]),
    "LIGHT": ("Light Service", [
        ("General", "Empty trash", False),
        ("Bathroom", "Replace used towels", False),
        ("Bedroom", "Tidy bed and surfaces", False),
        ("General", "Restock amenities", False),
    ]),
    "DEFAULT": ("Standard Clean", [
        ("Bedroom", "Make beds with fresh linens", True),
        ("Bathroom", "Clean and sanitize bathroom", True),
        ("Bathroom", "Replace towels", False),
        ("General", "Vacuum floors", False),
        ("General", "Restock amenities", False),
        ("General", "Empty trash", False),
    ]),
}


def _seed_template(hotel_id: str, clean_type: str) -> dict:
    """Create the default template + items for one clean type. Returns template row."""
    name, items = DEFAULT_CHECKLISTS[clean_type]
    tpl_result = supabase.table("cleaning_checklist_templates").insert({
        "tenant_id": hotel_id,
        "clean_type": clean_type,
        "name": name,
    }).execute()
    template = (tpl_result.data or [{}])[0]
    if template.get("id"):
        supabase.table("cleaning_checklist_items").insert([
            {
                "tenant_id": hotel_id,
                "template_id": template["id"],
                "section": section,
                "label": label,
                "is_required": required,
                "sort_order": i + 1,
            }
            for i, (section, label, required) in enumerate(items)
        ]).execute()
    return template


def _fetch_templates_with_items(hotel_id: str) -> list[dict]:
    tpl_result = (
        supabase.table("cleaning_checklist_templates")
        .select("id, clean_type, name, is_active")
        .eq("tenant_id", hotel_id)
        .execute()
    )
    template_rows = tpl_result.data or []
    items_result = (
        supabase.table("cleaning_checklist_items")
        .select("id, template_id, section, label, is_required, sort_order")
        .eq("tenant_id", hotel_id)
        .execute()
    )
    items_by_template: dict[str, list[dict]] = {}
    for item in (items_result.data or []):
        items_by_template.setdefault(item.get("template_id"), []).append(item)

    templates = []
    for row in template_rows:
        items = sorted(
            items_by_template.get(row.get("id")) or [],
            key=lambda i: (i.get("sort_order") or 0),
        )
        templates.append({**row, "items": items})
    templates.sort(key=lambda t: CLEAN_TYPES.index(t["clean_type"]) if t["clean_type"] in CLEAN_TYPES else 99)
    return templates


def get_checklist_template_for_clean_type(hotel_id: str, clean_type: str | None) -> dict | None:
    """Resolve the template for a clean type, falling back to DEFAULT.

    Used by the clean-sessions router to snapshot a checklist at session start.
    """
    wanted = clean_type if clean_type in CLEAN_TYPES else "DEFAULT"
    templates = {t["clean_type"]: t for t in _fetch_templates_with_items(hotel_id)}
    if not templates:
        for ct in CLEAN_TYPES:
            _seed_template(hotel_id, ct)
        templates = {t["clean_type"]: t for t in _fetch_templates_with_items(hotel_id)}
    return templates.get(wanted) or templates.get("DEFAULT")


# ---------------------------------------------------------------------------
# GET /housekeeping/checklists
# ---------------------------------------------------------------------------

@router.get("")
async def list_checklists(
    current_user: CurrentUser = Depends(get_current_user),
):
    templates = _fetch_templates_with_items(current_user.hotel_id)
    if not templates:
        # Lazy seed for tenants created after migration 054
        for ct in CLEAN_TYPES:
            _seed_template(current_user.hotel_id, ct)
        templates = _fetch_templates_with_items(current_user.hotel_id)
    return {"data": templates}


# ---------------------------------------------------------------------------
# PUT /housekeeping/checklists/{clean_type}
# ---------------------------------------------------------------------------

@router.put("/{clean_type}")
async def update_checklist(
    clean_type: str,
    request: UpdateChecklistTemplateRequest,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    clean_type = clean_type.upper()
    if clean_type not in CLEAN_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown clean type: {clean_type}")

    existing = (
        supabase.table("cleaning_checklist_templates")
        .select("id, name")
        .eq("tenant_id", current_user.hotel_id)
        .eq("clean_type", clean_type)
        .maybe_single()
        .execute()
    )
    template = (existing.data if existing else None) or None
    if not template:
        template = _seed_template(current_user.hotel_id, clean_type)
    if not template.get("id"):
        raise HTTPException(status_code=500, detail="Failed to resolve checklist template")

    template_id = template["id"]
    update_payload: dict = {"updated_at": "now()"}
    if request.name:
        update_payload["name"] = request.name
    supabase.table("cleaning_checklist_templates").update(update_payload)\
        .eq("id", template_id).eq("tenant_id", current_user.hotel_id).execute()

    # Replace items wholesale (same semantics as the inspection template editor)
    supabase.table("cleaning_checklist_items").delete()\
        .eq("template_id", template_id).eq("tenant_id", current_user.hotel_id).execute()
    supabase.table("cleaning_checklist_items").insert([
        {
            "tenant_id": current_user.hotel_id,
            "template_id": template_id,
            "section": item.section,
            "label": item.label,
            "is_required": item.is_required,
            "sort_order": i + 1,
        }
        for i, item in enumerate(request.items)
    ]).execute()

    templates = _fetch_templates_with_items(current_user.hotel_id)
    updated = next((t for t in templates if t["clean_type"] == clean_type), None)
    return {"data": updated}


# ---------------------------------------------------------------------------
# POST /housekeeping/checklists/{clean_type}/reset
# ---------------------------------------------------------------------------

@router.post("/{clean_type}/reset")
async def reset_checklist(
    clean_type: str,
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor")),
):
    clean_type = clean_type.upper()
    if clean_type not in CLEAN_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown clean type: {clean_type}")

    supabase.table("cleaning_checklist_templates").delete()\
        .eq("tenant_id", current_user.hotel_id).eq("clean_type", clean_type).execute()
    _seed_template(current_user.hotel_id, clean_type)

    templates = _fetch_templates_with_items(current_user.hotel_id)
    restored = next((t for t in templates if t["clean_type"] == clean_type), None)
    return {"data": restored}
