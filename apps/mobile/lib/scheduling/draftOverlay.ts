import type { Revision } from "@/lib/api/schedulingRevisions";
import type { TeamSchedule, TeamShift } from "@/lib/api/schedulingTeam";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";

/* ─── Drawing a pending draft over the published schedule ───────────────────
   The preview is a VIEW, never data: it returns a new schedule and leaves the published one untouched, and every shift it
   adds or alters carries a `proposal` marker so no card can present it as real, confirmed work. Attendance and "who is
   working" are never read from a preview. Employees have no way to reach any of this (the draft is manager-only on the
   server), and nothing here is sent anywhere. */

const inRange = (schedule: TeamSchedule, workDate: string) => workDate >= schedule.dateFrom && workDate <= schedule.dateTo;

export function applyDraftOverlay(schedule: TeamSchedule, drafts: readonly Revision[] | null | undefined): TeamSchedule {
  const changes = (drafts ?? []).flatMap((draft) => draft.changes ?? []);
  if (changes.length === 0) return schedule;
  const byAssignment = new Map<string, (typeof changes)[number]>();
  for (const change of changes) if (change.assignmentId) byAssignment.set(change.assignmentId, change);

  const shifts: TeamShift[] = [];
  for (const shift of schedule.shifts) {
    const change = byAssignment.get(shift.id);
    if (!change) {
      shifts.push(shift);
    } else if (change.kind === "cancel") {
      shifts.push({ ...shift, proposal: { kind: "cancelled", changeId: change.id } });
    } else if (change.proposed && inRange(schedule, change.proposed.workDate)) {
      const p = change.proposed;
      shifts.push({
        ...shift, userId: p.userId, shiftId: p.shiftId || shift.shiftId, workDate: p.workDate, name: p.shiftName ?? shift.name,
        startTime: p.startTime, endTime: p.endTime, startsAt: p.startsAt, endsAt: p.endsAt, notes: p.notes, status: null,
        proposal: { kind: "changed", changeId: change.id },
      });
    }
    // an edit that moves the shift out of the loaded range simply leaves it; the week it moves to shows it
  }
  for (const change of changes) {
    if (change.kind === "create" && change.proposed && inRange(schedule, change.proposed.workDate)) {
      const p = change.proposed;
      shifts.push({
        id: `draft:${change.id}`, userId: p.userId, shiftId: p.shiftId, workDate: p.workDate, name: p.shiftName, departmentId: p.departmentId,
        startTime: p.startTime, endTime: p.endTime, startsAt: p.startsAt, endsAt: p.endsAt, publication: "draft", notes: p.notes,
        carriedFromPreviousDay: false, status: null, version: 0, proposal: { kind: "new", changeId: change.id },
      });
    } else if (change.kind === "update" && change.assignmentId && change.proposed && inRange(schedule, change.proposed.workDate)
      && !schedule.shifts.some((shift) => shift.id === change.assignmentId)) {
      const p = change.proposed; // moved INTO this range from another week
      shifts.push({
        id: change.assignmentId, userId: p.userId, shiftId: p.shiftId, workDate: p.workDate, name: p.shiftName, departmentId: p.departmentId,
        startTime: p.startTime, endTime: p.endTime, startsAt: p.startsAt, endsAt: p.endsAt, publication: "draft", notes: p.notes,
        carriedFromPreviousDay: false, status: null, version: change.baseVersion ?? 1, proposal: { kind: "changed", changeId: change.id },
      });
    }
  }
  const scheduled = new Set(shifts.map((shift) => shift.userId));
  return { ...schedule, shifts, people: schedule.people.map((person) => (scheduled.has(person.userId) && !person.scheduled ? { ...person, scheduled: true } : person)) };
}

/** The same loading/stale/failed state with the preview drawn on whatever data it holds. */
export function overlaySource(state: SourceState<TeamSchedule>, drafts: readonly Revision[] | null | undefined): SourceState<TeamSchedule> {
  if (state.status === "available") return { ...state, data: applyDraftOverlay(state.data, drafts) };
  if (state.status === "stale" && state.data) return { ...state, data: applyDraftOverlay(state.data, drafts) };
  return state;
}

export interface DraftCounts {
  total: number;
  created: number;
  changed: number;
  cancelled: number;
}

export function countDraft(drafts: readonly Revision[] | null | undefined): DraftCounts {
  const changes = (drafts ?? []).flatMap((draft) => draft.changes ?? []);
  return {
    total: changes.length,
    created: changes.filter((change) => change.kind === "create").length,
    changed: changes.filter((change) => change.kind === "update").length,
    cancelled: changes.filter((change) => change.kind === "cancel").length,
  };
}
