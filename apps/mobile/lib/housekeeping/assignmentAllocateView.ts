import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { AllocationMode, AllocationProposal } from "@/lib/housekeeping/assignmentAllocator";
import { attendanceAckFor, contextFor, loadView, type AttendanceAck, type LoadView } from "@/lib/housekeeping/assignmentPicker";
import type { Attendance, AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import { projectPersonLoad, type WorkloadWarning } from "@/lib/housekeeping/assignmentWorkload";
import { floorKeyOf } from "@/lib/housekeeping/roomBoardFilters";

/* ─── Supervisor Assignments — what the allocation drawer shows ──────────────
   Pure. For the rooms a supervisor selected, one row per listed housekeeper: their attendance, their published
   workload, what it would be, and how close the rooms are to where they already work. Nothing here ranks people
   or picks one: the supervisor chooses, and the allocator only spreads work between the people chosen.

   Honesty rules (the same as the single-room picker): attendance comes only from the verified roster, so a failed
   roster makes everybody `unknown` (never "available"); a missing estimate makes a figure "at least", never zero;
   a "high load" tag needs a real capacity warning. */

export interface AllocateCandidate {
  userId: string;
  name: string | null;
  attendance: Attendance;
  rosterVerified: boolean;
  /** The acknowledgement choosing this person will need at the review, or null when they are verified on shift. */
  attendanceAck: AttendanceAck | null;
  current: LoadView;
  /** Their load if they took ALL the selected rooms (what "one housekeeper" would mean for them). */
  ifAll: LoadView;
  /** A real overload warning before or after taking all of them. */
  highLoad: boolean;
  newWarnings: WorkloadWarning[];
  /** How many selected rooms are on a floor (or in a building) they already work. */
  nearbyRooms: number;
  /** Selected rooms that have no recorded floor or building: closeness is unknown for them. */
  roomsTotal: number;
}

const OVERLOAD: readonly WorkloadWarning[] = ["over_credit_target", "exceeds_shift_time", "exceeds_full_day"];

function nearby(member: AssignmentTeamMember, floors: ReadonlySet<string>, rooms: readonly AssignmentRoom[]): number {
  return rooms.filter((entry) => (entry.room.floorKnown && floors.has(floorKeyOf(entry.room))) || (entry.room.building !== null && member.buildings.includes(entry.room.building))).length;
}

/** The housekeepers a supervisor can choose between for `rooms`, in the verified staff list's order (name). */
export function buildAllocateCandidates(model: AssignmentsModel, rooms: readonly AssignmentRoom[]): AllocateCandidate[] {
  if (!model.rooms || !model.team) return [];
  const all = model.rooms.map((entry) => entry.room);
  const floorsOf = new Map<string, Set<string>>();
  for (const entry of model.rooms) {
    const owner = entry.ownership.userId;
    if (!owner) continue;
    if (entry.room.floorKnown) floorsOf.set(owner, (floorsOf.get(owner) ?? new Set()).add(floorKeyOf(entry.room)));
  }
  return model.team
    .filter((member) => member.listed)
    .map<AllocateCandidate>((member) => {
      const after = projectPersonLoad(member.userId, all, { add: rooms.map((entry) => entry.room) }, contextFor(model, member));
      const warnings = [...member.load.warnings, ...after.warnings];
      return {
        userId: member.userId,
        name: member.name,
        attendance: member.attendance,
        rosterVerified: member.rosterVerified,
        attendanceAck: attendanceAckFor(member.attendance),
        current: loadView(member.load),
        ifAll: loadView(after),
        highLoad: warnings.some((warning) => OVERLOAD.includes(warning)),
        newWarnings: after.warnings.filter((warning) => !member.load.warnings.includes(warning)),
        nearbyRooms: nearby(member, floorsOf.get(member.userId) ?? new Set(), rooms),
        roomsTotal: rooms.length,
      };
    })
    .sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));
}

/* ─── The proposal, as the drawer previews it ─────────────────────────────── */

export interface ProposalShare {
  userId: string;
  name: string | null;
  rooms: number;
  /** Their load before and after the proposed rooms. */
  before: LoadView;
  after: LoadView;
  roomNumbers: string[];
}

export interface ProposalPreview {
  shares: ProposalShare[];
  /** Rooms in the proposal with no estimate. */
  missingEstimates: number;
  unresolved: number;
  unallocated: number;
}

export function previewProposal(model: AssignmentsModel, rooms: readonly AssignmentRoom[], proposal: AllocationProposal): ProposalPreview | null {
  if (!model.rooms || !model.team) return null;
  const all = model.rooms.map((entry) => entry.room);
  const byId = new Map(rooms.map((entry) => [entry.room.roomId, entry] as const));
  const shares: ProposalShare[] = [];
  for (const share of proposal.shares) {
    const member = model.team.find((candidate) => candidate.userId === share.userId);
    if (!member) continue;
    const add = share.roomIds.map((id) => byId.get(id)?.room).filter((room): room is NonNullable<typeof room> => room !== undefined);
    shares.push({
      userId: member.userId,
      name: member.name,
      rooms: add.length,
      before: loadView(member.load),
      after: loadView(projectPersonLoad(member.userId, all, { add }, contextFor(model, member))),
      roomNumbers: add.map((room) => room.roomNumber),
    });
  }
  return { shares, missingEstimates: proposal.missingEstimates, unresolved: proposal.unresolved.length, unallocated: proposal.unallocated.length };
}

/** Whether the drawer may offer "Review changes" for this choice, and what is missing if not. */
export type AllocateReadiness = "ready" | "no_rooms" | "no_employee" | "one_employee_needed" | "unresolved";

export function allocateReadiness(mode: AllocationMode, employeeIds: readonly string[], validRooms: number, candidates: readonly AllocateCandidate[]): AllocateReadiness {
  if (validRooms === 0) return "no_rooms";
  if (employeeIds.length === 0) return mode === "single" ? "one_employee_needed" : "no_employee";
  if (mode === "single" && employeeIds.length !== 1) return "one_employee_needed";
  return employeeIds.every((id) => candidates.some((candidate) => candidate.userId === id)) ? "ready" : "unresolved";
}
