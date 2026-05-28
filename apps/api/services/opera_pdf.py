"""Opera PDF parsers for HK Details and Task Sheet housekeeping reports."""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

import pdfplumber

@dataclass
class HKDetailsRow:
    room_number: str
    raw_status: str
    our_status: str
    fo_status: Optional[str]       # "OCC", "VAC", or None
    reservation_status: str

@dataclass
class TaskSheetRow:
    room_number: str
    fo_status: Optional[str]       # "OCC", "VAC", or None
    reservation_status: str
    guest_name: str
    clean_type: Optional[str]      # "DEP", "FULL", "LIGHT", or None

_HK_STATUS_MAP: dict[str, str] = {
    "dirty":          "DIRTY",
    "inspected":      "INSPECTED",
    "clean":          "OOO",
    "pickup":         "PICKUP",
    "out of order":   "OOO",
    "out of service": "OOS",
}


def _normalize_task(raw: str) -> Optional[str]:
    r = raw.strip().upper()
    if r.startswith("DEP"):   return "DEP"
    if r.startswith("FULL"):  return "FULL"
    if r.startswith("LIGHT"): return "LIGHT"
    return None


def _is_room_number(s: str) -> bool:
    s = s.strip()
    if not s or len(s) > 6:
        return False
    return s.isdigit() or (len(s) >= 2 and s[:-1].isdigit() and s[-1].isalpha())


def _group_words_into_lines(words: list[dict], y_tol: float = 4.0) -> list[list[dict]]:
    if not words:
        return []
    sw = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: list[list[dict]] = []
    cur: list[dict] = [sw[0]]
    for w in sw[1:]:
        if abs(w["top"] - cur[0]["top"]) <= y_tol:
            cur.append(w)
        else:
            lines.append(cur)
            cur = [w]
    lines.append(cur)
    return lines


# ---------------------------------------------------------------------------
# HK Details parser
#
# Actual column x-ratios measured from Opera PDF (page width 594pt):
#   Room No  : xr < 0.08           (~9pt,  room numbers like "101")
#   Type     : 0.08 – 0.17  skip   (~54pt, type codes like "S1K")
#   Status   : 0.17 – 0.53         (~121pt, "Dirty"/"Inspected"/"Clean")
#   FO Status: 0.53 – 0.67         (~341pt, "OCC"/"VAC")
#   Res Status: >= 0.67             (~413pt, "Stayover"/"Due Out"/etc.)
# ---------------------------------------------------------------------------

def parse_hk_details(pdf_bytes: bytes) -> tuple[list[HKDetailsRow], list[str]]:
    rows: list[HKDetailsRow] = []
    warnings: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            W = page.width
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            lines = _group_words_into_lines(words)
            pending: Optional[HKDetailsRow] = None

            for line in lines:
                room_parts: list[str] = []
                status_parts: list[str] = []
                fo_parts: list[str] = []
                res_parts: list[str] = []

                for w in line:
                    t = w["text"].strip()
                    if not t:
                        continue
                    xr = w["x0"] / W
                    if xr < 0.08:
                        room_parts.append(t)
                    elif xr < 0.17:
                        pass  # room type code — skip
                    elif xr < 0.53:
                        status_parts.append(t)
                    elif xr < 0.67:
                        if t.upper() in ("OCC", "VAC"):
                            fo_parts.append(t.upper())
                        else:
                            res_parts.append(t)
                    else:
                        res_parts.append(t)

                room_no    = " ".join(room_parts).strip()
                raw_status = " ".join(status_parts).strip()
                fo_text    = fo_parts[0] if fo_parts else None
                res_text   = " ".join(res_parts).strip()

                # Continuation line for "Due Out" rooms (second line is task code)
                if pending is not None:
                    if not _is_room_number(room_no):
                        task = _normalize_task(res_text) if res_text else None
                        if task:
                            pending.reservation_status = (
                                f"{pending.reservation_status} {res_text}".strip()
                            )
                        rows.append(pending)
                        pending = None
                        continue
                    else:
                        rows.append(pending)
                        pending = None

                if not _is_room_number(room_no):
                    continue

                raw_lower  = raw_status.lower().strip()
                our_status = _HK_STATUS_MAP.get(raw_lower, raw_lower.upper())

                row = HKDetailsRow(
                    room_number=room_no,
                    raw_status=raw_status,
                    our_status=our_status,
                    fo_status=fo_text,
                    reservation_status=res_text,
                )

                if res_text.lower().strip() == "due out":
                    pending = row
                else:
                    rows.append(row)

            if pending:
                rows.append(pending)
                pending = None

    return rows, warnings


# ---------------------------------------------------------------------------
# Task Sheet parser
#
# Actual column x-ratios measured from Opera PDF (page width 792pt):
#   Room No    : xr < 0.09          (~45pt,  "101")
#   Rm Status  : 0.09 – 0.16  skip  (~117pt, always "DI")
#   FO Status  : 0.16 – 0.22        (~171pt, "OCC"/"VAC")
#   Res Status : 0.22 – 0.44        (~232pt, "Due Out"/"Stayover")
#   Name       : 0.44 – 0.635       (~472pt, guest surname/first)
#   Tasks      : >= 0.635            (~643pt, "DEP(Linen Change)" etc.)
# ---------------------------------------------------------------------------

def parse_task_sheet(pdf_bytes: bytes) -> tuple[list[TaskSheetRow], list[str]]:
    rows: list[TaskSheetRow] = []
    warnings: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            W = page.width
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            lines = _group_words_into_lines(words)

            for line in lines:
                room_parts: list[str] = []
                fo_parts:   list[str] = []
                res_parts:  list[str] = []
                name_parts: list[str] = []
                task_parts: list[str] = []

                for w in line:
                    t = w["text"].strip()
                    if not t:
                        continue
                    xr = w["x0"] / W
                    if xr < 0.09:
                        room_parts.append(t)
                    elif xr < 0.16:
                        pass  # room status (always DI) — skip
                    elif xr < 0.22:
                        if t.upper() in ("OCC", "VAC"):
                            fo_parts.append(t.upper())
                        else:
                            res_parts.append(t)
                    elif xr < 0.44:
                        res_parts.append(t)
                    elif xr < 0.635:
                        name_parts.append(t)
                    else:
                        task_parts.append(t)

                room_no  = " ".join(room_parts).strip()
                fo_text  = fo_parts[0] if fo_parts else None
                res_text = " ".join(res_parts).strip()
                name     = " ".join(name_parts).strip()
                task_raw = " ".join(task_parts).strip()

                if not _is_room_number(room_no):
                    continue

                clean_type = _normalize_task(task_raw) if task_raw else None
                if task_raw and clean_type is None:
                    warnings.append(f"Room {room_no}: unrecognised task '{task_raw}'")

                rows.append(TaskSheetRow(
                    room_number=room_no,
                    fo_status=fo_text,
                    reservation_status=res_text,
                    guest_name=name,
                    clean_type=clean_type,
                ))

    return rows, warnings
