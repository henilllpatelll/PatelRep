"""Runs only when pointed at the isolated Supabase stack started by the CI gate."""

import os

import pytest

from core.database import get_supabase
from core.schema_readiness import check_schema_readiness


pytestmark = pytest.mark.skipif(
    os.getenv("MIGRATED_DATABASE_TEST") != "1",
    reason="requires the isolated Supabase database created by the migration gate",
)


def test_api_database_contract_matches_the_migrated_schema():
    readiness = check_schema_readiness(get_supabase())
    assert readiness.ready, f"Missing required schema contract(s): {', '.join(readiness.missing)}"
