"""Where inspection evidence lives and how a client is allowed to see it.

New evidence is written to the PRIVATE ``inspection-evidence`` bucket and recorded as an object path
(``inspection_results.photo_path``). Evidence recorded before migration 224 only has ``photo_url``, a public URL into
the legacy ``work-order-photos`` bucket. Either way a client never receives a stored URL: it receives a short-lived
signed URL, minted here only after the caller has already been checked against the hotel and the inspection.

Nothing in this module logs an object path: a path contains the hotel, inspection and checklist-item ids.
"""

import logging
import re
from typing import Any, Optional
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

PRIVATE_BUCKET = "inspection-evidence"
LEGACY_BUCKET = "work-order-photos"
#: Long enough to open a record and look at a few photos, short enough that a leaked link is useless soon after.
SIGNED_URL_TTL_SECONDS = 600
#: A record is a checklist, not an album: never sign more than this many photos for one read.
MAX_SIGNED_PER_READ = 60

_LEGACY_URL = re.compile(r"/object/(?:public|sign|authenticated)/" + re.escape(LEGACY_BUCKET) + r"/(?P<path>.+)$")


def sniff_image_type(data: bytes) -> Optional[str]:
    """The image type the BYTES say they are (jpeg/png/webp), never the client's claim; None for anything else."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def evidence_prefix(hotel_id: str, inspection_id: str) -> str:
    return f"{hotel_id}/inspections/{inspection_id}/"


def evidence_path(hotel_id: str, inspection_id: str, item_id: str, extension: str) -> str:
    return f"{evidence_prefix(hotel_id, inspection_id)}{item_id}.{extension}"


def _path_is_inside(path: str, hotel_id: str, inspection_id: str) -> bool:
    """The object must sit under THIS hotel's folder for THIS inspection, with no way to climb out of it."""
    if not path.startswith(evidence_prefix(hotel_id, inspection_id)):
        return False
    return ".." not in path.split("/") and "\\" not in path


def evidence_location(row: dict, hotel_id: str, inspection_id: str) -> Optional[tuple[str, str]]:
    """``(bucket, object path)`` for one stored result, or None when there is none or it is not this hotel's.

    A stored path that points outside ``<hotel>/inspections/<inspection>/`` is refused outright: that is the guard
    against a row (or a forged value) naming another hotel's object.
    """
    path = (row.get("photo_path") or "").strip()
    if path:
        return (PRIVATE_BUCKET, path) if _path_is_inside(path, hotel_id, inspection_id) else None
    url = (row.get("photo_url") or "").strip()
    if not url:
        return None
    match = _LEGACY_URL.search(urlparse(url).path)
    if not match:
        return None
    legacy = unquote(match.group("path"))
    return (LEGACY_BUCKET, legacy) if _path_is_inside(legacy, hotel_id, inspection_id) else None


def has_evidence(row: dict) -> bool:
    return bool((row.get("photo_path") or "").strip() or (row.get("photo_url") or "").strip())


def sign_location(client: Any, location: tuple[str, str], ttl: int = SIGNED_URL_TTL_SECONDS) -> Optional[str]:
    bucket, path = location
    try:
        signed = client.storage.from_(bucket).create_signed_url(path, ttl)
    except Exception:  # noqa: BLE001 - a missing or unreadable object is "unavailable", never an error for the record
        logger.warning("Inspection evidence could not be signed (bucket %s)", bucket)
        return None
    if not isinstance(signed, dict):
        return None
    url = signed.get("signedURL") or signed.get("signedUrl")
    return url if isinstance(url, str) and url.startswith("http") else None


def sign_many(client: Any, locations: dict[str, tuple[str, str]], ttl: int = SIGNED_URL_TTL_SECONDS) -> dict[str, Optional[str]]:
    """``{key: signed url | None}``; anything past ``MAX_SIGNED_PER_READ`` is left unsigned rather than slowing the read."""
    signed: dict[str, Optional[str]] = {}
    for index, (key, location) in enumerate(locations.items()):
        signed[key] = sign_location(client, location, ttl) if index < MAX_SIGNED_PER_READ else None
    return signed
