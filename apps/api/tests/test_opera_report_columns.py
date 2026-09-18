"""Unit tests for services/opera/report_columns.py.

Default mappings/filename patterns are grounded in two real Opera Cloud
"Delimited Data" exports (Reservation Detail / res_detail, Guests INH - By
Room / gibyroom) -- see report_columns.py's module docstring.
"""
from services.opera.report_columns import (
    build_header_index,
    is_trailer_row,
    normalize_header,
    resolve_report_type,
)


def test_normalize_header_lowercases_and_strips():
    assert normalize_header(" ROOM_NO ") == "room_no"
    assert normalize_header("Full Name") == "full_name"


def test_resolve_report_type_matches_by_filename_prefix():
    # Opera appends a numeric job-id suffix to the configured report name.
    assert resolve_report_type("res_detail_200158991.txt", None) == "arrivals"
    assert resolve_report_type("gibyroom_200160515.txt", None) == "in_house"


def test_resolve_report_type_unknown_returns_none():
    assert resolve_report_type("hkroomstatusbytype_200160575.txt", None) is None


def test_resolve_report_type_override_wins():
    override = {"in_house": "my_custom_report_name"}
    assert resolve_report_type("my_custom_report_name_12345.txt", override) == "in_house"
    # Overriding "in_house" replaces its pattern entirely -- the old default
    # prefix no longer matches once the hotel has redefined it.
    assert resolve_report_type("gibyroom_1.txt", override) is None
    # An unrelated report_type's default is untouched by the override.
    assert resolve_report_type("res_detail_1.txt", override) == "arrivals"


def test_build_header_index_default_mapping():
    headers = ["ROOM", "VIP", "ARRIVAL", "DEPARTURE", "FULL_NAME", "UNRELATED_COL"]
    index = build_header_index(headers, "in_house", None)
    assert index[0] == "room_number_opera"
    assert index[2] == "arrival_date"
    assert index[3] == "departure_date"
    assert index[4] == "guest_name"
    assert 5 not in index  # unmatched columns are simply omitted


def test_build_header_index_override_wins_over_default():
    headers = ["ROOM", "ROOM_NUMBER_CUSTOM"]
    override = {"room_number_opera": "ROOM_NUMBER_CUSTOM"}
    index = build_header_index(headers, "in_house", override)
    assert index == {1: "room_number_opera"}


def test_is_trailer_row_detects_logo_and_sum_marker():
    assert is_trailer_row(["LOGO", "SUM_ADULTS", "SUM_CHILDREN"]) is True
    assert is_trailer_row(["RMS_REPORT", "LOGO", "SUM_ADULTS", "SUM_ROOMS"]) is True


def test_is_trailer_row_false_for_normal_data_row():
    assert is_trailer_row(["101", "Y", "09-14-26", "09-19-26", "Smith,John"]) is False
