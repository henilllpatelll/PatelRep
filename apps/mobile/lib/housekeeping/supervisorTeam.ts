import type { ShiftRosterRowRaw } from "@/lib/api/housekeepingSupervisor";
import {
  buildNameById,
  buildTeamLoads,
  isActionable,
  type AssignableStaff,
  type FloorRoom,
  type TeamLoad,
} from "@/lib/housekeeping/supervisor";
import { fetchedAtOf, knownValue, type SourceState } from "@/lib/housekeeping/supervisorSources";

/* ─── Supervisor Today — staff availability & team pulse ────────────────────
   GET /shifts/roster (gm + housekeeping_supervisor only) returns the latest
   hk_shift_sessions row per person that STARTED a shift in the requested UTC day.
   That is the only attendance record there is: an assigned room does not prove a
   person is on shift, and a person missing from the roster is "not clocked in"
   only while the roster itself is verified — otherwise their state is unknown.
   (Hotels that never use clock-in will show everyone as not clocked in; that is
   a statement about the roster, not about who is working.) */

export type RosterAvailability = "on_shift" | "on_break" | "ended" | "unknown";

export interface RosterEntry {
  userId: string;
  availability: RosterAvailability;
  startedAt: string | null;
  onBreakSince: string | null;
}

/** A clock-in that has been "open" longer than this was almost certainly never closed out. */
export const MAX_PLAUSIBLE_OPEN_SHIFT_MS = 16 * 60 * 60_000;

/**
 * GET /shifts/roster rows → entries. Only recorded facts: `active` = on shift, `on_break` = on break,
 * `ended` = clocked out. An open shift older than `MAX_PLAUSIBLE_OPEN_SHIFT_MS` or any other status is `unknown`.
 */
export function normalizeRoster(rows: ShiftRosterRowRaw[], now: number): RosterEntry[] {
  const byUser = new Map<string, RosterEntry>();
  for (const row of rows) {
    const userId = row.user_id?.trim();
    if (!userId || byUser.has(userId)) continue;
    const startedMs = row.started_at ? Date.parse(row.started_at) : NaN;
    let availability: RosterAvailability;
    if (row.status === "ended") availability = "ended";
    else if (row.status === "active" || row.status === "on_break") {
      const implausible = Number.isNaN(startedMs) || now - startedMs > MAX_PLAUSIBLE_OPEN_SHIFT_MS;
      availability = implausible ? "unknown" : row.status === "active" ? "on_shift" : "on_break";
    } else availability = "unknown";
    byUser.set(userId, {
      userId,
      availability,
      startedAt: row.started_at ?? null,
      onBreakSince: row.on_break_since ?? null,
    });
  }
  return [...byUser.values()];
}

/* ─── Team pulse ──────────────────────────────────────────────────────────── */

/** `not_clocked_in` = the roster was read and has no shift for this person today. Never inferred from rooms. */
export type StaffAvailability = RosterAvailability | "not_clocked_in";
export type StaffConcern = "over_assigned" | "shift_ended_with_open_rooms";

export interface StaffPulseMember {
  userId: string;
  name: string | null;
  /** From the staff list; null when the person is only known from an assignment. */
  role: string | null;
  /** `unknown` whenever the roster is not available. */
  availability: StaffAvailability;
  load: TeamLoad | null;
  concern: StaffConcern | null;
}

export interface TeamPulse {
  /** Whether the shift counts below are verified now, last known, or not known at all. */
  roster: { status: "verified" | "stale" | "unknown"; fetchedAt: number | null };
  /** Clocked in and working. `null` = unknown (roster unavailable) — NOT zero. */
  onShift: number | null;
  onBreak: number | null;
  members: StaffPulseMember[];
  /** Raw per-person workloads from the board (assignment ≠ attendance). */
  workloads: TeamLoad[];
}

export function buildTeamPulse(
  rooms: FloorRoom[],
  staff: AssignableStaff[] | null,
  roster: SourceState<RosterEntry[]>,
  viewerId?: string | null,
): TeamPulse {
  const nameById = buildNameById(staff ?? []);
  const roleById = new Map((staff ?? []).map((member) => [member.userId, member.role]));
  const workloads = buildTeamLoads(rooms, nameById);
  const loadById = new Map(workloads.map((load) => [load.housekeeperId, load]));
  const entries = knownValue(roster, []);
  const entryById = new Map((entries ?? []).map((entry) => [entry.userId, entry]));
  const rosterStatus: TeamPulse["roster"]["status"] =
    roster.status === "available" || roster.status === "empty" ? "verified" : roster.status === "stale" ? "stale" : "unknown";

  const ids = new Set<string>([...(staff ?? []).map((member) => member.userId), ...loadById.keys()]);
  const members: StaffPulseMember[] = [...ids].map((userId) => {
    const load = loadById.get(userId) ?? null;
    const entry = entryById.get(userId);
    const availability: StaffAvailability = entries === null ? "unknown" : (entry?.availability ?? "not_clocked_in");
    const openRooms = load ? load.rooms.filter((room) => isActionable(room.status)).length : 0;
    let concern: StaffConcern | null = null;
    if (availability === "ended" && openRooms > 0) concern = "shift_ended_with_open_rooms";
    else if (load?.overAssigned) concern = "over_assigned";
    return { userId, name: nameById.get(userId) ?? null, role: roleById.get(userId) ?? null, availability, load, concern };
  });
  members.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~", undefined, { sensitivity: "base" }));

  const count = (availability: RosterAvailability) =>
    entries === null ? null : entries.filter((entry) => entry.availability === availability && entry.userId !== viewerId).length;
  return { roster: { status: rosterStatus, fetchedAt: fetchedAtOf(roster) }, onShift: count("on_shift"), onBreak: count("on_break"), members, workloads };
}

