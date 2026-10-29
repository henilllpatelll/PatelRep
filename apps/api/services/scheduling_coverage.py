"""Pure rules for call-outs and shift coverage (no database access; routers/scheduling_coverage*.py do the I/O).

Everything here decides from values it is handed, so it is unit-testable and never guesses:
  * which absence kinds exist and what each needs,
  * whether a workflow transition is allowed (checked against services/scheduling_contracts.WORKFLOWS, the one
    vocabulary every phase shares -- there is no second state machine),
  * whether a person is a sensible replacement, with the REASONS spelled out so the supervisor decides,
  * whether an offer is still live.

Availability and approved leave come from services/scheduling_availability.py (Phase 5). Approved time off is a hard
blocker; submitted availability is only evidence (outside it = a warning to acknowledge); a person who submitted nothing
stays `unknown`. Nobody is ever called "available" just because they have no shift.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from services.scheduling import Occurrence, compute_warnings, find_conflicts
from services.scheduling_availability import Assessment
from services.scheduling_contracts import GM, MANAGER, SELF, SYSTEM, WORKFLOWS

ABSENCE_KINDS = ("called_out", "unavailable", "leaving_early", "emergency", "other")
OFFER_TTL = timedelta(hours=2)          # a pending offer lapses unless the shift starts sooner
MAX_OFFER_TTL = timedelta(hours=24)
IN_FLIGHT_GAP = ("open", "offered")


def actor_kind(is_manager: bool, is_self: bool = False) -> set[str]:
    kinds = set()
    if is_manager:
        kinds |= {MANAGER, GM}
    if is_self:
        kinds.add(SELF)
    return kinds


def transition_error(workflow: str, current: str, target: str, actors: set[str], reason: Optional[str] = None) -> Optional[str]:
    """None when `current -> target` is allowed for `actors` (and has its reason if one is required); else a short code."""
    options = {t.to: t for t in WORKFLOWS[workflow].transitions.get(current, ())}
    step = options.get(target)
    if step is None:
        return "invalid_transition"
    if not (step.actors & (actors | ({SYSTEM} if SYSTEM in actors else set()))):
        return "not_permitted"
    if step.requires_reason and not (reason or "").strip():
        return "reason_required"
    return None


def offer_expiry(now: datetime, starts_at: datetime, requested_minutes: Optional[int] = None) -> datetime:
    """When a pending offer lapses: the requested window (capped at 24h), never later than the shift's start."""
    window = OFFER_TTL if requested_minutes is None else min(timedelta(minutes=requested_minutes), MAX_OFFER_TTL)
    return min(now + window, starts_at)


def offer_is_live(offer: dict, now: datetime) -> bool:
    if offer.get("status") != "pending":
        return False
    expires = _ts(offer.get("expires_at"))
    return expires is None or expires > now


def effective_offer_status(offer: dict, now: datetime) -> str:
    """A pending offer past its expiry reads as `expired` even before anything has written that down."""
    if offer.get("status") == "pending" and not offer_is_live(offer, now):
        return "expired"
    return str(offer.get("status"))


def gap_is_actionable(gap: dict, now: datetime) -> Optional[str]:
    """None while the gap can still be worked; otherwise why not."""
    if gap.get("status") not in IN_FLIGHT_GAP:
        return f"gap_{gap.get('status')}"
    ends = _ts(gap.get("ends_at"))
    if ends is not None and ends <= now:
        return "shift_ended"
    return None


def _ts(value) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Replacement candidates
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    user_id: str
    roles: tuple[str, ...]
    eligible: bool = True
    blockers: list[str] = field(default_factory=list)     # why the person cannot take it (eligible = False)
    warnings: list[str] = field(default_factory=list)     # allowed, but the supervisor should know
    reasons: list[str] = field(default_factory=list)      # why the person qualifies
    existing_shifts: list[dict] = field(default_factory=list)
    availability: str = "unknown"                         # available | outside | unavailable | unknown; never invented here
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "user_id": self.user_id, "roles": list(self.roles), "eligible": self.eligible,
            "blockers": self.blockers, "warnings": self.warnings, "reasons": self.reasons,
            "existing_shifts": self.existing_shifts, "availability": self.availability, "detail": self.detail,
        }


