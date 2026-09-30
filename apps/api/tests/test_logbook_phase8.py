"""Focused contracts for Logbook Phase 8 safety helpers."""

from routers.logbook import (
    build_logbook_attachment_metadata,
    can_permanently_delete_logbook_entry,
    logbook_translation_source_hash,
)
from fastapi.testclient import TestClient
from main import app
from routers import logbook as logbook_router
from tests.test_logbook_foundation import _auth_header, _db, _entry


def test_attachment_metadata_never_exposes_private_storage_path():
    attachment = build_logbook_attachment_metadata({
        "id": "evidence-1",
        "label": "Bathroom leak",
        "evidence_type": "photo",
        "file_name": "bathroom-leak.jpg",
        "file_content_type": "image/jpeg",
        "storage_path": "hotel-a/evidence-1/private-token.jpg",
        "collected_at": "2026-09-29T18:00:00Z",
        "collector_profile": {"preferred_name": "Sarah"},
    })

    assert attachment == {
        "id": "evidence-1",
        "label": "Bathroom leak",
        "file_name": "bathroom-leak.jpg",
        "file_content_type": "image/jpeg",
        "evidence_type": "photo",
        "collected_at": "2026-09-29T18:00:00Z",
        "collector_name": "Sarah",
    }
    assert "storage_path" not in attachment


def test_only_gm_can_permanently_delete_logbook_entries():
    assert can_permanently_delete_logbook_entry("gm")
    assert not can_permanently_delete_logbook_entry("chief_engineer")
    assert not can_permanently_delete_logbook_entry("housekeeping_supervisor")
    assert not can_permanently_delete_logbook_entry("front_desk")


def test_translation_hash_changes_when_source_text_changes():
    assert logbook_translation_source_hash("Room 412 leak") != logbook_translation_source_hash("Room 412 leak resolved")
    assert logbook_translation_source_hash("Room 412 leak") == logbook_translation_source_hash("Room 412 leak")


def test_attachment_list_is_tenant_scoped_and_never_returns_storage_paths(monkeypatch):
    entry_id = "entry-phase8"
    db = _db({
        "logbook_entries": [_entry(entry_id, author_id="user-a")],
        "user_profiles": [{"id": "user-a", "tenant_id": "hotel-a", "preferred_name": "Avery"}],
        "evidence_records": [
            {
                "id": "attachment-a", "tenant_id": "hotel-a", "related_entity_type": "logbook_entry",
                "related_entity_id": entry_id, "label": "Leak photo", "evidence_type": "photo",
                "file_name": "leak.jpg", "file_content_type": "image/jpeg", "storage_path": "hotel-a/private.jpg",
                "collected_by": "user-a", "collected_at": "2026-09-29T18:00:00Z",
            },
            {
                "id": "attachment-b", "tenant_id": "hotel-b", "related_entity_type": "logbook_entry",
                "related_entity_id": entry_id, "label": "Other hotel", "evidence_type": "file",
                "storage_path": "hotel-b/private.pdf",
            },
        ],
    })
    monkeypatch.setattr(logbook_router, "supabase", db)

    response = TestClient(app).get(f"/v1/logbook/entries/{entry_id}/attachments", headers=_auth_header("gm"))

    assert response.status_code == 200
    assert response.json()["data"] == [{
        "id": "attachment-a", "label": "Leak photo", "file_name": "leak.jpg",
        "file_content_type": "image/jpeg", "evidence_type": "photo",
        "collected_at": "2026-09-29T18:00:00Z", "collector_name": "Avery",
    }]
