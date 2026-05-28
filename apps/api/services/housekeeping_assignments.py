"""Shared housekeeping assignment helpers."""


def room_status_for_clean_type(clean_type: str | None, fo_status: str | None = None) -> str:
    """Map Opera clean task codes to PatelRep room status."""
    if clean_type in {"FULL", "LIGHT"}:
        return "PICKUP"
    if clean_type == "DEP" and fo_status == "OCC":
        return "OCCUPIED"
    return "DIRTY"


def effective_room_status(
    status: str | None,
    clean_type: str | None,
    fo_status: str | None = None,
) -> str | None:
    """Return the room status users should see for an active assignment."""
    if status not in {"DIRTY", "PICKUP"} or not clean_type:
        return status
    return room_status_for_clean_type(clean_type, fo_status)
