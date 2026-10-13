"""Phase 1 safety contracts for the Opera HK Details import (parser, preview, apply).

Everything is sanitized and in-memory: synthetic room numbers, no guest names, no
network, no real database. Covers the Clean-vs-OOO mapping bug, unknown statuses,
OOO/OOS protection, active-clean protection, preview/apply agreement, tenant
isolation, date validation, repeat imports and the documented baseline reset.
"""
import io
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from middleware.auth import CurrentUser
from routers import housekeeping as hk
from services.opera_pdf import HKDetailsRow, map_hk_status, parse_hk_details

from .fake_supabase import FakeDB

TODAY = date(2026, 10, 13)
TODAY_STR = TODAY.isoformat()
HOTEL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
HOTEL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
SUPERVISOR = CurrentUser(user_id="11111111-1111-4111-8111-111111111111", hotel_id=HOTEL_A,
                         role="housekeeping_supervisor", email="sup@example.com")


class RpcFakeDB(FakeDB):
    """FakeDB plus the create_room_unavailability RPC the importer uses for OOO."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.rpc_calls = []

    def rpc(self, name, params):
        db = self

        class _Call:
            def execute(self_inner):
                db.rpc_calls.append((name, params))
                if name == "create_room_unavailability":
                    for row in db.rows.get("room_status", []):
                        if row["room_id"] == params["p_room_id"] and row["tenant_id"] == params["p_tenant_id"]:
                            row["status"] = "OOO"
                    db.rows.setdefault("room_unavailability_periods", []).append(
                        {"room_id": params["p_room_id"], "tenant_id": params["p_tenant_id"], "status": "ACTIVE",
                         "source": params["p_source"]})
                return SimpleNamespace(data={})

        return _Call()


def _room(room_id, number, tenant=HOTEL_A):
    return {"id": room_id, "tenant_id": tenant, "room_number": number}


def _status(room_id, status="DIRTY", tenant=HOTEL_A, **extra):
    return {"room_id": room_id, "tenant_id": tenant, "status": status, "fo_status": "VAC", **extra}


def _row(number, our_status, fo="VAC", raw=None):
    return HKDetailsRow(room_number=number, raw_status=raw or (our_status or ""), our_status=our_status,
                        fo_status=fo, reservation_status="Stayover")


def _upload():
    return UploadFile(filename="hk-details.pdf", file=io.BytesIO(b"%PDF"))


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(hk, "_hotel_today", lambda: TODAY)


def _install(monkeypatch, db, rows, warnings=None):
    monkeypatch.setattr(hk, "supabase", db)
    monkeypatch.setattr(hk, "parse_hk_details", lambda _pdf: (list(rows), list(warnings or [])))


async def _apply(monkeypatch, db, rows, warnings=None, date_str=TODAY_STR):
    _install(monkeypatch, db, rows, warnings)
    return (await hk.import_hk_details(file=_upload(), assignment_date=date_str, current_user=SUPERVISOR))["data"]


async def _preview(monkeypatch, db, rows, warnings=None, date_str=TODAY_STR):
    _install(monkeypatch, db, rows, warnings)
    return (await hk.preview_hk_details_import(file=_upload(), assignment_date=date_str, current_user=SUPERVISOR))["data"]


def _status_of(db, room_id):
    return next(r for r in db.rows["room_status"] if r["room_id"] == room_id)


# ---------------------------------------------------------------------------
# Parser: status mapping
# ---------------------------------------------------------------------------

def test_status_map_keeps_every_status_distinct_and_clean_is_never_ooo():
    mapped = {raw: map_hk_status(raw) for raw in
              ["Dirty", "Clean", "Inspected", "Pickup", "Out of Order", "Out of Service"]}
    assert mapped == {"Dirty": "DIRTY", "Clean": "CLEAN", "Inspected": "INSPECTED", "Pickup": "PICKUP",
                      "Out of Order": "OOO", "Out of Service": "OOS"}
    assert len(set(mapped.values())) == 6
    assert map_hk_status("  CLEAN ") == "CLEAN"
    assert map_hk_status("clean") != "OOO"


@pytest.mark.parametrize("raw", ["", "Bogus", "Dirty/Clean", "OOO", "DI", None])
def test_unknown_status_is_not_guessed(raw):
    assert map_hk_status(raw) is None


def _fake_hk_pdf(rows):
    """rows: [(room, status_text, fo_text, res_text)] laid out on Opera's HK Details columns."""
    width = 594.0
    words = []
    for i, (room, status, fo, res) in enumerate(rows):
        top = 100 + i * 20
        words.append({"text": room, "x0": 10, "top": top, "x1": 30})
        for j, part in enumerate(status.split()):
            words.append({"text": part, "x0": 120 + j * 40, "top": top, "x1": 150 + j * 40})
        words.append({"text": fo, "x0": 330, "top": top, "x1": 350})
        words.append({"text": res, "x0": 420, "top": top, "x1": 460})
    page = MagicMock()
    page.width = width
    page.extract_words.return_value = words
    pdf = MagicMock()
    pdf.__enter__ = lambda s: s
    pdf.__exit__ = MagicMock(return_value=False)
    pdf.pages = [page]
    return pdf


