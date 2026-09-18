"""Unit tests for services/opera/report_parser.py.

Fixtures are synthetic but mirror the exact structural quirks confirmed from
two real Opera Cloud "Delimited Data" exports: (1) a free-text field can
contain a raw embedded newline splitting one record across physical lines,
(2) real rows can legitimately be shorter than the header (Opera drops
all-blank trailing columns), and (3) every export ends with a "LOGO"/"SUM_"
totals mini-table that must be recognized and ignored.
"""
from services.opera.report_parser import map_row, parse_delimited_report

HEADERS = "ROOM\tVIP\tARRIVAL\tDEPARTURE\tCOMPANY_NAME\tGUEST_NAME\tADULTS\tCHILDREN\tEXTRA_COL"


def _sample_bytes() -> bytes:
    lines = [
        HEADERS,
        # Row A: complete, single physical line.
        "101\tN\t09-14-26\t09-19-26\tAcme Corp\tSmith,John\t1\t0\tfoo",
        # Row B: COMPANY_NAME wraps a raw embedded newline across 2 physical lines.
        "102\tN\t09-15-26\t09-19-26\tC- Partner",
        "T- Full Partner Name\tCarter,Charles\t1\t0\tbar",
        # Row C: legitimately short (EXTRA_COL blank/omitted at the end).
        "103\tN\t09-16-26\t09-20-26\tSolo Corp\tJones,Amy\t1\t0",
        "",
        # Trailer/totals mini-table -- must stop here, not be parsed as data.
        "LOGO\tSUM_ADULTS\tSUM_CHILDREN",
        "\t2\t0",
        "",
    ]
    return "\n".join(lines).encode("utf-8")


def test_parses_complete_row():
    headers, rows = parse_delimited_report(_sample_bytes(), delimiter="\t")
    assert headers == HEADERS.split("\t")
    assert rows[0] == ["101", "N", "09-14-26", "09-19-26", "Acme Corp", "Smith,John", "1", "0", "foo"]


def test_reassembles_multiline_wrapped_field():
    _, rows = parse_delimited_report(_sample_bytes(), delimiter="\t")
    row_b = rows[1]
    assert row_b[0] == "102"
    assert row_b[4] == "C- Partner T- Full Partner Name"
    assert row_b[5] == "Carter,Charles"
    assert row_b[8] == "bar"


def test_pads_legitimately_short_row_without_treating_it_as_continuation():
    _, rows = parse_delimited_report(_sample_bytes(), delimiter="\t")
    row_c = rows[2]
    assert row_c[0] == "103"
    assert row_c[7] == "0"
    assert row_c[8] == ""  # EXTRA_COL padded, not merged with the trailer


def test_stops_at_trailer_and_does_not_emit_it_as_data():
    _, rows = parse_delimited_report(_sample_bytes(), delimiter="\t")
    assert len(rows) == 3
    for row in rows:
        assert "LOGO" not in row


def test_tolerates_malformed_trailing_line_without_raising():
    raw = (HEADERS + "\n101\tN\t09-14-26\n102\tincomplete").encode("utf-8")
    headers, rows = parse_delimited_report(raw, delimiter="\t")
    assert headers == HEADERS.split("\t")
    # Both malformed lines still surface as padded rows rather than raising.
    assert len(rows) >= 1


def test_handles_bom_and_latin1_fallback():
    bom_bytes = "﻿" + HEADERS + "\n101\tN\t09-14-26\t09-19-26\tAcme\tSmith\t1\t0\tfoo"
    headers, rows = parse_delimited_report(bom_bytes.encode("utf-8"), delimiter="\t")
    assert headers[0] == "ROOM"  # BOM stripped, not prefixed onto the first header

    latin1_bytes = (HEADERS + "\n101\tN\t09-14-26\t09-19-26\tCaf\xe9\tSmith\t1\t0\tfoo").encode("latin-1")
    headers2, rows2 = parse_delimited_report(latin1_bytes, delimiter="\t")
    assert rows2[0][4] == "Café"


def test_comma_delimiter():
    csv_bytes = b"ROOM,VIP,ARRIVAL\n101,N,09-14-26"
    headers, rows = parse_delimited_report(csv_bytes, delimiter=",")
    assert headers == ["ROOM", "VIP", "ARRIVAL"]
    assert rows == [["101", "N", "09-14-26"]]


def test_map_row_projects_canonical_fields_and_blanks_to_none():
    header_index = {0: "room_number_opera", 5: "guest_name", 8: "notes"}
    cells = ["101", "N", "09-14-26", "09-19-26", "Acme Corp", "Smith,John", "1", "0", ""]
    mapped = map_row(cells, header_index)
    assert mapped == {"room_number_opera": "101", "guest_name": "Smith,John", "notes": None}
