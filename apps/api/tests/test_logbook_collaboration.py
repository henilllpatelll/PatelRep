"""Focused collaboration policy tests for Logbook Phase 7."""

from routers.logbook import should_reset_acknowledgments
from fastapi.testclient import TestClient
from main import app
from routers import logbook as logbook_router
from tests.test_logbook_foundation import _auth_header, _db, _entry


def test_acknowledgments_reset_only_for_material_handoff_changes():
    assert should_reset_acknowledgments({"content": "Updated instructions"})
    assert should_reset_acknowledgments({"priority": "important"})
    assert should_reset_acknowledgments({"follow_up_at": "2026-09-30T17:00:00Z"})
    assert should_reset_acknowledgments({"related_id": "00000000-0000-4000-8000-000000000001"})
    assert should_reset_acknowledgments({"status": "resolved"})


def test_acknowledgments_do_not_reset_for_non_material_metadata():
    assert not should_reset_acknowledgments({"expires_at": "2026-09-30T17:00:00Z"})
    assert not should_reset_acknowledgments({"category": "general"})
    assert not should_reset_acknowledgments({"edited_at": "2026-09-30T17:00:00Z"})


def test_comment_and_read_endpoints_are_tenant_scoped_and_idempotent(monkeypatch):
    db = _db({
        "logbook_entries": [_entry("entry-1", author_id="author-a")],
        "logbook_entry_events": [],
        "logbook_entry_comments": [],
        "logbook_comment_mentions": [],
        "logbook_entry_reads": [],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)
    client = TestClient(app)

    created = client.post("/v1/logbook/entries/entry-1/comments", headers=_auth_header("gm"), json={"content": "  Vendor called. ETA 5 PM.  "})
    assert created.status_code == 200
    assert created.json()["data"]["content"] == "Vendor called. ETA 5 PM."
    assert client.get("/v1/logbook/entries/entry-1/comments", headers=_auth_header("gm")).json()["data"][0]["author_id"] == "user-a"

    assert client.post("/v1/logbook/entries/entry-1/read", headers=_auth_header("gm")).status_code == 200
    assert client.post("/v1/logbook/entries/entry-1/read", headers=_auth_header("gm")).status_code == 200
    assert len(db.rows["logbook_entry_reads"]) == 1