def test_pdf_parsing_never_turns_a_clean_room_into_ooo():
    pdf = _fake_hk_pdf([("101", "Clean", "VAC", "Stayover"), ("102", "Out of Order", "VAC", "Stayover"),
                        ("103", "Out of Service", "VAC", "Stayover"), ("104", "Inspected", "VAC", "Stayover")])
    with patch("services.opera_pdf.pdfplumber.open", return_value=pdf):
        rows, warnings = parse_hk_details(b"%PDF-dummy")
    by_room = {r.room_number: r.our_status for r in rows}
    assert by_room == {"101": "CLEAN", "102": "OOO", "103": "OOS", "104": "INSPECTED"}
    assert not warnings


def test_pdf_parsing_flags_unknown_status_with_actionable_warning():
    pdf = _fake_hk_pdf([("101", "Mystery", "VAC", "Stayover"), ("102", "Dirty", "OCC", "Stayover")])
    with patch("services.opera_pdf.pdfplumber.open", return_value=pdf):
        rows, warnings = parse_hk_details(b"%PDF-dummy")
    by_room = {r.room_number: r.our_status for r in rows}
    assert by_room == {"101": None, "102": "DIRTY"}
    assert len(warnings) == 1 and "Room 101" in warnings[0] and "Mystery" in warnings[0] and "not be imported" in warnings[0]


# ---------------------------------------------------------------------------
# Apply: statuses
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_clean_row_is_written_as_clean_and_never_creates_an_ooo_period(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN")])
    assert data["applied"] == 1
    assert _status_of(db, "r1")["status"] == "CLEAN"
    assert db.rpc_calls == []
    assert db.rows.get("room_unavailability_periods", []) == []


@pytest.mark.asyncio
async def test_each_distinct_status_lands_in_its_own_room_status(monkeypatch):
    ids = {n: f"r{n}" for n in ("101", "102", "103", "104")}
    db = RpcFakeDB({"rooms": [_room(i, n) for n, i in ids.items()],
                    "room_status": [_status(i, "DIRTY") for i in ids.values()]})
    await _apply(monkeypatch, db, [_row("101", "DIRTY"), _row("102", "CLEAN"),
                                   _row("103", "INSPECTED"), _row("104", "PICKUP")])
    assert [_status_of(db, ids[n])["status"] for n in ("101", "102", "103", "104")] == \
        ["DIRTY", "CLEAN", "INSPECTED", "PICKUP"]


@pytest.mark.asyncio
async def test_unknown_status_row_is_skipped_and_state_is_untouched(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101"), _room("r2", "102")],
                    "room_status": [_status("r1", "CLEAN", guest_name="Keep Me", notes="manual note"), _status("r2", "DIRTY")]})
    data = await _apply(monkeypatch, db, [_row("101", None, raw="Mystery"), _row("102", "CLEAN")],
                        warnings=["Room 101: unrecognised housekeeping status 'Mystery' - row will not be imported"])
    assert data["skipped_unrecognised"] == 1 and data["applied"] == 1
    untouched = _status_of(db, "r1")
    assert untouched["status"] == "CLEAN" and untouched["guest_name"] == "Keep Me" and untouched["notes"] == "manual note"
    assert any("Room 101" in w for w in data["warnings"])


