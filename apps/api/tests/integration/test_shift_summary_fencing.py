"""Fenced finalization of shift-summary generation (migration 237) against the REAL migrated database, never mocks.

Migration 236 decided WHO may generate. These tests prove the commit point is safe even when the lease lapses at the
worst moment: verification, summary write and credit debit are one transaction fenced by the claim's token and
unexpired lease, so two workers can never both persist or both charge for the same generation. Fault injection
expires leases directly in the database between the steps the old code performed in separate calls.
"""

import os
import threading
from datetime import date, datetime, timedelta, timezone

import pytest
from postgrest.exceptions import APIError

from batch_support import new_client
from core.database import get_supabase
from test_shift_summary_claims import claim, complete, occurrence, owned, race

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

DAY = "2026-09-29"
EXPIRED = "2000-01-01T00:00:00+00:00"


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def ledger_for(db, tenant):
    today = date.today()
    db.table("credit_ledger").insert({
        "tenant_id": tenant, "period_start": (today - timedelta(days=3)).isoformat(),
        "period_end": (today + timedelta(days=27)).isoformat(), "credits_included": 5000,
    }).execute()


def used(db, tenant):
    return float(db.table("credit_ledger").select("credits_used").eq("tenant_id", tenant).execute().data[0]["credits_used"])


def charge_rows(db, tenant):
    return db.table("shift_summary_credit_charges").select("claim_token, credits, applied").eq("tenant_id", tenant).execute().data


def summaries(db, tenant):
    return db.table("shift_summaries").select("*").eq("tenant_id", tenant).execute().data


def payload(dept, text="handoff"):
    return {"department_id": dept, "summary_text": text, "stats": {"tasks_completed": 3}, "handoff_data": {}}


def finalize(client, tenant, shift, token, dept, credits=2.5, text="handoff", replace=False, day=DAY):
    return client.rpc("finalize_shift_summary_generation", {
        "p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": day, "p_claim_token": token,
        "p_summary": payload(dept, text), "p_credits": credits, "p_replace_existing": replace}).execute().data


def expire(db, tenant, shift, day=DAY):
    db.table("shift_summary_generation_claims").update({"lease_expires_at": EXPIRED}) \
        .eq("tenant_id", tenant).eq("shift_id", shift).eq("shift_date", day).execute()


def setup(db):
    tenant, shift, dept = occurrence(db)
    ledger_for(db, tenant)
    return tenant, shift, dept


def test_finalize_persists_the_summary_charges_once_and_completes_the_claim(db):
    tenant, shift, dept = setup(db)
    won = claim(db, tenant, shift)
    result = finalize(db, tenant, shift, won["claim_token"], dept, credits=2.5)

    assert result["finalized"] is True and result["charged"] is True
    assert result["summary"]["summary_text"] == "handoff" and result["summary"]["stats"] == {"tasks_completed": 3}
    assert used(db, tenant) == 2.5
    assert [(float(c["credits"]), c["applied"]) for c in charge_rows(db, tenant)] == [(2.5, True)]
    assert len(summaries(db, tenant)) == 1
    assert owned(db, tenant, shift, won["claim_token"]) is False  # claim is succeeded, no longer 'claimed'


def test_replayed_and_simultaneous_finalize_of_one_generation_charge_exactly_once(db):
    tenant, shift, dept = setup(db)
    won = claim(db, tenant, shift)
    results = race(12, lambda c: finalize(c, tenant, shift, won["claim_token"], dept))

    assert not [r for r in results if isinstance(r, Exception)], results
    assert sum(1 for r in results if r["finalized"]) == 1
    assert {r["reason"] for r in results if not r["finalized"]} == {"already_finalized"}
    assert used(db, tenant) == 2.5 and len(charge_rows(db, tenant)) == 1 and len(summaries(db, tenant)) == 1


def test_lease_expiring_between_verification_and_commit_writes_and_charges_nothing(db):
    """The exact hole from review: an ownership check that passed, then the lease lapsed before the commit."""
    tenant, shift, dept = setup(db)
    won = claim(db, tenant, shift)
    assert owned(db, tenant, shift, won["claim_token"]) is True        # the old, token-only check passes ...
    expire(db, tenant, shift)                                          # ... then the lease lapses (fault injection)

    result = finalize(db, tenant, shift, won["claim_token"], dept)
    assert result == {"finalized": False, "reason": "lease_expired"}
    assert used(db, tenant) == 0 and charge_rows(db, tenant) == [] and summaries(db, tenant) == []
    assert db.rpc("shift_summary_claim_valid", {"p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": DAY,
                                                "p_claim_token": won["claim_token"]}).execute().data is False


def test_renewal_extends_a_live_lease_but_never_revives_an_expired_or_superseded_one(db):
    tenant, shift, dept = setup(db)
    first = claim(db, tenant, shift, p_lease_seconds=2)

    def renew(token):
        return db.rpc("renew_shift_summary_claim", {"p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": DAY,
                                                    "p_claim_token": token, "p_lease_seconds": 300}).execute().data
    assert renew(first["claim_token"]) is True
    row = db.table("shift_summary_generation_claims").select("lease_expires_at").eq("tenant_id", tenant).execute().data[0]
    assert datetime.fromisoformat(row["lease_expires_at"]) > datetime.now(timezone.utc) + timedelta(seconds=120)
    expire(db, tenant, shift)
    assert renew(first["claim_token"]) is False                        # expired: cannot be revived

    second = claim(db, tenant, shift, p_retry_after_seconds=0)
    assert second["claimed"] is True
    assert renew(first["claim_token"]) is False                        # superseded token never renews


