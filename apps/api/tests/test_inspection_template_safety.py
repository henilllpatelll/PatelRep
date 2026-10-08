"""Settings > Inspections (phase 3): one default template per hotel, and template removal never harms history.

FakeDB does not enforce foreign keys, so these lock in the router contract that the real
`inspections.template_id` FK (no cascade) relies on: a referenced template is archived, never deleted.
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as hk_router
from tests.smoke.fake_supabase import FakeDB


def _auth(role: str = "gm", hotel_id: str = "hotel-a") -> dict[str, str]:
    payload = {"sub": "user-1", "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def _tmpl(tid: str, tenant: str = "hotel-a", default: bool = False, active: bool = True) -> dict:
    return {"id": tid, "tenant_id": tenant, "name": tid, "room_type_id": None, "is_default": default, "is_active": active}


def _item(iid: str, tid: str, tenant: str = "hotel-a") -> dict:
    return {"id": iid, "template_id": tid, "tenant_id": tenant, "section": "Bathroom", "description": "x",
            "is_required": True, "requires_photo_on_fail": False, "sort_order": 0}


def _db(**extra) -> FakeDB:
    rows = {
        "inspection_templates": [_tmpl("t-default", default=True), _tmpl("t-other"), _tmpl("t-b", tenant="hotel-b", default=True)],
        "inspection_template_items": [_item("i-1", "t-default"), _item("i-2", "t-other"), _item("i-b", "t-b", "hotel-b")],
        "inspections": [],
    }
    rows.update(extra)
    return FakeDB(rows)


def _client(monkeypatch, db: FakeDB) -> TestClient:
    monkeypatch.setattr(hk_router, "supabase", db)
    return TestClient(app)


def _defaults(db: FakeDB, tenant: str = "hotel-a") -> list[str]:
    return [t["id"] for t in db.rows["inspection_templates"] if t["tenant_id"] == tenant and t["is_default"]]


def test_setting_default_clears_the_previous_default_in_this_hotel_only(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).patch("/v1/housekeeping/inspections/templates/t-other", json={"is_default": True}, headers=_auth())
    assert res.status_code == 200
    assert _defaults(db) == ["t-other"]
    assert _defaults(db, "hotel-b") == ["t-b"]


def test_creating_a_default_template_clears_the_previous_default(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).post(
        "/v1/housekeeping/inspections/templates",
        json={"name": "New", "is_default": True, "items": [{"section": "Bathroom", "description": "Toilet"}]},
        headers=_auth(),
    )
    assert res.status_code == 200
    new_id = res.json()["data"]["id"]
    assert _defaults(db) == [new_id]
    assert _defaults(db, "hotel-b") == ["t-b"]


def test_update_unknown_or_foreign_template_is_404_and_changes_nothing(monkeypatch):
    db = _db()
    client = _client(monkeypatch, db)
    res = client.patch("/v1/housekeeping/inspections/templates/t-b", json={"name": "hijack", "items": []}, headers=_auth())
    assert res.status_code == 404
    assert [i["id"] for i in db.rows["inspection_template_items"] if i["template_id"] == "t-b"] == ["i-b"]


def test_cannot_delete_default_template_while_others_exist(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).delete("/v1/housekeeping/inspections/templates/t-default", headers=_auth())
    assert res.status_code == 409
    assert "default" in res.json()["detail"].lower() or "default" in str(res.json()).lower()
    assert any(t["id"] == "t-default" for t in db.rows["inspection_templates"])
    assert any(i["id"] == "i-1" for i in db.rows["inspection_template_items"])


def test_sole_default_template_can_be_deleted(monkeypatch):
    db = _db(inspection_templates=[_tmpl("t-default", default=True)], inspection_template_items=[_item("i-1", "t-default")])
    res = _client(monkeypatch, db).delete("/v1/housekeeping/inspections/templates/t-default", headers=_auth())
    assert res.status_code == 204
    assert db.rows["inspection_templates"] == []


def test_unused_template_is_deleted_with_its_items(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).delete("/v1/housekeeping/inspections/templates/t-other", headers=_auth())
    assert res.status_code == 204
    assert [t["id"] for t in db.rows["inspection_templates"]] == ["t-default", "t-b"]
    assert [i["id"] for i in db.rows["inspection_template_items"]] == ["i-1", "i-b"]


def test_template_used_by_a_completed_inspection_is_archived_not_deleted(monkeypatch):
    db = _db(inspections=[{"id": "insp-1", "tenant_id": "hotel-a", "template_id": "t-other"}])
    res = _client(monkeypatch, db).delete("/v1/housekeeping/inspections/templates/t-other", headers=_auth())
    assert res.status_code == 204
    archived = next(t for t in db.rows["inspection_templates"] if t["id"] == "t-other")
    assert archived["is_active"] is False and archived["is_default"] is False
    assert any(i["id"] == "i-2" for i in db.rows["inspection_template_items"])
    assert db.rows["inspections"] == [{"id": "insp-1", "tenant_id": "hotel-a", "template_id": "t-other"}]


def test_delete_is_tenant_scoped(monkeypatch):
    db = _db()
    res = _client(monkeypatch, db).delete("/v1/housekeeping/inspections/templates/t-b", headers=_auth())
    assert res.status_code == 404
    assert any(t["id"] == "t-b" for t in db.rows["inspection_templates"])


def test_only_gm_and_housekeeping_supervisor_can_change_templates(monkeypatch):
    db = _db()
    client = _client(monkeypatch, db)
    for role in ("housekeeper", "front_desk", "engineer"):
        assert client.delete("/v1/housekeeping/inspections/templates/t-other", headers=_auth(role)).status_code == 403
        assert client.patch("/v1/housekeeping/inspections/templates/t-other", json={"name": "x"}, headers=_auth(role)).status_code == 403
        assert client.post("/v1/housekeeping/inspections/templates", json={"name": "x"}, headers=_auth(role)).status_code == 403
    assert client.delete("/v1/housekeeping/inspections/templates/t-other", headers=_auth("housekeeping_supervisor")).status_code == 204
