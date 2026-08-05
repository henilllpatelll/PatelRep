"""
Dry-run-gated, allowlist-scoped cleanup tool for dev/QA test tenants (QA-03).

Default mode is DRY-RUN (safe, no writes). Pass --execute to perform real
deletes. Deletes are scoped ONLY to tenant_ids in DELETE_ALLOWLIST, and NEVER
touch EXCLUDE_TABLES (append-only, immutability-triggered compliance tables).
The `tenants` row itself is never deleted — only child data.

Run (dry-run, default):  python apps/api/scripts/cleanup_test_data.py
Run (real delete):       python apps/api/scripts/cleanup_test_data.py --execute

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.database import supabase

# ─── Constants (transcribed from .planning/phases/21-dev-qa-test-data-hygiene/21-ALLOWLIST.md) ───

PRESERVE = {"23264962-aa09-4e4f-a49d-fc345cc91414"}  # active QA fixture — never delete

DELETE_ALLOWLIST = {
    "100b4516-44f1-408b-bc9b-c820514bdfca",  # Patel Test Hotel
    "c1d12e19-7400-4be3-b1d6-b2319f5cf7b2",  # Lakeside Inn & Suites (lakeside-inn-suites-2)
    "9745ef9b-257b-4241-90f5-191d5f28e4c4",  # Lakeside Inn & Suites (lakeside-inn-suites-3)
    "912fb2e2-5d3a-4974-adde-ee41ba4e4cc7",  # Lakeside Inn & Suites (lakeside-inn-suites)
    "c42bea9e-da6a-405d-95a1-e32b53b0b811",  # Lakeside Inn & Suites (lakeside-inn-suites-1)
    "fc67f917-939e-44b7-a6fe-be4a44bfc0ef",  # Sonesta ES Suites
    "b442eb82-85f2-4bff-b2cd-f7fea51559ec",  # Sonesta ES Suites Fossil Creek (sonesta-es-suites-fossil-creek-1)
    "4a32bb39-9bae-42de-9db9-142b92eb8475",  # Sonesta ES Suites Fossil Creek (sonesta-es-suites-fossil-creek)
    "d8994fd3-9028-41bb-bbcb-056867521023",  # Validation Tenant isoval-20260512190107
}  # exactly 9

EXCLUDE_TABLES = {"controlled_incidents", "controlled_incident_events"}  # append-only, QA-03

# Fallback: all public tables carrying a tenant_id column, verified live against
# oacnwalhcpqdabivweki (information_schema.columns query) at authoring time.
# Used if programmatic discovery via the SDK is not reachable.
FALLBACK_TENANT_TABLES = {
    "accessible_room_features", "ai_interactions", "ai_model_routes", "ai_recommendation_events",
    "ai_recommendations", "asset_categories", "assets", "chemical_inventory",
    "cleaning_checklist_items", "cleaning_checklist_templates", "controlled_documents",
    "controlled_incident_events", "controlled_incidents", "credit_ledger",
    "deep_clean_occurrences", "deep_clean_schedules", "departments", "dnd_welfare_events",
    "dnd_welfare_policies", "document_acknowledgements", "emergency_contacts",
    "emergency_drill_follow_up_evidence", "emergency_drill_participants", "emergency_drills",
    "emergency_role_assignments", "evidence_exception_actions", "evidence_records",
    "failure_predictions", "feedback_submissions", "guest_message_delivery_events",
    "guest_messages", "guest_recovery_actions", "guest_request_events",
    "guest_request_sla_policies", "guest_requests", "hk_shift_sessions",
    "housekeeper_profiles", "housekeeping_stayover_rules", "housekeeping_supply_pars",
    "inspection_results", "inspection_sampling_rules", "inspection_template_items",
    "inspection_templates", "inspections", "integration_sync_conflict_events",
    "integration_sync_conflicts", "late_checkout_requests", "logbook_entries",
    "lost_found_custody_events", "lost_found_items", "notification_deliveries",
    "notifications", "opera_credentials", "opera_oauth_states", "opera_reservations",
    "operational_audit_events", "pm_checklist_templates", "pm_completion_items",
    "pm_completion_records", "pm_deferrals", "pm_schedules", "property_applicability",
    "public_areas", "room_assignments", "room_clean_photos", "room_clean_sessions",
    "room_readiness_predictions", "room_status", "room_status_history", "room_types",
    "rooms", "safety_device_intake_contracts", "safety_training_assignments",
    "safety_training_courses", "shift_assignments", "shift_summaries", "shifts",
    "sop_chunks", "sop_documents", "staff_invitations", "subscriptions", "task_comments",
    "tasks", "tenant_group_memberships", "user_profiles", "user_roles",
    "work_order_comments", "work_order_photos", "work_orders",
}


def discover_tenant_tables():
    """Discover tables with a tenant_id column. Falls back to the documented
    explicit list if information_schema is not reachable via the SDK."""
    try:
        result = supabase.rpc(
            "execute_sql",
            {"query": "SELECT table_name FROM information_schema.columns "
                      "WHERE table_schema='public' AND column_name='tenant_id'"},
        ).execute()
        tables = {row["table_name"] for row in (result.data or [])}
        if tables:
            return tables
    except Exception:
        pass
    return set(FALLBACK_TENANT_TABLES)


def run_guardrails():
    """Guardrails that MUST pass before any DB write — also run in dry-run."""
    assert DELETE_ALLOWLIST, "DELETE_ALLOWLIST is empty — refusing to run."
    assert PRESERVE.isdisjoint(DELETE_ALLOWLIST), (
        "PRESERVE and DELETE_ALLOWLIST overlap — the fixture would be deleted. Aborting."
    )

    all_ids = list(DELETE_ALLOWLIST | PRESERVE)
    rows = supabase.table("tenants").select("id, is_test").in_("id", all_ids).execute().data or []
    is_test_by_id = {row["id"]: row["is_test"] for row in rows}

    for tid in DELETE_ALLOWLIST:
        if not is_test_by_id.get(tid, False):
            raise AssertionError(f"Allowlisted tenant {tid} does not have is_test=true. Aborting.")
    for tid in PRESERVE:
        if is_test_by_id.get(tid, False):
            raise AssertionError(f"PRESERVE tenant {tid} unexpectedly has is_test=true. Aborting.")


def count_or_delete(table, dry_run):
    """Scoped count (dry-run) or scoped delete (execute) for one table."""
    ids = list(DELETE_ALLOWLIST)
    if dry_run:
        try:
            result = supabase.table(table).select("id", count="exact").in_("tenant_id", ids).execute()
            return result.count or 0
        except Exception:
            # Some join/event tables may lack an `id` column — fall back to a
            # count that doesn't assume one.
            result = supabase.table(table).select("tenant_id", count="exact").in_("tenant_id", ids).execute()
            return result.count or 0
    result = supabase.table(table).delete().in_("tenant_id", ids).execute()
    return len(result.data or [])


def execute_with_fk_retry(tables):
    """Fixpoint retry loop: attempt each remaining table's delete; defer any
    that fail on an FK-violation (RESTRICT); repeat until no progress."""
    remaining = set(tables)
    totals = {}
    while remaining:
        progressed = False
        still_remaining = set()
        for table in remaining:
            try:
                totals[table] = count_or_delete(table, dry_run=False)
                progressed = True
            except Exception as exc:
                msg = str(exc)
                if "23503" in msg or "foreign key" in msg.lower() or "violates" in msg.lower():
                    still_remaining.add(table)
                else:
                    raise
        if not progressed and still_remaining:
            raise RuntimeError(
                f"FK-safe delete stalled — tables could not be resolved: {sorted(still_remaining)}"
            )
        remaining = still_remaining
    return totals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true",
                         help="Perform real deletes. Default is dry-run (safe, no writes).")
    args = parser.parse_args()
    dry_run = not args.execute

    run_guardrails()

    tables = sorted((discover_tenant_tables() | FALLBACK_TENANT_TABLES) - EXCLUDE_TABLES - {"tenants"})

    print("=" * 60)
    print("DRY-RUN (no writes)" if dry_run else "EXECUTE (real deletes)")
    print("=" * 60)
    print(f"Allowlisted tenants: {len(DELETE_ALLOWLIST)}  |  Preserved: {len(PRESERVE)}")
    print()

    if dry_run:
        totals = {table: count_or_delete(table, dry_run=True) for table in tables}
    else:
        totals = execute_with_fk_retry(tables)

    total = 0
    for table in tables:
        n = totals.get(table, 0)
        if n:
            print(f"  {table:45s} {n:6d}")
        total += n

    print()
    print(f"TOTAL rows {'would be deleted' if dry_run else 'deleted'}: {total}")
    print(f"Scope: only tenant_ids in DELETE_ALLOWLIST ({len(DELETE_ALLOWLIST)} tenants). "
          "Zero rows touched outside the allowlist (every query is .in_('tenant_id', DELETE_ALLOWLIST)-scoped).")
    print(f"Excluded tables (never touched, append-only): {sorted(EXCLUDE_TABLES)} — 0 rows.")
    print(f"tenants row itself: NOT deleted (child data only).")


if __name__ == "__main__":
    main()