@pytest.mark.asyncio
async def test_most_rows_unrecognised_rejects_the_whole_import(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101"), _room("r2", "102"), _room("r3", "103")],
                    "room_status": [_status("r1", "CLEAN"), _status("r2", "CLEAN"), _status("r3", "CLEAN")]})
    rows = [_row("101", None, raw="x"), _row("102", None, raw="y"), _row("103", "DIRTY")]
    with pytest.raises(HTTPException) as exc:
        await _apply(monkeypatch, db, rows)
    assert exc.value.status_code == 422 and "unrecognised" in exc.value.detail
    assert all(r["status"] == "CLEAN" for r in db.rows["room_status"])
    with pytest.raises(HTTPException) as exc:
        await _preview(monkeypatch, db, rows)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_out_of_service_is_left_alone_and_never_written_to_room_status(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "CLEAN")]})
    data = await _apply(monkeypatch, db, [_row("101", "OOS")])
    assert data["skipped_unsupported"] == 1 and data["applied"] == 0
    assert _status_of(db, "r1")["status"] == "CLEAN"
    assert db.rpc_calls == []
    assert any("Out of Service" in w for w in data["warnings"])


@pytest.mark.asyncio
async def test_out_of_order_goes_through_the_unavailability_rpc(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY", guest_name="Old")]})
    data = await _apply(monkeypatch, db, [_row("101", "OOO")])
    assert data["applied"] == 1
    assert [c[0] for c in db.rpc_calls] == ["create_room_unavailability"]
    assert db.rpc_calls[0][1]["p_source"] == "PMS" and db.rpc_calls[0][1]["p_tenant_id"] == HOTEL_A
    assert _status_of(db, "r1")["status"] == "OOO"
    assert len(db.rows["room_unavailability_periods"]) == 1
    assert _status_of(db, "r1")["guest_name"] is None  # baseline reset still applies


@pytest.mark.asyncio
async def test_room_already_ooo_is_protected_from_a_non_ooo_report_row(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")],
                    "room_status": [_status("r1", "OOO", notes="AC compressor failed")]})
    data = await _apply(monkeypatch, db, [_row("101", "DIRTY")])
    assert data["skipped_ooo"] == 1 and data["applied"] == 0
    assert _status_of(db, "r1")["status"] == "OOO" and _status_of(db, "r1")["notes"] == "AC compressor failed"


@pytest.mark.asyncio
async def test_ooo_report_row_for_room_already_ooo_creates_no_second_period(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "OOO", notes="keep")]})
    data = await _apply(monkeypatch, db, [_row("101", "OOO")])
    assert data["applied"] == 0 and db.rpc_calls == []
    assert _status_of(db, "r1")["notes"] == "keep"


# ---------------------------------------------------------------------------
# Apply: active cleaning, markers, late checkout
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_active_clean_session_protects_room_even_when_status_is_not_in_progress(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101"), _room("r2", "102")],
                    "room_status": [_status("r1", "DIRTY"), _status("r2", "IN_PROGRESS")],
                    "room_clean_sessions": [{"tenant_id": HOTEL_A, "room_id": "r1", "status": "active"}]})
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN"), _row("102", "CLEAN")])
    assert data["skipped_active"] == 2 and data["applied"] == 0
    assert _status_of(db, "r1")["status"] == "DIRTY" and _status_of(db, "r2")["status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_completed_clean_session_does_not_block_import(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")],
                    "room_clean_sessions": [{"tenant_id": HOTEL_A, "room_id": "r1", "status": "completed"}]})
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN")])
    assert data["applied"] == 1


@pytest.mark.asyncio
async def test_markers_are_cleared_only_for_rooms_that_were_baselined(monkeypatch):
    marker = {"tenant_id": HOTEL_A, "notes": "task_sheet_clean_type=DEP", "created_at": "2026-10-13T17:00:00+00:00"}
    db = RpcFakeDB({
        "rooms": [_room("r1", "101"), _room("r2", "102")],
        "room_status": [_status("r1", "DIRTY"), _status("r2", "IN_PROGRESS")],
        "room_status_history": [{**marker, "room_id": "r1"}, {**marker, "room_id": "r2"}],
    })
    await _apply(monkeypatch, db, [_row("101", "CLEAN"), _row("102", "CLEAN")])
    assert [h["room_id"] for h in db.rows["room_status_history"]] == ["r2"]


