"""Which SOP documents an employee may read, and the assistant may cite.

One definition used by the mobile library, the original-file link, retrieval and the assistant's
document context, so they can never disagree.

``sop_documents`` is the upload registry and carries no approval state. Approval, version and review
dates live on ``controlled_documents`` (migration 069), linked through ``source_sop_document_id``:

* an upload with NO controlled-document record stays visible exactly as before, with no status claimed
  (nothing here can say "approved" for a record that has no approval);
* such an unlinked upload is for BROWSING only: ``ai_ready`` is False and ``require_approved=True`` excludes
  it, so retrieval and the assistant never present it as approved hotel policy;
* an upload WITH records is visible only while one of them is ``approved``, has taken effect and has not
  expired. A draft, superseded or archived record hides it, so a retired procedure is never offered as
  current policy.

Every lookup is scoped to the caller's hotel; a record of another hotel behaves like a missing one.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Optional

# Only what a client needs. storage_path stays on the server: files are served through a short-lived link.
DOCUMENT_COLUMNS = "id, title, description, category, page_count, indexing_status, created_at, updated_at, indexed_at"
_PUBLIC_FIELDS = tuple(c.strip() for c in DOCUMENT_COLUMNS.split(","))
CONTROLLED_COLUMNS = (
    "id, source_sop_document_id, version_number, approval_state, effective_date, review_date, expiration_date, approved_at"
)


class SopUnavailable(RuntimeError):
    """Retrieval cannot run safely right now (embedding model unusable, malformed provider reply).

    Lives here, not in sop_rag, so its identity survives a module reload of the RAG service."""


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def current_approval(records: Iterable[dict], today: Optional[date] = None) -> tuple[bool, Optional[dict]]:
    """(visible, approval) for the controlled-document records linked to ONE upload.

    No records: visible with no approval. Records but none in force: hidden. Otherwise the highest
    approved version in force, so a re-issue always wins over the version it replaced.
    """
    rows = list(records)
    if not rows:
        return True, None
    today = today or date.today()
    in_force = []
    for row in rows:
        if row.get("approval_state") != "approved":
            continue
        effective, expires = _as_date(row.get("effective_date")), _as_date(row.get("expiration_date"))
        if effective and effective > today:
            continue
        if expires and expires < today:
            continue
        in_force.append(row)
    if not in_force:
        return False, None
    best = max(in_force, key=lambda row: row.get("version_number") or 0)
    return True, {
        "state": "approved",
        "version": best.get("version_number"),
        "effective_date": best.get("effective_date"),
        "review_date": best.get("review_date"),
        "approved_at": best.get("approved_at"),
    }


def visible_documents(
    db: Any,
    hotel_id: str,
    ids: Optional[list[str]] = None,
    *,
    require_indexed: bool = False,
    require_approved: bool = False,
    today: Optional[date] = None,
) -> list[dict]:
    """The hotel's documents an employee may see, each with its real approval metadata (or None).

    ``require_approved`` keeps only documents with an approval record in force. Anything that speaks AS hotel
    policy (retrieval, the assistant's document context) must pass it; browsing does not."""
    query = db.table("sop_documents").select(DOCUMENT_COLUMNS).eq("tenant_id", hotel_id)
    if ids is not None:
        if not ids:
            return []
        query = query.in_("id", list(ids))
    if require_indexed:
        query = query.eq("indexing_status", "indexed")
    docs = [row for row in (query.order("created_at", desc=True).execute().data or []) if row.get("id")]
    if not docs:
        return []

    linked = (
        db.table("controlled_documents").select(CONTROLLED_COLUMNS)
        .eq("tenant_id", hotel_id).in_("source_sop_document_id", [d["id"] for d in docs])
        .execute()
    ).data or []
    by_doc: dict[str, list[dict]] = {}
    for record in linked:
        by_doc.setdefault(record.get("source_sop_document_id"), []).append(record)

    out = []
    for doc in docs:
        visible, approval = current_approval(by_doc.get(doc["id"], []), today)
        if not visible or (require_approved and approval is None):
            continue
        # An explicit allow-list, whatever the query returned: storage paths and tenant ids never go to a client.
        safe = {key: doc.get(key) for key in _PUBLIC_FIELDS}
        out.append({**safe, "approval": approval, "ai_ready": doc.get("indexing_status") == "indexed" and approval is not None})
    return out


def visible_document(
    db: Any, hotel_id: str, document_id: str, *, require_indexed: bool = False, require_approved: bool = False
) -> Optional[dict]:
    rows = visible_documents(
        db, hotel_id, [document_id], require_indexed=require_indexed, require_approved=require_approved
    )
    return rows[0] if rows else None
