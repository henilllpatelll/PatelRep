"""Phase 7 request-contract coverage for structured repair intelligence."""

from uuid import uuid4
from pathlib import Path

from models.requests import (
    CompleteWorkOrderRequest,
    CreateWorkOrderRequest,
    UpdateDiagnosisRequest,
)


def test_create_work_order_keeps_problem_optional_but_persistent():
    problem_code_id = uuid4()
    request = CreateWorkOrderRequest(
        title="PTAC is not cooling",
        category="hvac",
        problem_code_id=problem_code_id,
    )

    assert request.problem_code_id == problem_code_id


def test_diagnosis_keeps_problem_and_cause_separate_with_other_detail():
    request = UpdateDiagnosisRequest(
        problem_code_id=uuid4(),
        cause_code_id=uuid4(),
        cause_other_text="Intermittent board fault after heat soak",
    )

    assert request.problem_code_id != request.cause_code_id
    assert request.cause_other_text == "Intermittent board fault after heat soak"


def test_completion_accepts_structured_repair_and_verification_data():
    request = CompleteWorkOrderRequest(
        problem_code_id=uuid4(),
        cause_code_id=uuid4(),
        resolution_code_id=uuid4(),
        verification_result="follow_up_required",
        verification_notes="Confirm cooling after the evening peak.",
    )

    assert request.resolution_code_id is not None
    assert request.verification_result == "follow_up_required"


def test_schema_keeps_global_codes_and_repeat_links_separate_but_tenant_safe():
    migration = (Path(__file__).parents[3] / "supabase/migrations/112_engineering_repair_intelligence.sql").read_text()

    assert "CREATE TABLE public.engineering_repair_codes" in migration
    assert "tenant_id UUID REFERENCES public.tenants" in migration
    assert "code_type IN ('problem', 'cause', 'resolution')" in migration
    assert "CREATE TABLE public.work_order_relationships" in migration
    assert "relationship_type IN ('repeat_failure', 'follow_up', 'duplicate', 'related')" in migration
    assert "verification_result IN ('passed', 'failed', 'follow_up_required')" in migration