@pytest.mark.asyncio
async def test_markers_survive_when_nothing_is_baselined(monkeypatch):
    marker = {"tenant_id": HOTEL_A, "room_id": "r1", "notes": "stayover", "created_at": "2026-10-13T17:00:00+00:00"}
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "IN_PROGRESS")],
                    "room_status_history": [marker]})
    await _apply(monkeypatch, db, [_row("101", "CLEAN")])
    assert len(db.rows["room_status_history"]) == 1


@pytest.mark.asyncio
async def test_late_checkout_requests_cancelled_only_for_applied_rooms(monkeypatch):
    db = RpcFakeDB({
        "rooms": [_room("r1", "101"), _room("r2", "102")],
        "room_status": [_status("r1", "DIRTY"), _status("r2", "IN_PROGRESS")],
        "late_checkout_requests": [{"tenant_id": HOTEL_A, "room_id": "r1", "status": "pending"},
                                   {"tenant_id": HOTEL_A, "room_id": "r2", "status": "pending"}],
    })
    await _apply(monkeypatch, db, [_row("101", "CLEAN"), _row("102", "CLEAN")])
    states = {r["room_id"]: r["status"] for r in db.rows["late_checkout_requests"]}
    assert states == {"r1": "cancelled", "r2": "pending"}


# ---------------------------------------------------------------------------
# Documented baseline-reset contract
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_baseline_reset_contract_is_explicit_for_applied_rooms(monkeypatch):
    dirty_state = dict(guest_name="G", vip_flag=True, dnd_flag=True, do_not_service=True, notes="n",
                       assigned_to="hk-1", clean_type="DEP", checkout_time="2026-10-12T16:00:00+00:00",
                       checkin_time="2026-10-10T21:00:00+00:00", actual_checkout_at="2026-10-13T15:00:00+00:00")
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "OCCUPIED", **dirty_state)]})
    await _apply(monkeypatch, db, [_row("101", "DIRTY", fo="OCC")])
    state = _status_of(db, "r1")
    assert state["status"] == "OCCUPIED"
    for field, cleared in hk.HK_IMPORT_RESET_FIELDS.items():
        assert state[field] == cleared, field
    assert set(hk.HK_IMPORT_RESET_FIELDS) >= {"guest_name", "notes", "assigned_to", "clean_type"}


# ---------------------------------------------------------------------------
# Preview / apply agreement
# ---------------------------------------------------------------------------

def _mixed_db():
    return RpcFakeDB({
        "rooms": [_room("r1", "101"), _room("r2", "102"), _room("r3", "103"), _room("r4", "104"),
                  _room("r5", "105"), _room("r6", "106")],
        "room_status": [
            _status("r1", "DIRTY", guest_name="Old Guest"),
            _status("r2", "CLEAN"),
            _status("r3", "IN_PROGRESS"),
            _status("r4", "OOO"),
            _status("r5", "DIRTY"),
            _status("r6", "DIRTY"),
        ],
    })


MIXED_ROWS = lambda: [  # noqa: E731
    _row("101", "CLEAN"), _row("102", "CLEAN"), _row("103", "DIRTY"), _row("104", "DIRTY"),
    _row("105", "OOS"), _row("106", None, raw="Mystery"), _row("999", "DIRTY"),
]