def evaluate_candidate(
    *,
    user_id: str,
    roles: tuple[str, ...],
    department_id: Optional[str],
    gap_department_id: str,
    required_role: Optional[str],
    gap: Occurrence,
    stored: Iterable[Occurrence],
    stored_rows: Iterable[dict],
    other_pending_offers: Iterable[Occurrence],
    clocked_in_elsewhere: Optional[bool],
    hotel_today: date,
    is_absent_employee: bool = False,
    assessment: Optional[Assessment] = None,
) -> Candidate:
    """
    Deterministic checks, in order. A blocker makes the person ineligible; a warning leaves them selectable.
    `stored` are the person's non-cancelled shifts around the gap; `other_pending_offers` are windows they have already
    been asked to cover. `clocked_in_elsewhere` is None when attendance could not be read (reported as a warning, never
    silently treated as fine). `assessment` is the person's availability / approved-leave verdict for the gap's window;
    None means it could not be read, which is reported as unknown (never as available).
    """
    cand = Candidate(user_id=user_id, roles=roles)
    stored = list(stored)
    if is_absent_employee:
        # Their own (called-out) shift overlaps the gap by definition; the one reason that matters is that they are out.
        cand.blockers.append("is_absent_employee")
        cand.eligible = False
        cand.existing_shifts = [_brief(r) for r in stored_rows]
        return cand
    if department_id is None:
        cand.warnings.append("department_unknown")
    elif department_id != gap_department_id:
        cand.blockers.append("other_department")
    if required_role and required_role not in roles:
        cand.blockers.append("role_mismatch")

    candidate_occ = Occurrence(user_id, gap.shift_id, gap.work_date, gap.starts_at, gap.ends_at)
    conflicts = find_conflicts([candidate_occ], stored)
    if conflicts:
        cand.blockers.append("overlapping_shift")
    if any(o.starts_at < gap.ends_at and o.ends_at > gap.starts_at for o in other_pending_offers):
        cand.warnings.append("pending_offer_elsewhere")
    if clocked_in_elsewhere is True:
        cand.warnings.append("currently_clocked_in")
    elif clocked_in_elsewhere is None:
        cand.warnings.append("attendance_unverified")

    for w in compute_warnings([candidate_occ], stored, hotel_today=hotel_today):
        if w.severity == "block":
            cand.blockers.append(w.code)
        elif w.code in ("insufficient_rest", "weekly_overtime", "long_shift"):
            cand.warnings.append(w.code)

    if assessment is None:
        cand.availability = "unknown"
        cand.warnings.append("availability_unknown")
    else:
        cand.availability = assessment.status
        cand.blockers.extend(b for b in assessment.blockers if b not in cand.blockers)
        cand.warnings.extend(w for w in assessment.warnings if w not in cand.warnings)
        cand.reasons.extend(assessment.reasons)
        cand.detail = {"availability": assessment.detail, "leave": assessment.leave}
    cand.eligible = not cand.blockers
    if cand.eligible:
        cand.reasons.insert(0, "eligible_by_schedule")
    cand.existing_shifts = [_brief(r) for r in stored_rows]
    return cand


def _brief(r: dict) -> dict:
    return {"id": r.get("id"), "work_date": str(r.get("work_date"))[:10], "shift_name": r.get("shift_name"),
            "start_time": r.get("start_time"), "end_time": r.get("end_time")}


def sort_candidates(items: list[Candidate], names: dict[str, str]) -> list[Candidate]:
    """
    Eligible and inside their submitted availability first; then eligible with no availability on file; then eligible with
    warnings; then ineligible. Alphabetical inside each tier, so the order is deterministic and explainable.
    """
    def tier(c: Candidate) -> int:
        if not c.eligible:
            return 3
        if [w for w in c.warnings if w != "availability_unknown"]:
            return 2
        return 0 if c.availability == "available" else 1
    return sorted(items, key=lambda c: (tier(c), (names.get(c.user_id) or "~").casefold()))
