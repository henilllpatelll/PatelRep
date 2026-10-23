/* ─── Smart Balance — planning preferences ──────────────────────────────────
   Pure. The property already stores ten assignment preferences (Settings → Housekeeping). Smart Balance reads them as
   DEFAULTS for one planning run; the supervisor's temporary choices in the setup drawer are never written back.

   HARD RULES vs PREFERENCES — what a toggle can and cannot do
     A toggle only changes how the optimizer WEIGHS things (workload balance, urgency, closeness, stability).
     No toggle can switch off: the hotel/tenant checks, protection of work already started or finished, owner
     verification, soft-block exclusion (DND, declined, return-later, discrepancy) or the capacity limits. Those live in
     the pool/eligibility code and in the server, and have no setting.

   STAFF POLICY — two stored preferences decide who may RECEIVE rooms, on top of one rule that has no setting:
     verified `on_shift`            may receive
     `on_break`                     excluded while "avoid on-break staff" is on (the default)
     shift ended / not clocked in   excluded while "exclude off-shift staff" is on (the default)
     attendance `unknown`           NEVER receives rooms: it is not evidence of availability, whatever is stored
   (A person the property lets through despite those two rules still needs the attendance acknowledgement at the
   review, exactly as in the single-room flow.) "Exclude unavailable staff" has no separate meaning here: unlisted,
   non-housekeeping and unknown-attendance people are always excluded. */

export interface PropertyAssignmentPreferences {
  prioritizeGuestWaiting: boolean;
  prioritizeRush: boolean;
  prioritizeEarliestArrival: boolean;
  balanceWorkload: boolean;
  minimizeReassignment: boolean;
  avoidOnBreak: boolean;
  excludeOffShift: boolean;
  excludeUnavailable: boolean;
  preferSameBuilding: boolean;
  preferSameFloor: boolean;
}

/** What the server uses for a property that stored nothing. Used only when the real settings could not be read. */
export const DEFAULT_PROPERTY_PREFERENCES: PropertyAssignmentPreferences = {
  prioritizeGuestWaiting: true,
  prioritizeRush: true,
  prioritizeEarliestArrival: true,
  balanceWorkload: true,
  minimizeReassignment: true,
  avoidOnBreak: true,
  excludeOffShift: true,
  excludeUnavailable: true,
  preferSameBuilding: true,
  preferSameFloor: true,
};

const WIRE_KEYS: Record<keyof PropertyAssignmentPreferences, string> = {
  prioritizeGuestWaiting: "prioritize_guest_waiting",
  prioritizeRush: "prioritize_rush",
  prioritizeEarliestArrival: "prioritize_earliest_arrival",
  balanceWorkload: "balance_workload",
  minimizeReassignment: "minimize_reassignment",
  avoidOnBreak: "avoid_on_break",
  excludeOffShift: "exclude_off_shift",
  excludeUnavailable: "exclude_unavailable",
  preferSameBuilding: "prefer_same_building",
  preferSameFloor: "prefer_same_floor",
};

/**
 * GET /hotels/{id}/housekeeping-settings → `data.assignment_preferences`. Strict: every preference must be a boolean
 * (the server fills defaults for anything unset), otherwise this throws and the caller says it is using defaults.
 */
export function parseAssignmentPreferences(payload: unknown): PropertyAssignmentPreferences {
  const raw = (payload as { data?: { assignment_preferences?: unknown } } | null | undefined)?.data?.assignment_preferences;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Malformed assignment preferences response");
  const record = raw as Record<string, unknown>;
  const parsed = {} as PropertyAssignmentPreferences;
  for (const [key, wire] of Object.entries(WIRE_KEYS) as [keyof PropertyAssignmentPreferences, string][]) {
    if (typeof record[wire] !== "boolean") throw new Error("Malformed assignment preferences response");
    parsed[key] = record[wire] as boolean;
  }
  return parsed;
}

/** The four choices the setup drawer shows. */
export interface SmartToggles {
  balanceWorkload: boolean;
  prioritizeDeadlines: boolean;
  preferNearby: boolean;
  minimizeReassignment: boolean;
}

export function togglesFromProperty(property: PropertyAssignmentPreferences): SmartToggles {
  return {
    balanceWorkload: property.balanceWorkload,
    prioritizeDeadlines: property.prioritizeGuestWaiting || property.prioritizeRush || property.prioritizeEarliestArrival,
    preferNearby: property.preferSameBuilding || property.preferSameFloor,
    minimizeReassignment: property.minimizeReassignment,
  };
}

/** The planner's wire preferences. A switched-on group uses the property's own sub-choices, or all of them if it stored none. */
export interface WirePreferences {
  balance_workload: boolean;
  prioritize_guest_waiting: boolean;
  prioritize_rush: boolean;
  prioritize_arrival: boolean;
  prefer_same_building: boolean;
  prefer_same_floor: boolean;
  minimize_reassignment: boolean;
}

export function toWirePreferences(toggles: SmartToggles, property: PropertyAssignmentPreferences): WirePreferences {
  const priority = [property.prioritizeGuestWaiting, property.prioritizeRush, property.prioritizeEarliestArrival];
  const priorityStored = priority.some(Boolean);
  const nearby = [property.preferSameBuilding, property.preferSameFloor];
  const nearbyStored = nearby.some(Boolean);
  return {
    balance_workload: toggles.balanceWorkload,
    prioritize_guest_waiting: toggles.prioritizeDeadlines && (priorityStored ? property.prioritizeGuestWaiting : true),
    prioritize_rush: toggles.prioritizeDeadlines && (priorityStored ? property.prioritizeRush : true),
    prioritize_arrival: toggles.prioritizeDeadlines && (priorityStored ? property.prioritizeEarliestArrival : true),
    prefer_same_building: toggles.preferNearby && (nearbyStored ? property.preferSameBuilding : true),
    prefer_same_floor: toggles.preferNearby && (nearbyStored ? property.preferSameFloor : true),
    minimize_reassignment: toggles.minimizeReassignment,
  };
}

export interface StaffPolicy {
  avoidOnBreak: boolean;
  excludeOffShift: boolean;
}

export function staffPolicyFrom(property: PropertyAssignmentPreferences): StaffPolicy {
  return { avoidOnBreak: property.avoidOnBreak, excludeOffShift: property.excludeOffShift };
}
