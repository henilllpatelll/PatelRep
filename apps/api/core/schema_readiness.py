"""Fast, versioned database-schema readiness contract for deployment probes."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SchemaReadiness:
    ready: bool
    missing: list[str]


def check_schema_readiness(database: Any) -> SchemaReadiness:
    """Call the database-owned schema contract without exposing application data."""
    try:
        response = database.rpc("app_schema_readiness", {}).execute()
        payload = response.data if response else None
    except Exception:
        return SchemaReadiness(False, ["schema readiness RPC unavailable"])

    if not isinstance(payload, dict):
        return SchemaReadiness(False, ["schema readiness RPC returned an invalid response"])

    missing = payload.get("missing", [])
    if not isinstance(missing, list) or not all(isinstance(item, str) for item in missing):
        return SchemaReadiness(False, ["schema readiness RPC returned invalid missing contracts"])
    return SchemaReadiness(payload.get("ok") is True and not missing, missing)
