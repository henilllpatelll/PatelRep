"""
Enum drift guard: ensures Python work-order status/priority constants stay in sync
with schema/work_order_enums.json (the canonical schema contract).

This test MUST fail if either the JSON or the Python constants are changed without
updating the other. Adding a value to one without adding it to the other causes a CI
failure that surfaces the inconsistency before it reaches production.
"""

import json
from pathlib import Path

from services.work_orders.transitions import WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES

_CONTRACT = Path(__file__).parents[4] / "schema" / "work_order_enums.json"


def test_status_constants_match_json_contract():
    contract = json.loads(_CONTRACT.read_text())
    assert sorted(WORK_ORDER_STATUSES) == sorted(contract["statuses"]), (
        f"Python WORK_ORDER_STATUSES {sorted(WORK_ORDER_STATUSES)!r} "
        f"differs from schema/work_order_enums.json {sorted(contract['statuses'])!r}. "
        "Update both files together."
    )


def test_priority_constants_match_json_contract():
    contract = json.loads(_CONTRACT.read_text())
    assert sorted(WORK_ORDER_PRIORITIES) == sorted(contract["priorities"]), (
        f"Python WORK_ORDER_PRIORITIES {sorted(WORK_ORDER_PRIORITIES)!r} "
        f"differs from schema/work_order_enums.json {sorted(contract['priorities'])!r}. "
        "Update both files together."
    )
