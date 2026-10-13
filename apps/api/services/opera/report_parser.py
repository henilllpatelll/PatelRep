"""Parser for Opera Cloud "Delimited Data" scheduled-report exports.

Two real exports pulled from a live Opera Cloud property's report scheduler
("Reservation Detail" / res_detail, and "Guests INH - By Room" / gibyroom)
both showed the same two quirks, so this parser handles them generically
rather than per-report:

1. Some free-text fields (e.g. BILL_TO_ADDRESS, COMPANY_NAME) contain raw,
   unescaped embedded newlines with no quoting at all, splitting one logical
   record across 2-3 physical lines. A naive line-by-line reader shreds these.
   We reassemble by accumulating physical lines until the running delimiter
   count reaches ~70% of the header's delimiter count -- a relative threshold
   because real complete rows can legitimately be *shorter* than the header
   (Opera drops trailing all-blank columns), so an absolute/full-count match
   would never fire on those rows.
2. Every export ends with a distinct totals/trailer mini-table (its own
   header + one data row) glued on after the real data, detectable by a row
   containing the literal cell "LOGO" plus a cell prefixed "SUM_". Parsing
   stops there rather than erroring on the column-count mismatch.
"""
from __future__ import annotations

from dataclasses import dataclass

from services.opera.report_columns import is_trailer_row

CONTINUATION_RATIO_THRESHOLD = 0.7


def _pad(cells: list[str], length: int) -> list[str]:
    if len(cells) < length:
        return cells + [""] * (length - len(cells))
    return cells[:length]


@dataclass
class ParsedReport:
    """Structured result of parsing a Delimited Data export.

    ``rows`` holds only records that reached the expected width. A final record
    that never did (a truncated or half-written file) is surfaced separately as
    ``incomplete_tail`` so callers can refuse to call the file fully processed.
    """
    headers: list[str]
    rows: list[list[str]]
    incomplete_tail: list[str] | None = None
    trailer_seen: bool = False
    has_binary_content: bool = False


def parse_delimited_report_detailed(raw_bytes: bytes, delimiter: str = "\t") -> ParsedReport:
    """Decode and reassemble a Delimited Data export, reporting structural problems."""
    if b"\x00" in raw_bytes:
        # NUL bytes mean binary or UTF-16 content, not a Delimited Data text export.
        return ParsedReport(headers=[], rows=[], has_binary_content=True)

    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    lines = text.splitlines()

    headers: list[str] | None = None
    body: list[str] = []
    for line in lines:
        if headers is None:
            if line.strip() == "":
                continue
            headers = line.split(delimiter)
            continue
        body.append(line)

    if headers is None:
        return ParsedReport(headers=[], rows=[])

    header_len = len(headers)
    rows: list[list[str]] = []
    buffer = ""
    trailer_seen = False

    for line in body:
        if is_trailer_row(line.split(delimiter)):
            buffer = ""
            trailer_seen = True
            break

        if line.strip() == "" and not buffer:
            continue

        candidate = line if not buffer else f"{buffer} {line}"
        cells = candidate.split(delimiter)
        ratio = (len(cells) - 1) / max(header_len - 1, 1)

        if ratio >= CONTINUATION_RATIO_THRESHOLD:
            rows.append(_pad(cells, header_len))
            buffer = ""
        else:
            buffer = candidate

    incomplete_tail: list[str] | None = None
    if buffer.strip():
        cells = buffer.split(delimiter)
        if not is_trailer_row(cells):
            incomplete_tail = _pad(cells, header_len)

    return ParsedReport(
        headers=headers, rows=rows, incomplete_tail=incomplete_tail, trailer_seen=trailer_seen,
    )


def parse_delimited_report(raw_bytes: bytes, delimiter: str = "\t") -> tuple[list[str], list[list[str]]]:
    """Decode and reassemble a Delimited Data export into (headers, rows).

    Tolerant of a malformed file: returns whatever was parsed before any
    unrecoverable structural break rather than raising (an incomplete final
    record is included, padded). Ingestion uses parse_delimited_report_detailed
    so it can tell a clean file from a damaged one.
    """
    parsed = parse_delimited_report_detailed(raw_bytes, delimiter)
    rows = list(parsed.rows)
    if parsed.incomplete_tail is not None:
        rows.append(parsed.incomplete_tail)
    return parsed.headers, rows


def map_row(cells: list[str], header_index: dict[int, str]) -> dict:
    """Project a parsed row through a column index into canonical fields."""
    mapped: dict = {}
    for idx, field in header_index.items():
        if idx >= len(cells):
            continue
        value = cells[idx].strip()
        mapped[field] = value or None
    return mapped
