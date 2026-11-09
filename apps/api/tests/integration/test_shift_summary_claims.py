"""Shift-summary generation claims (migration 236) against the REAL migrated database, never mocks.

The unit tests prove how the API uses the claim; these prove the claim itself: under genuinely simultaneous requests
exactly ONE caller is told to generate, a crashed owner's lease can be taken over by exactly one successor, a superseded
owner is rejected, and the retry/backoff/cap rules hold. Each test builds its own hotel/shift so nothing collides.
"""

import os
import threading

import pytest

from batch_support import make_hotel, new_client
from core.database import get_supabase

pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)

DAY = "2026-09-29"


@pytest.fixture(scope="module")
def db():
    return get_supabase()


def occurrence(db):
    hotel = make_hotel(db, rooms={"r1": {}}, housekeepers=1)
    dept = db.table("departments").insert({"tenant_id": hotel.tenant_id, "name": "Housekeeping", "code": "HK"}).execute().data[0]["id"]
    shift = db.table("shifts").insert({"tenant_id": hotel.tenant_id, "name": "Morning", "department_id": dept,
                                        "start_time": "07:00:00", "end_time": "15:00:00"}).execute().data[0]["id"]
    return hotel.tenant_id, shift, dept


def claim(client, tenant, shift, day=DAY, **overrides):
    params = {"p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": day, "p_claimed_by": "test", **overrides}
    return client.rpc("claim_shift_summary_generation", params).execute().data


def complete(client, tenant, shift, token, ok, error=None, day=DAY):
    return client.rpc("complete_shift_summary_generation", {
        "p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": day,
        "p_claim_token": token, "p_succeeded": ok, "p_error": error}).execute().data


def owned(client, tenant, shift, token, day=DAY):
    return client.rpc("shift_summary_claim_owned", {
        "p_tenant_id": tenant, "p_shift_id": shift, "p_shift_date": day, "p_claim_token": token}).execute().data


def race(n, fn):
    barrier, out = threading.Barrier(n), [None] * n

    def work(i):
        client = new_client()
        barrier.wait()
        try:
            out[i] = fn(client)
        except Exception as exc:  # noqa: BLE001 - surfaced by the assertions
            out[i] = exc
    threads = [threading.Thread(target=work, args=(i,)) for i in range(n)]
    [t.start() for t in threads]
    [t.join(60) for t in threads]
    return out


def test_simultaneous_claims_yield_exactly_one_owner(db):
    tenant, shift, _ = occurrence(db)
    results = race(12, lambda c: claim(c, tenant, shift))
    assert not [r for r in results if isinstance(r, Exception)], results
    assert sum(1 for r in results if r["claimed"]) == 1
    assert {r["reason"] for r in results if not r["claimed"]} == {"in_progress"}


def test_expired_lease_is_taken_over_by_exactly_one_successor_and_the_old_owner_is_rejected(db):
    tenant, shift, _ = occurrence(db)
    first = claim(db, tenant, shift)
    assert first["claimed"] and owned(db, tenant, shift, first["claim_token"])
    db.table("shift_summary_generation_claims").update({"lease_expires_at": "2000-01-01T00:00:00+00:00"}) \
        .eq("tenant_id", tenant).eq("shift_id", shift).execute()

    results = race(8, lambda c: claim(c, tenant, shift))
    winners = [r for r in results if not isinstance(r, Exception) and r["claimed"]]
    assert len(winners) == 1 and winners[0]["attempts"] == 2

    assert owned(db, tenant, shift, first["claim_token"]) is False   # superseded: must write/charge nothing
    assert complete(db, tenant, shift, first["claim_token"], True) is False
    assert owned(db, tenant, shift, winners[0]["claim_token"]) is True


def test_success_blocks_further_claims_until_a_regenerate_replaces_it(db):
    tenant, shift, _ = occurrence(db)
    won = claim(db, tenant, shift)
    assert complete(db, tenant, shift, won["claim_token"], True) is True
    assert complete(db, tenant, shift, won["claim_token"], True) is False  # cannot complete twice
    assert claim(db, tenant, shift)["reason"] == "already_generated"
    again = claim(db, tenant, shift, p_replace_existing=True)
    assert again["claimed"] and again["attempts"] == 1
    assert claim(db, tenant, shift, p_replace_existing=True)["reason"] == "in_progress"


def test_failure_backoff_attempt_cap_and_manual_override(db):
    tenant, shift, _ = occurrence(db)
    first = claim(db, tenant, shift, p_retry_after_seconds=0)
    assert complete(db, tenant, shift, first["claim_token"], False, "provider 503") is True
    assert claim(db, tenant, shift)["reason"] == "backoff"                       # default 900s backoff

    for expected_attempt in (2, 3):
        retry = claim(db, tenant, shift, p_retry_after_seconds=0)
        assert retry["claimed"] and retry["attempts"] == expected_attempt
        complete(db, tenant, shift, retry["claim_token"], False, f"fail {expected_attempt}")

    spent = claim(db, tenant, shift, p_retry_after_seconds=0)
    assert spent["reason"] == "retry_exhausted" and spent["last_error"] == "fail 3"
    manual = claim(db, tenant, shift, p_ignore_retry_limits=True)
    assert manual["claimed"] and manual["attempts"] == 4


def test_an_existing_summary_row_blocks_a_plain_claim_even_without_a_claim_row(db):
    tenant, shift, dept = occurrence(db)
    db.table("shift_summaries").insert({"tenant_id": tenant, "shift_id": shift, "shift_date": DAY,
                                         "department_id": dept, "summary_text": "manual", "stats": {}}).execute()
    assert claim(db, tenant, shift)["reason"] == "already_generated"
    assert claim(db, tenant, shift, p_replace_existing=True)["claimed"] is True


def test_claims_are_scoped_to_their_own_occurrence(db):
    tenant, shift, _ = occurrence(db)
    other_tenant, other_shift, _ = occurrence(db)
    assert claim(db, tenant, shift)["claimed"] and claim(db, other_tenant, other_shift)["claimed"]
    assert claim(db, tenant, shift, day="2026-09-30")["claimed"]  # next day is a different occurrence
    assert claim(db, tenant, shift)["reason"] == "in_progress"    # and the original day is still held
