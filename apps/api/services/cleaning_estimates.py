"""Hotel-level cleaning-time estimates learned from the hotel's own completed clean sessions.

Deterministic and model-free: no external AI call, no per-person output. The question it answers is
"how long does a <room type> <clean type> usually take at THIS hotel?" — and it answers it only when
that history demonstrably predicts later cleans better than the hotel's existing baseline does.

Method (kept deliberately small — see apps/mobile/docs/AI-HOUSEKEEPER.md "Cleaning-time estimates"):

1. Only trustworthy sessions count (`valid_sessions`): completed, consistent timestamps, not truncated at
   the server's duration cap, not interrupted by a DND/guest/maintenance blocker, something actually
   ticked, no overlap with another session of the same housekeeper, no duplicate.
2. Per (room type code, clean type) the typical time is the MEDIAN of the sessions after a MAD trim, then
   shrunk toward the baseline: (n*median + K*baseline) / (n + K). Few samples stay close to the baseline.
3. A chronological hold-out decides whether the history is used at all: train on the older 70%, predict
   the newest 30%, and keep the learned figure only if it beats the baseline's mean absolute error by a
   margin. Otherwise nothing is returned and callers keep the baseline.

Nothing here reorders rooms, sets deadlines or ranks people.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import median
from typing import Any, Iterable, Optional

KNOWN_CLEAN_TYPES = ("DEP", "FULL", "LIGHT")
# The mobile app's general fallback when a room type has no baseline (kept in step with briefing.ts).
GENERAL_DEFAULT_MINUTES = {"DEP": 30, "FULL": 25, "LIGHT": 15}
GENERAL_FALLBACK_MINUTES = 25

MIN_SESSION_MINUTES = 3.0
# The server clamps a session to this many minutes; a clamped row is a forgotten session, not a clean.
SESSION_CAP_MINUTES = 240
DURATION_TOLERANCE_SECONDS = 5

MIN_VALID_PER_GROUP = 20
MIN_HOLDOUT = 6
TRAIN_FRACTION = 0.7
SHRINK_K = 6
REQUIRED_IMPROVEMENT = 0.95  # model MAE must be <= 95% of the baseline MAE
MAD_LIMIT = 4.0
MIN_ESTIMATE_RATIO, MAX_ESTIMATE_RATIO = 0.4, 2.5
MIN_ESTIMATE_MINUTES = 5


def baseline_minutes(base_clean_minutes: Optional[int], clean_type: str) -> int:
    """What the app shows today when it has no history: the room type's own figure, else a general one."""
    if isinstance(base_clean_minutes, (int, float)) and base_clean_minutes > 0:
        return int(base_clean_minutes)
    return GENERAL_DEFAULT_MINUTES.get(clean_type, GENERAL_FALLBACK_MINUTES)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class CleanObservation:
    session_id: str
    room_id: str
    housekeeper_id: str
    clean_type: str
    started_at: datetime
    ended_at: datetime
    minutes: float


def valid_sessions(rows: Iterable[dict]) -> list[CleanObservation]:
    """Reduce raw `room_clean_sessions` rows to observations that are safe to learn from."""
    seen_ids: set[str] = set()
    seen_starts: set[tuple[str, datetime]] = set()
    kept: list[CleanObservation] = []
    for row in rows:
        session_id = str(row.get("id") or "")
        if not session_id or session_id in seen_ids:
            continue
        if row.get("status") != "completed" or row.get("blocked_reason"):
            continue
        clean_type = row.get("clean_type")
        if clean_type not in KNOWN_CLEAN_TYPES:
            continue
        started, ended = _parse(row.get("started_at")), _parse(row.get("ended_at"))
        duration = row.get("duration_seconds")
        if started is None or ended is None or ended <= started or not isinstance(duration, (int, float)):
            continue
        # The stored duration must agree with the stored timestamps (a clamped client clock does not).
        if abs((ended - started).total_seconds() - duration) > DURATION_TOLERANCE_SECONDS:
            continue
        minutes = duration / 60
        if minutes < MIN_SESSION_MINUTES or minutes >= SESSION_CAP_MINUTES:
            continue
        if (row.get("checklist_total") or 0) > 0 and (row.get("checklist_done") or 0) == 0:
            continue
        room_id, housekeeper_id = str(row.get("room_id") or ""), str(row.get("housekeeper_id") or "")
        if not room_id or (room_id, started) in seen_starts:
            continue
        seen_ids.add(session_id)
        seen_starts.add((room_id, started))
        kept.append(CleanObservation(session_id, room_id, housekeeper_id, clean_type, started, ended, minutes))
    return _drop_overlaps(kept)


