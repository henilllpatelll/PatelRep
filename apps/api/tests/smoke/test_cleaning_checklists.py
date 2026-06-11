import pytest

from middleware.auth import CurrentUser
from models.requests import ChecklistItemInput, UpdateChecklistTemplateRequest
from routers import cleaning_checklists as checklists_router

from .fake_supabase import FakeDB


SUPERVISOR = CurrentUser(
    user_id="sup-1",
    hotel_id="hotel-a",
    role="housekeeping_supervisor",
    email="sup@example.com",
)


def make_db():
    return FakeDB({
        "cleaning_checklist_templates": [],
        "cleaning_checklist_items": [],
    })


@pytest.mark.asyncio
async def test_list_checklists_lazily_seeds_all_clean_types(monkeypatch):
    db = make_db()
    monkeypatch.setattr(checklists_router, "supabase", db)

    response = await checklists_router.list_checklists(SUPERVISOR)
    templates = response["data"]

    assert {t["clean_type"] for t in templates} == {"DEP", "FULL", "LIGHT", "DEFAULT"}
    dep = next(t for t in templates if t["clean_type"] == "DEP")
    assert dep["name"] == "Departure Clean"
    assert len(dep["items"]) == 9
    assert any(item["is_required"] for item in dep["items"])


@pytest.mark.asyncio
async def test_update_checklist_replaces_items(monkeypatch):
    db = make_db()
    monkeypatch.setattr(checklists_router, "supabase", db)
    await checklists_router.list_checklists(SUPERVISOR)  # seed

    request = UpdateChecklistTemplateRequest(
        name="Custom Departure",
        items=[
            ChecklistItemInput(section="Bedroom", label="Flip mattress", is_required=True),
            ChecklistItemInput(section="General", label="Spray air freshener", is_required=False),
        ],
    )
    response = await checklists_router.update_checklist("dep", request, SUPERVISOR)
    updated = response["data"]

    assert updated["name"] == "Custom Departure"
    assert len(updated["items"]) == 2
    assert updated["items"][0]["label"] == "Flip mattress"
    assert updated["items"][0]["sort_order"] == 1

    # Other templates untouched
    full_items = [
        i for i in db.rows["cleaning_checklist_items"]
        if i["template_id"] != updated["id"]
    ]
    assert len(full_items) > 0


@pytest.mark.asyncio
async def test_reset_checklist_restores_defaults(monkeypatch):
    db = make_db()
    monkeypatch.setattr(checklists_router, "supabase", db)
    await checklists_router.list_checklists(SUPERVISOR)
    await checklists_router.update_checklist(
        "light",
        UpdateChecklistTemplateRequest(items=[
            ChecklistItemInput(section="General", label="Only one item", is_required=False),
        ]),
        SUPERVISOR,
    )

    response = await checklists_router.reset_checklist("light", SUPERVISOR)
    restored = response["data"]

    assert restored["name"] == "Light Service"
    assert len(restored["items"]) == 4


def test_template_resolution_falls_back_to_default(monkeypatch):
    db = make_db()
    monkeypatch.setattr(checklists_router, "supabase", db)

    template = checklists_router.get_checklist_template_for_clean_type("hotel-a", None)
    assert template is not None
    assert template["clean_type"] == "DEFAULT"

    dep = checklists_router.get_checklist_template_for_clean_type("hotel-a", "DEP")
    assert dep["clean_type"] == "DEP"