@pytest.mark.asyncio
async def test_preview_and_apply_agree_on_every_count(monkeypatch):
    db = _mixed_db()
    preview = await _preview(monkeypatch, db, MIXED_ROWS())
    before = {r["room_id"]: dict(r) for r in db.rows["room_status"]}
    assert [r["status"] for r in db.rows["room_status"]] == ["DIRTY", "CLEAN", "IN_PROGRESS", "OOO", "DIRTY", "DIRTY"], "preview must not write"

    applied = await _apply(monkeypatch, db, MIXED_ROWS())
    for key in ("skipped_active", "skipped_ooo", "skipped_unsupported", "skipped_unrecognised", "not_found", "total_parsed"):
        assert preview[key] == applied[key], key
    # r1: guest reset is the only real change; r2 already matches; the rest are skipped.
    assert preview["will_update"] == 1 and preview["unchanged"] == 1
    assert [c["room_number"] for c in preview["field_resets"]] == ["101"]
    assert applied["applied"] == 2  # the baseline is written for every non-skipped room
    assert _status_of(db, "r1")["guest_name"] is None
    assert before["r3"] == _status_of(db, "r3") and before["r4"] == _status_of(db, "r4")


@pytest.mark.asyncio
async def test_preview_changes_match_values_written_by_apply(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101"), _room("r2", "102")],
                    "room_status": [_status("r1", "CLEAN", clean_type="DEP"), _status("r2", "INSPECTED")]})
    rows = [_row("101", "DIRTY", fo="OCC"), _row("102", "DIRTY")]
    preview = await _preview(monkeypatch, db, rows)
    await _apply(monkeypatch, db, rows)
    for change in preview["changes"]:
        state = _status_of(db, change["room_id"])
        for item in change["changes"]:
            assert state[item["field"]] == item["after"], (change["room_number"], item["field"])
    assert {c["room_number"] for c in preview["changes"]} == {"101", "102"}


@pytest.mark.asyncio
async def test_preview_reports_hidden_resets_so_apply_never_surprises(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")],
                    "room_status": [_status("r1", "DIRTY", guest_name="Old Guest", notes="note", assigned_to="hk-1")]})
    preview = await _preview(monkeypatch, db, [_row("101", "DIRTY")])
    assert preview["will_update"] == 1 and preview["changes"] == []
    assert preview["field_resets"] == [{"room_number": "101", "fields": ["assigned_to", "guest_name", "notes"]}]
    # Every field name the web modal renders is one it has a label for.
    assert all(i["field"] in hk.HK_IMPORT_PREVIEW_FIELDS for c in preview["changes"] for i in c["changes"])


@pytest.mark.asyncio
async def test_repeat_import_is_stable_and_second_preview_is_empty(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101"), _room("r2", "102")],
                    "room_status": [_status("r1", "CLEAN", guest_name="G"), _status("r2", "CLEAN")]})
    rows = [_row("101", "INSPECTED"), _row("102", "DIRTY", fo="OCC")]
    await _apply(monkeypatch, db, rows)
    first = [dict(r) for r in db.rows["room_status"]]
    again_preview = await _preview(monkeypatch, db, rows)
    assert again_preview["will_update"] == 0 and again_preview["changes"] == [] and again_preview["field_resets"] == []
    await _apply(monkeypatch, db, rows)
    assert [dict(r) for r in db.rows["room_status"]] == first  # incl. stay_reset_at not re-stamped


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_import_never_touches_another_tenants_room_with_the_same_number(monkeypatch):
    db = RpcFakeDB({
        "rooms": [_room("a1", "101", HOTEL_A), _room("b1", "101", HOTEL_B)],
        "room_status": [_status("a1", "DIRTY", HOTEL_A), _status("b1", "INSPECTED", HOTEL_B, guest_name="Other Hotel Guest")],
        "late_checkout_requests": [{"tenant_id": HOTEL_B, "room_id": "b1", "status": "pending"}],
        "room_clean_sessions": [{"tenant_id": HOTEL_B, "room_id": "b1", "status": "active"}],
    })
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN")])
    assert data["applied"] == 1
    assert _status_of(db, "a1")["status"] == "CLEAN"
    other = _status_of(db, "b1")
    assert other["status"] == "INSPECTED" and other["guest_name"] == "Other Hotel Guest"
    assert db.rows["late_checkout_requests"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_other_tenants_active_session_does_not_block_this_tenant(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("a1", "101", HOTEL_A)], "room_status": [_status("a1", "DIRTY", HOTEL_A)],
                    "room_clean_sessions": [{"tenant_id": HOTEL_B, "room_id": "a1", "status": "active"}]})
    assert (await _apply(monkeypatch, db, [_row("101", "CLEAN")]))["applied"] == 1


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["not-a-date", "2026-13-40", "", "2026-10-11", "2026-10-15"])
async def test_preview_and_apply_reject_the_same_bad_dates(monkeypatch, bad):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    for fn in (_preview, _apply):
        with pytest.raises(HTTPException) as exc:
            await fn(monkeypatch, db, [_row("101", "CLEAN")], date_str=bad)
        assert exc.value.status_code == 422
    assert _status_of(db, "r1")["status"] == "DIRTY"