def _drop_overlaps(observations: list[CleanObservation]) -> list[CleanObservation]:
    """A person cannot clean two rooms at once: if their sessions overlap, neither duration is trusted."""
    by_person: dict[str, list[CleanObservation]] = {}
    for item in observations:
        by_person.setdefault(item.housekeeper_id, []).append(item)
    bad: set[str] = set()
    for items in by_person.values():
        items.sort(key=lambda o: o.started_at)
        latest: Optional[CleanObservation] = None
        for item in items:
            if latest is not None and item.started_at < latest.ended_at:
                bad.update((item.session_id, latest.session_id))
            if latest is None or item.ended_at > latest.ended_at:
                latest = item
    return [o for o in observations if o.session_id not in bad]


def trim_outliers(values: list[float]) -> list[float]:
    """Drop values far from the median (MAD rule). Leaves small or uniform samples alone."""
    if len(values) < 5:
        return values
    mid = median(values)
    mad = median(abs(v - mid) for v in values)
    if mad == 0:
        return values
    limit = MAD_LIMIT * 1.4826 * mad
    return [v for v in values if abs(v - mid) <= limit]


def shrunk_estimate(values: list[float], baseline: float) -> int:
    """Median pulled toward the baseline in proportion to how little evidence there is, then bounded."""
    n = len(values)
    blended = (n * median(values) + SHRINK_K * baseline) / (n + SHRINK_K)
    bounded = min(max(blended, baseline * MIN_ESTIMATE_RATIO, MIN_ESTIMATE_MINUTES), baseline * MAX_ESTIMATE_RATIO)
    return int(round(bounded))


@dataclass(frozen=True)
class GroupEstimate:
    room_type_code: str
    clean_type: str
    minutes: int
    sample_count: int
    holdout_count: int
    baseline_mae: float
    model_mae: float


def _mae(predicted: float, actual: Iterable[float]) -> float:
    values = list(actual)
    return sum(abs(predicted - v) for v in values) / len(values)


def evaluate_group(
    observations: list[CleanObservation], baseline: float, room_type_code: str, clean_type: str
) -> Optional[GroupEstimate]:
    """Return a learned estimate only when it beat the baseline on the newest cleans, else None."""
    ordered = sorted(observations, key=lambda o: o.started_at)
    if len(ordered) < MIN_VALID_PER_GROUP:
        return None
    split = int(len(ordered) * TRAIN_FRACTION)
    train, test = ordered[:split], ordered[split:]
    if len(test) < MIN_HOLDOUT:
        return None
    train_values = trim_outliers([o.minutes for o in train])
    if not train_values:
        return None
    test_minutes = [o.minutes for o in test]
    baseline_mae = _mae(baseline, test_minutes)
    model_mae = _mae(shrunk_estimate(train_values, baseline), test_minutes)
    if model_mae > baseline_mae * REQUIRED_IMPROVEMENT:
        return None
    all_values = trim_outliers([o.minutes for o in ordered])
    return GroupEstimate(
        room_type_code=room_type_code,
        clean_type=clean_type,
        minutes=shrunk_estimate(all_values, baseline),
        sample_count=len(all_values),
        holdout_count=len(test),
        baseline_mae=round(baseline_mae, 2),
        model_mae=round(model_mae, 2),
    )


def build_estimates(session_rows: Iterable[dict], rooms: Iterable[dict]) -> list[GroupEstimate]:
    """`rooms` rows: {id, room_types: {code, base_clean_minutes}}. Every number comes from this hotel's rows."""
    room_type: dict[str, dict] = {}
    for room in rooms:
        info = room.get("room_types") or {}
        if room.get("id") and info.get("code"):
            room_type[str(room["id"])] = info
    groups: dict[tuple[str, str], list[CleanObservation]] = {}
    for obs in valid_sessions(session_rows):
        info = room_type.get(obs.room_id)
        if info:
            groups.setdefault((str(info["code"]), obs.clean_type), []).append(obs)
    estimates: list[GroupEstimate] = []
    for (code, clean_type), items in sorted(groups.items()):
        base = next(
            (room_type[o.room_id].get("base_clean_minutes") for o in items if room_type.get(o.room_id)), None
        )
        result = evaluate_group(items, baseline_minutes(base, clean_type), code, clean_type)
        if result is not None:
            estimates.append(result)
    return estimates
