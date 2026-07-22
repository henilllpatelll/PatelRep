from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from services.programs.contracts import (
    DEFAULT_PROGRAM_TEMPLATES,
    EvidenceRequiredError,
    build_corrective_work_order,
    build_supply_alerts,
    next_recurrence_date,
    should_create_dnd_escalation,
    validate_completion_items,
)
from services.programs.execution import persist_pm_completion


def test_pm_completion_rejects_required_check_without_evidence():
    """As an engineer, I cannot complete a safety PM without required proof."""
    with pytest.raises(EvidenceRequiredError, match="pressure gauge"):
        validate_completion_items([
            {"label": "Verify pressure gauge", "result": "passed", "requires_evidence": True, "evidence": []},
        ])


def test_failed_pm_check_creates_tenant_scoped_corrective_work_order():
    """As an engineer, a failed PM check creates a follow-up work order automatically."""
    completed_at = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
    work_order = build_corrective_work_order(
        tenant_id="hotel-1",
        asset_id="asset-1",
        completion_id="completion-1",
        checklist_item={"label": "Emergency light battery", "result": "failed", "note": "Will not hold charge"},
        created_by="engineer-1",
        completed_at=completed_at,
    )

    assert work_order["tenant_id"] == "hotel-1"
    assert work_order["asset_id"] == "asset-1"
    assert work_order["is_pm_generated"] is True
    assert "Emergency light battery" in work_order["title"]
    assert "completion-1" in work_order["description"]
    assert work_order["priority"] == "urgent"
    assert work_order["due_at"] == "2026-07-21T12:00:00+00:00"


def test_deep_clean_recurrence_advances_from_completion_date():
    """As a supervisor, a completed rotation schedules the next room cycle."""
    assert next_recurrence_date(date(2026, 7, 16), 90) == date(2026, 10, 14)


def test_dnd_policy_only_creates_one_escalation_per_active_dnd_window():
    """As front desk, I receive one timely welfare escalation, not repeated alerts."""
    assert should_create_dnd_escalation(dnd_hours=8.1, threshold_hours=8, existing_open_event=False)
    assert not should_create_dnd_escalation(dnd_hours=7.9, threshold_hours=8, existing_open_event=False)
    assert not should_create_dnd_escalation(dnd_hours=12, threshold_hours=8, existing_open_event=True)


def test_supply_par_alerts_only_include_items_below_their_property_threshold():
    alerts = build_supply_alerts([
        {"name": "Bath towels", "on_hand": 24, "par_level": 30},
        {"name": "Shampoo", "on_hand": 72, "par_level": 60},
    ])

    assert alerts == [{"name": "Bath towels", "on_hand": 24, "par_level": 30, "shortage": 6}]


def test_default_templates_cover_required_engineering_and_floor_programs():
    template_codes = {template["code"] for template in DEFAULT_PROGRAM_TEMPLATES}

    assert {
        "fire_extinguisher",
        "emergency_lighting",
        "fire_alarm_sprinkler",
        "elevator_certificate",
        "pool_check",
        "domestic_water",
        "backflow",
        "privacy_guest_present_entry",
        "sharps_body_fluid_spill",
    }.issubset(template_codes)


def test_phase_four_migration_makes_completion_and_dnd_records_append_only():
    migration = Path(__file__).parents[3] / "supabase" / "migrations" / "071_operational_programs.sql"
    sql = migration.read_text(encoding="utf-8")

    assert "CREATE TABLE public.pm_completion_records" in sql
    assert "CREATE TABLE public.dnd_welfare_events" in sql
    assert "pm_completion_records_immutable" in sql
    assert "dnd_welfare_events_immutable" in sql


def test_pm_completion_persists_items_and_corrective_work_orders():
    """As a manager, a PM record retains its work proof and its failed-check follow-up."""
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "pm_schedules": [{"id": "schedule-1", "tenant_id": "hotel-1"}],
        "evidence_records": [{"id": "photo-1", "tenant_id": "hotel-1"}],
    })
    record = persist_pm_completion(
        db=db,
        tenant_id="hotel-1",
        user_id="engineer-1",
        actor_role="engineer",
        schedule={"id": "schedule-1", "asset_id": "asset-1", "interval_days": 30},
        payload={
            "items": [
                {"key": "battery", "label": "Emergency light battery", "result": "failed", "requires_evidence": True, "evidence": ["photo-1"], "note": "Will not hold charge"},
            ],
            "labor_minutes": 20,
            "parts_used": [{"name": "battery", "quantity": 1}],
        },
    )

    assert record["tenant_id"] == "hotel-1"
    assert db.rows["pm_completion_items"][0]["completion_id"] == record["id"]
    assert db.rows["work_orders"][0]["pm_completion_id"] == record["id"]
    assert db.rows["work_orders"][0]["due_at"]
    assert db.rows["pm_schedules"][0]["last_completed_at"]
    assert db.rows["evidence_records"][0]["related_entity_type"] == "pm_completion"
    assert db.rows["evidence_records"][0]["related_entity_id"] == record["id"]
    containment_events = [
        row for row in db.rows.get("operational_audit_events", [])
        if row["action"] == "pm_check.failed_containment"
    ]
    assert len(containment_events) == 1
    assert containment_events[0]["resource_id"] == record["id"]
    assert containment_events[0]["new_state"]["work_order_id"] == db.rows["work_orders"][0]["id"]


def test_corrective_wo_priority_and_due_at_follow_asset_criticality():
    """G8: life-safety assets escalate to emergency priority (4h SLA); everything else
    stays urgent (24h SLA) — but both branches always set an escalatable due_at."""
    completed_at = datetime(2026, 7, 20, 8, 0, tzinfo=timezone.utc)

    life_safety_wo = build_corrective_work_order(
        tenant_id="hotel-1", asset_id="asset-1", completion_id="completion-1",
        checklist_item={"label": "Fire alarm panel", "result": "failed"},
        created_by="engineer-1", completed_at=completed_at, criticality="life_safety",
    )
    assert life_safety_wo["priority"] == "emergency"
    assert life_safety_wo["due_at"] == "2026-07-20T12:00:00+00:00"

    medium_wo = build_corrective_work_order(
        tenant_id="hotel-1", asset_id="asset-2", completion_id="completion-2",
        checklist_item={"label": "HVAC filter", "result": "failed"},
        created_by="engineer-1", completed_at=completed_at, criticality="medium",
    )
    assert medium_wo["priority"] == "urgent"
    assert medium_wo["due_at"] == "2026-07-21T08:00:00+00:00"


def test_pm_completion_rejects_evidence_id_from_another_tenant():
    """Cross-tenant evidence references must be rejected with zero completion rows written."""
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "pm_schedules": [{"id": "schedule-1", "tenant_id": "hotel-1"}],
        "evidence_records": [{"id": "photo-1", "tenant_id": "hotel-2"}],
    })

    with pytest.raises(ValueError, match="photo-1"):
        persist_pm_completion(
            db=db,
            tenant_id="hotel-1",
            user_id="engineer-1",
            actor_role="engineer",
            schedule={"id": "schedule-1", "asset_id": "asset-1", "interval_days": 30},
            payload={
                "items": [{"key": "battery", "label": "Emergency light battery", "result": "passed"}],
                "photos": ["photo-1"],
            },
        )

    assert db.rows.get("pm_completion_records", []) == []