def test_old_owner_racing_the_takeover_cannot_persist_or_charge(db):
    """Old owner A (lease lapsed) finalizes at the same instant B takes the claim over, repeated to shake out ordering."""
    for _ in range(6):
        tenant, shift, dept = setup(db)
        first = claim(db, tenant, shift)
        expire(db, tenant, shift)
        barrier, out = threading.Barrier(2), {}

        def run_a():
            c = new_client()
            barrier.wait()
            out["a"] = finalize(c, tenant, shift, first["claim_token"], dept, text="A")

        def run_b():
            c = new_client()
            barrier.wait()
            out["b"] = claim(c, tenant, shift)
        threads = [threading.Thread(target=run_a), threading.Thread(target=run_b)]
        [t.start() for t in threads]
        [t.join(30) for t in threads]

        assert out["a"]["finalized"] is False and out["a"]["reason"] in {"lease_expired", "claim_lost"}
        assert out["b"]["claimed"] is True
        assert used(db, tenant) == 0 and summaries(db, tenant) == [] and charge_rows(db, tenant) == []

        done = finalize(db, tenant, shift, out["b"]["claim_token"], dept, text="B")
        assert done["finalized"] is True
        assert used(db, tenant) == 2.5 and [s["summary_text"] for s in summaries(db, tenant)] == ["B"]


def test_two_workers_holding_the_same_generation_cannot_both_charge(db):
    """Worst case: A outlived its lease, B took over, and BOTH call finalize simultaneously. One commit, one charge."""
    for _ in range(6):
        tenant, shift, dept = setup(db)
        a = claim(db, tenant, shift)
        expire(db, tenant, shift)
        b = claim(db, tenant, shift, p_retry_after_seconds=0)
        assert b["claimed"] is True and b["claim_token"] != a["claim_token"]

        barrier, out = threading.Barrier(2), {}

        def run(name, token):
            c = new_client()
            barrier.wait()
            out[name] = finalize(c, tenant, shift, token, dept, text=name)
        threads = [threading.Thread(target=run, args=("A", a["claim_token"])),
                   threading.Thread(target=run, args=("B", b["claim_token"]))]
        [t.start() for t in threads]
        [t.join(30) for t in threads]

        assert out["A"] == {"finalized": False, "reason": "claim_lost"}
        assert out["B"]["finalized"] is True
        assert used(db, tenant) == 2.5, "credits were debited more than once for one generation"
        assert len(charge_rows(db, tenant)) == 1 and [s["summary_text"] for s in summaries(db, tenant)] == ["B"]


def test_the_charge_ledger_itself_admits_one_row_per_generation(db):
    tenant, shift, dept = setup(db)
    won = claim(db, tenant, shift)
    finalize(db, tenant, shift, won["claim_token"], dept)
    with pytest.raises(APIError):
        db.table("shift_summary_credit_charges").insert({
            "claim_token": won["claim_token"], "tenant_id": tenant, "shift_id": shift, "shift_date": DAY,
            "credits": 2.5, "applied": True}).execute()
    assert used(db, tenant) == 2.5


def test_regenerate_is_deliberate_replaces_in_place_clears_acknowledgment_and_charges_again(db):
    tenant, shift, dept = setup(db)
    first = claim(db, tenant, shift)
    finalize(db, tenant, shift, first["claim_token"], dept, text="v1", credits=1.0)
    ack_user = db.table("user_roles").select("user_id").eq("tenant_id", tenant).limit(1).execute().data[0]["user_id"]
    db.table("shift_summaries").update({"acknowledged_by": ack_user, "acknowledged_at": "2026-09-29T20:00:00+00:00"}) \
        .eq("tenant_id", tenant).execute()

    assert claim(db, tenant, shift)["reason"] == "already_generated"   # plain Generate never overwrites
    again = claim(db, tenant, shift, p_replace_existing=True)
    result = finalize(db, tenant, shift, again["claim_token"], dept, text="v2", credits=1.0, replace=True)

    rows = summaries(db, tenant)
    assert result["finalized"] is True and len(rows) == 1
    assert rows[0]["summary_text"] == "v2" and rows[0]["acknowledged_by"] is None and rows[0]["acknowledged_at"] is None
    assert used(db, tenant) == 2.0 and len(charge_rows(db, tenant)) == 2


def test_finalize_without_replace_never_overwrites_or_charges_when_a_summary_exists(db):
    tenant, shift, dept = setup(db)
    won = claim(db, tenant, shift)
    db.table("shift_summaries").insert({"tenant_id": tenant, "shift_id": shift, "shift_date": DAY,
                                         "department_id": dept, "summary_text": "pre-existing", "stats": {}}).execute()

    result = finalize(db, tenant, shift, won["claim_token"], dept, text="late")
    assert result == {"finalized": False, "reason": "already_generated"}
    assert [s["summary_text"] for s in summaries(db, tenant)] == ["pre-existing"] and used(db, tenant) == 0


def test_a_failed_attempt_never_charges_and_the_retry_charges_once(db):
    tenant, shift, dept = setup(db)
    first = claim(db, tenant, shift, p_retry_after_seconds=0)
    assert complete(db, tenant, shift, first["claim_token"], False, "provider 503") is True
    assert finalize(db, tenant, shift, first["claim_token"], dept)["finalized"] is False   # failed claim cannot commit
    assert used(db, tenant) == 0

    retry = claim(db, tenant, shift, p_retry_after_seconds=0)
    assert finalize(db, tenant, shift, retry["claim_token"], dept)["finalized"] is True
    assert used(db, tenant) == 2.5 and len(charge_rows(db, tenant)) == 1
