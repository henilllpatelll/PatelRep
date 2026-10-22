"""
Move inspection photos recorded before migration 220 out of the PUBLIC ``work-order-photos`` bucket.

Until then an inspection photo was stored publicly and referenced by ``inspection_results.photo_url``. The API already
refuses to hand those URLs to clients (it signs the object instead), but the objects themselves stay reachable by anyone
who holds the old link until they are copied into the private ``inspection-evidence`` bucket and removed from the public one.

Default mode is DRY-RUN (reads only, reports what it would do). It is an operator tool: it is never run by CI, a deploy
or the API, and it must be run deliberately, after migration 220 is applied.

  python apps/api/scripts/backfill_inspection_evidence.py                       # dry run
  python apps/api/scripts/backfill_inspection_evidence.py --apply               # copy + point rows at the private copy
  python apps/api/scripts/backfill_inspection_evidence.py --apply --remove-legacy-objects
                                                                                # ...and delete the public originals

Safe to repeat: rows that already have ``photo_path`` are skipped, a copy is an upsert, and the public original is only
removed after the private copy was written and the row updated. A row whose URL does not point at this hotel's folder for
this inspection is reported and left alone. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. No path is printed.
"""
import argparse
import os
import sys
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.inspection_evidence import LEGACY_BUCKET, PRIVATE_BUCKET, evidence_location  # noqa: E402

BATCH = 200


def backfill(client: Any, *, apply: bool = False, remove_legacy: bool = False) -> dict:
    """Walk every legacy-photo result in batches. Returns counters; never raises for one bad row."""
    counts = {"seen": 0, "copied": 0, "skipped_foreign_path": 0, "failed": 0, "removed": 0}
    last_id = None
    while True:
        query = (
            client.table("inspection_results")
            .select("id, tenant_id, inspection_id, photo_url, photo_path")
            .not_.is_("photo_url", "null")
            .is_("photo_path", "null")
            .order("id")
            .limit(BATCH)
        )
        if last_id:
            query = query.gt("id", last_id)
        rows = query.execute().data or []
        if not rows:
            return counts
        for row in rows:
            last_id = row["id"]
            counts["seen"] += 1
            location = evidence_location({"photo_url": row["photo_url"]}, row["tenant_id"], row["inspection_id"])
            if location is None or location[0] != LEGACY_BUCKET:
                counts["skipped_foreign_path"] += 1
                continue
            if not apply:
                counts["copied"] += 1
                continue
            path = location[1]
            try:
                data = client.storage.from_(LEGACY_BUCKET).download(path)
                client.storage.from_(PRIVATE_BUCKET).upload(path, data, {"upsert": "true"})
                client.table("inspection_results").update({"photo_path": path, "photo_url": None}).eq("id", row["id"]).eq(
                    "tenant_id", row["tenant_id"]
                ).execute()
                counts["copied"] += 1
                if remove_legacy:
                    client.storage.from_(LEGACY_BUCKET).remove([path])
                    counts["removed"] += 1
            except Exception:  # noqa: BLE001 - one unreadable object must not stop the rest
                counts["failed"] += 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    parser.add_argument("--remove-legacy-objects", action="store_true", help="with --apply: delete the public original after a successful copy")
    args = parser.parse_args()
    if args.remove_legacy_objects and not args.apply:
        parser.error("--remove-legacy-objects only makes sense with --apply")
    from core.database import supabase

    counts = backfill(supabase, apply=args.apply, remove_legacy=args.remove_legacy_objects)
    mode = "APPLIED" if args.apply else "DRY RUN"
    print(f"[{mode}] " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