@pytest.mark.asyncio
@pytest.mark.parametrize("ok", ["2026-10-12", "2026-10-13", "2026-10-14"])
async def test_dates_within_a_day_of_hotel_today_are_accepted_by_both(monkeypatch, ok):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    await _preview(monkeypatch, db, [_row("101", "CLEAN")], date_str=ok)
    await _apply(monkeypatch, db, [_row("101", "CLEAN")], date_str=ok)


@pytest.mark.asyncio
async def test_malformed_pdf_fails_safely_with_422_and_no_writes(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    monkeypatch.setattr(hk, "supabase", db)

    def boom(_pdf):
        raise ValueError("corrupt xref")

    monkeypatch.setattr(hk, "parse_hk_details", boom)
    for fn in (hk.import_hk_details, hk.preview_hk_details_import):
        with pytest.raises(HTTPException) as exc:
            await fn(file=_upload(), assignment_date=TODAY_STR, current_user=SUPERVISOR)
        assert exc.value.status_code == 422
    assert db.updates == [] and db.inserts == []


@pytest.mark.asyncio
async def test_non_pdf_and_empty_report_are_rejected(monkeypatch):
    db = RpcFakeDB({"rooms": [], "room_status": []})
    _install(monkeypatch, db, [])
    with pytest.raises(HTTPException) as exc:
        await hk.import_hk_details(file=UploadFile(filename="x.txt", file=io.BytesIO(b"a")),
                                   assignment_date=TODAY_STR, current_user=SUPERVISOR)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await hk.import_hk_details(file=_upload(), assignment_date=TODAY_STR, current_user=SUPERVISOR)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_conflicting_duplicate_room_rows_are_skipped_not_guessed(monkeypatch):
    db = RpcFakeDB({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN"), _row("101", "DIRTY")])
    assert data["applied"] == 0 and _status_of(db, "r1")["status"] == "DIRTY"
    assert any("more than once" in w for w in data["warnings"])


@pytest.mark.asyncio
async def test_failure_to_verify_active_sessions_fails_closed(monkeypatch):
    class BrokenSessions(RpcFakeDB):
        def table(self, name):
            if name == "room_clean_sessions":
                raise RuntimeError("db down")
            return super().table(name)

    db = BrokenSessions({"rooms": [_room("r1", "101")], "room_status": [_status("r1", "DIRTY")]})
    with pytest.raises(HTTPException) as exc:
        await _apply(monkeypatch, db, [_row("101", "CLEAN")])
    assert exc.value.status_code == 503
    assert _status_of(db, "r1")["status"] == "DIRTY"


@pytest.mark.asyncio
async def test_a_failed_room_write_is_reported_and_does_not_block_other_rooms(monkeypatch):
    class FlakyDB(RpcFakeDB):
        def table(self, name):
            q = super().table(name)
            if name == "room_status":
                original = q.upsert

                def upsert(payload, **kw):
                    if payload.get("room_id") == "r1":
                        raise RuntimeError("write failed")
                    return original(payload, **kw)

                q.upsert = upsert
            return q

    db = FlakyDB({"rooms": [_room("r1", "101"), _room("r2", "102")],
                  "room_status": [_status("r1", "DIRTY"), _status("r2", "DIRTY")]})
    data = await _apply(monkeypatch, db, [_row("101", "CLEAN"), _row("102", "CLEAN")])
    assert data["failed"] == 1 and data["applied"] == 1
    assert _status_of(db, "r1")["status"] == "DIRTY" and _status_of(db, "r2")["status"] == "CLEAN"
    assert any("Room 101" in w and "retry" in w for w in data["warnings"])
