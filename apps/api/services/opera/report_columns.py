"""Column and report-type resolution for Opera Cloud scheduled-report ingestion.

Defaults below are grounded in two real "Delimited Data" exports pulled directly
from a live Opera Cloud property's report scheduler (not guessed):
  - "Reservation Detail" (internal report name `res_detail`) -> report_type "arrivals".
    ROOM_NO/DISP_ROOM_NO are blank until a room is assigned, so this report mostly
    feeds the opera_reservations cache, not room_status directly.
  - "Guests INH - By Room" (internal report name `gibyroom`) -> report_type "in_house".
    ROOM is always populated for in-house guests, so this is what actually drives
    room_status occupancy/checkin/checkout.
Both reports use ARRIVAL/DEPARTURE in MM-DD-YY format and are Tab-delimited.

Real header names are stable per report definition but vary by property/report
choice, so every mapping here is overridable per-hotel via
`opera_credentials.report_column_mapping` / `report_type_filename_patterns`.
"""

# Opera appends a numeric job-id suffix to the report's configured internal name
# when it delivers the file, e.g. "gibyroom_200160515.txt" -> match by prefix.
DEFAULT_FILENAME_PATTERNS: dict[str, str] = {
    "arrivals": "res_detail",
    "in_house": "gibyroom",
}

# report_type -> canonical_field -> real Opera header name.
DEFAULT_COLUMN_MAPPINGS: dict[str, dict[str, str]] = {
    "arrivals": {
        "room_number_opera": "ROOM_NO",
        "guest_name": "FULL_NAME",
        "vip_code": "VIP",
        "confirmation_no": "CONFIRMATION_NO",
        "opera_reservation_id": "RESV_NAME_ID",
        "arrival_date": "ARRIVAL",
        "departure_date": "DEPARTURE",
        "arrival_time": "ARRIVAL_TIME",
        "departure_time": "DEPARTURE_TIME",
        "adults": "ADULTS",
        "children": "CHILDREN",
        "special_requests": "SPECIAL_REQUESTS",
        "rate_code": "RATE_CODE",
        "guarantee_code": "GUARANTEE_CODE",
        "block_code": "BLOCK_CODE",
        "company_name": "COMPANY_NAME",
    },
    "in_house": {
        "room_number_opera": "ROOM",
        "guest_name": "FULL_NAME",
        "vip_code": "VIP",
        "opera_reservation_id": "RESV_NAME_ID",
        "arrival_date": "ARRIVAL",
        "departure_date": "DEPARTURE",
        "departure_time": "DEPARTURE_TIME",
        "adults": "ADULTS",
        "children": "CHILDREN",
        "special_requests": "SPECIAL_REQUESTS",
        "rate_code": "RATE_CODE",
        "block_code": "BLOCK_CODE",
        "company_name": "COMPANY_NAME",
    },
}

# A completed record always has this many aggregate/"totals" marker cells in the
# Opera-appended trailer mini-table (e.g. "LOGO\tSUM_ADULTS\t..."). Confirmed on
# both real samples: the trailer header row contains the literal cell "LOGO" and
# at least one cell prefixed "SUM_".
TRAILER_MARKER_CELL = "LOGO"
TRAILER_SUM_PREFIX = "SUM_"


def normalize_header(raw: str) -> str:
    """Lowercase/strip for tolerant header matching against overrides."""
    return raw.strip().lower().replace(" ", "_")


def resolve_report_type(filename: str, patterns_override: dict | None) -> str | None:
    """Match a delivered filename to a report_type by internal-report-name prefix."""
    patterns = dict(DEFAULT_FILENAME_PATTERNS)
    if patterns_override:
        patterns.update(patterns_override)

    lowered = filename.lower()
    for report_type, prefix in patterns.items():
        if lowered.startswith(prefix.lower()):
            return report_type
    return None


def build_header_index(headers: list[str], report_type: str, mapping_override: dict | None) -> dict[int, str]:
    """Map column index -> canonical field name for the given report type.

    Override wins per-field over the default mapping. Real Opera headers are
    exact strings (no case/whitespace variance observed), but matching is
    tolerant via normalize_header() in case a hotel's export differs slightly.
    Unmatched columns are simply omitted, not fatal.
    """
    mapping = dict(DEFAULT_COLUMN_MAPPINGS.get(report_type, {}))
    if mapping_override:
        mapping.update(mapping_override)

    # canonical_field -> normalized target header
    target_by_field = {field: normalize_header(header) for field, header in mapping.items()}
    normalized_headers = {normalize_header(h): idx for idx, h in enumerate(headers)}

    index: dict[int, str] = {}
    for field, target in target_by_field.items():
        idx = normalized_headers.get(target)
        if idx is not None:
            index[idx] = field
    return index


def is_trailer_row(cells: list[str]) -> bool:
    """Detect the Opera-appended totals/trailer mini-table that follows every export."""
    if TRAILER_MARKER_CELL not in cells:
        return False
    return any(cell.startswith(TRAILER_SUM_PREFIX) for cell in cells)
