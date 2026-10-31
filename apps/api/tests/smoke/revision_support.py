"""Shared fixture factory for the Phase 7 tests (drafts, publishing, notification outbox)."""
from routers import scheduling_revisions as revs
from services import revision_store, schedule_outbox

from .request_support import MODULES, seed_requests
from .revision_fakes import RevisionsDB


def make_revisions_db(monkeypatch) -> RevisionsDB:
    database = RevisionsDB(seed_requests(), unique_indexes=[
        ("schedule_revisions", "uq_schedule_revision_one_draft", ("tenant_id", "department_id"), {"status": "draft"}),
    ])
    for module in (*MODULES, revs, revision_store, schedule_outbox):
        monkeypatch.setattr(module, "supabase", database)
    return database
