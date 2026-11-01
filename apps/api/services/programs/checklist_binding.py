"""Which checklist procedure a PM schedule uses, and whether it can be used right now.

A schedule is bound to ONE template row (`pm_schedules.checklist_template_id`) plus that template's `code`, which is kept
if the row is later removed. Nothing here ever picks a template for a schedule: an unconfigured (legacy) schedule stays
`unassigned` until a manager binds it, and a bound schedule whose template cannot be used reports why instead of
substituting another one.
"""

from __future__ import annotations

from typing import Any

# unassigned: never configured (legacy)        ready: bound and usable
# missing:    bound, template row is gone       inactive: bound, template was retired
# incompatible: bound to a non-engineering template (cannot happen through the API; guards imported data)
CHECKLIST_STATES = ("unassigned", "ready", "missing", "inactive", "incompatible")
ENGINEERING_AREA = "engineering"


def _summary(state: str, schedule: dict[str, Any], template: dict[str, Any] | None, replacement: dict[str, Any] | None = None) -> dict[str, Any]:
    source = template or {}
    return {
        "state": state,
        "template_id": schedule.get("checklist_template_id"),
        "template_code": source.get("code") or schedule.get("checklist_template_code"),
        "template_name": source.get("name"),
        "template_version": source.get("version"),
        "replacement_template_id": replacement["id"] if replacement else None,
    }


def resolve_checklist(
    schedule: dict[str, Any],
    templates_by_id: dict[str, dict[str, Any]],
    active_by_code: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    template_id = schedule.get("checklist_template_id")
    code = schedule.get("checklist_template_code")
    if not template_id and not code:
        return _summary("unassigned", schedule, None)
    template = templates_by_id.get(str(template_id)) if template_id else None
    if template is None:
        return _summary("missing", schedule, None, active_by_code.get(code) if code else None)
    if template.get("program_area") != ENGINEERING_AREA:
        return _summary("incompatible", schedule, template)
    if not template.get("is_active"):
        replacement = active_by_code.get(template.get("code"))
        return _summary("inactive", schedule, template, replacement if replacement and replacement["id"] != template["id"] else None)
    return _summary("ready", schedule, template)


def load_resolutions(db: Any, tenant_id: str, schedules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Resolve every schedule with two bounded reads, however many schedules there are."""
    ids = sorted({str(s["checklist_template_id"]) for s in schedules if s.get("checklist_template_id")})
    codes = {s["checklist_template_code"] for s in schedules if s.get("checklist_template_code")}
    templates_by_id: dict[str, dict[str, Any]] = {}
    if ids:
        rows = db.table("pm_checklist_templates").select("id, code, name, version, program_area, is_active").eq(
            "tenant_id", tenant_id
        ).in_("id", ids).execute().data or []
        templates_by_id = {str(row["id"]): row for row in rows}
        codes |= {row["code"] for row in rows if row.get("code")}
    active_by_code: dict[str, dict[str, Any]] = {}
    if codes:
        rows = db.table("pm_checklist_templates").select("id, code, version").eq("tenant_id", tenant_id).eq(
            "program_area", ENGINEERING_AREA
        ).eq("is_active", True).in_("code", sorted(codes)).execute().data or []
        for row in rows:
            best = active_by_code.get(row["code"])
            if best is None or (row.get("version") or 0) > (best.get("version") or 0):
                active_by_code[row["code"]] = row
    return {str(s["id"]): resolve_checklist(s, templates_by_id, active_by_code) for s in schedules}


def load_assignable_template(db: Any, tenant_id: str, template_id: str) -> dict[str, Any]:
    """The template a manager may bind: this property's, engineering, active. ValueError otherwise."""
    result = db.table("pm_checklist_templates").select("id, code, name, version, program_area, is_active").eq(
        "id", template_id
    ).eq("tenant_id", tenant_id).maybe_single().execute()
    template = result.data if result else None
    if not template:
        raise LookupError("Checklist template not found")
    if template.get("program_area") != ENGINEERING_AREA:
        raise ValueError("Only engineering checklist templates can be used for a PM schedule")
    if not template.get("is_active"):
        raise ValueError("This checklist template is inactive")
    return template


def resolve_completion_template(
    db: Any, tenant_id: str, schedule: dict[str, Any], requested_template_id: str | None
) -> dict[str, Any] | None:
    """The template a completion is recorded against, or None when the technician used none.

    A bound schedule always completes against its own procedure (or a newer/older revision of the SAME code); the
    request cannot point it at an unrelated checklist, and an unusable bound template refuses the completion rather
    than letting it be recorded against nothing. An unbound (legacy) schedule accepts any engineering template of this
    property, as before.
    """
    bound_id, bound_code = schedule.get("checklist_template_id"), schedule.get("checklist_template_code")
    requested = None
    if requested_template_id:
        result = db.table("pm_checklist_templates").select("id, code, name, version, program_area, is_active").eq(
            "id", requested_template_id
        ).eq("tenant_id", tenant_id).maybe_single().execute()
        requested = result.data if result else None
        if not requested:
            raise ValueError("Checklist template not found at this property")
        if requested.get("program_area") != ENGINEERING_AREA:
            raise ValueError("Only engineering checklist templates can be completed for a PM schedule")
    if not bound_id and not bound_code:
        return requested
    resolution = load_resolutions(db, tenant_id, [schedule])[str(schedule["id"])]
    if resolution["state"] == "ready" and requested is None:
        return db.table("pm_checklist_templates").select("id, code, name, version, program_area, is_active").eq(
            "id", resolution["template_id"]
        ).eq("tenant_id", tenant_id).maybe_single().execute().data
    if requested is None:
        raise PmChecklistUnavailable(resolution)
    if requested.get("code") != resolution["template_code"]:
        raise ValueError("This PM schedule uses a different checklist than the one submitted")
    if not requested.get("is_active"):
        raise PmChecklistUnavailable(resolution)
    return requested


class PmChecklistUnavailable(Exception):
    """The schedule is bound to a checklist that cannot be used (missing, inactive or incompatible)."""

    def __init__(self, resolution: dict[str, Any]):
        super().__init__(f"PM checklist unavailable: {resolution['state']}")
        self.resolution = resolution
