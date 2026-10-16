import type { AssignableStaff, FloorRoom } from "@/lib/housekeeping/supervisor";
import {
  MESSAGE_MAX,
  QUICK_VIEW_ROOM_LIMIT,
  SHIFT_NOTE_MAX,
  availabilityKey,
  buildShiftNotePayload,
  buildStaffQuickView,
  classifySendFailure,
  filterStaff,
  matchesName,
  readBroadcastResult,
  resolveHousekeepingDepartment,
  roleKey,
} from "@/lib/housekeeping/supervisorComms";
import { buildTeamPulse, normalizeRoster, type RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";

function room(id: string, status: string, assignedTo: string | null, extra: Partial<FloorRoom> = {}): FloorRoom {
  return {
    roomId: `r-${id}`,
    roomNumber: id,
    floor: 1,
    roomType: null,
    baseCleanMinutes: 30,
    status,
    foStatus: null,
    dnd: false,
    vip: false,
    assignedTo,
    assignmentId: null,
    cleanType: null,
    cleanTypeLabel: null,
    latestNote: null,
    openWorkOrderId: null,
    openWorkOrder: null,
    openWorkOrderStatus: null,
    highRisk: false,
    checkinTime: null,
    checkoutTime: null,
    ...extra,
  };
}

const STAFF: AssignableStaff[] = [
  { userId: "hk-1", name: "María Rodríguez", role: "housekeeper" },
  { userId: "hk-2", name: "James Lee", role: "housekeeper" },
  { userId: "sup-1", name: "Sam Super", role: "housekeeping_supervisor" },
];

const NOW = Date.parse("2026-10-16T17:00:00Z");
const available = (entries: RosterEntry[]): SourceState<RosterEntry[]> => ({ status: "available", data: entries, fetchedAt: NOW });

describe("housekeeping department resolution", () => {
  it("finds the one Housekeeping department by code or exact name", () => {
    expect(resolveHousekeepingDepartment([{ id: "d1", name: "Housekeeping", code: "HK" }, { id: "d2", name: "Engineering", code: "ENG" }])).toEqual({ status: "ok", departmentId: "d1" });
    expect(resolveHousekeepingDepartment([{ id: "d9", name: " housekeeping ", code: null }])).toEqual({ status: "ok", departmentId: "d9" });
    expect(resolveHousekeepingDepartment([{ id: "d9", name: "Rooms", code: "hk" }])).toEqual({ status: "ok", departmentId: "d9" });
  });

  it("is missing — never an unrelated department — when none matches", () => {
    expect(resolveHousekeepingDepartment([{ id: "d2", name: "Engineering", code: "ENG" }, { id: "d3", name: "Front Desk", code: "FD" }])).toEqual({ status: "missing" });
    expect(resolveHousekeepingDepartment([])).toEqual({ status: "missing" });
    expect(resolveHousekeepingDepartment(null)).toEqual({ status: "missing" });
    expect(resolveHousekeepingDepartment([{ id: null, name: "Housekeeping", code: "HK" }])).toEqual({ status: "missing" });
  });

  it("is ambiguous rather than guessing between two", () => {
    expect(resolveHousekeepingDepartment([{ id: "a", name: "Housekeeping", code: "HK" }, { id: "b", name: "Housekeeping North", code: "HK" }])).toEqual({ status: "ambiguous" });
  });

  it("counts the same department listed twice once", () => {
    expect(resolveHousekeepingDepartment([{ id: "a", name: "Housekeeping", code: "HK" }, { id: "a", name: "Housekeeping", code: "HK" }])).toEqual({ status: "ok", departmentId: "a" });
  });
});

describe("shift note payload", () => {
  it("is the real CreateLogbookEntryRequest: a department, informational, normal — never an open follow-up", () => {
    const payload = buildShiftNotePayload("dept-1", "  VIP in 308  ");
    expect(payload).toEqual({ department_id: "dept-1", content: "VIP in 308", category: "general", status: "informational", priority: "normal" });
    expect(payload).not.toHaveProperty("entry_type");
    expect(payload).not.toHaveProperty("is_private");
    expect(payload.status).not.toBe("follow_up");
  });

  it("limits match the API", () => {
    expect(SHIFT_NOTE_MAX).toBe(4000);
    expect(MESSAGE_MAX).toBeLessThanOrEqual(1000);
  });
});

describe("send failures", () => {
  it("separates 'the server said no' from 'we never got an answer'", () => {
    expect(classifySendFailure({ status: 422 })).toBe("rejected");
    expect(classifySendFailure({ status: 404 })).toBe("rejected");
    expect(classifySendFailure({ status: 403 })).toBe("forbidden");
    expect(classifySendFailure({ status: 401 })).toBe("signedOut");
    expect(classifySendFailure({ status: 500 })).toBe("unconfirmed");
    expect(classifySendFailure(new Error("Request timed out. Please try again."))).toBe("unconfirmed");
    expect(classifySendFailure(new Error("Network request failed"))).toBe("unconfirmed");
    expect(classifySendFailure(new Error("Not authenticated"))).toBe("signedOut");
    expect(classifySendFailure(null)).toBe("unconfirmed");
  });
});

describe("broadcast result", () => {
  it("reports exactly what the server counted", () => {
    expect(readBroadcastResult({ data: { sent: 8 } })).toEqual({ kind: "delivered", count: 8 });
    expect(readBroadcastResult({ data: { sent: 1 } })).toEqual({ kind: "delivered", count: 1 });
  });

  it("treats zero recipients as its own outcome, not a delivery", () => {
    expect(readBroadcastResult({ data: { sent: 0 } })).toEqual({ kind: "nobody" });
  });

  it("never invents a count from an unexpected answer", () => {
    for (const response of [null, {}, { data: {} }, { data: { sent: "8" } }, { data: { sent: -1 } }, { data: { sent: 2.5 } }]) {
      expect(readBroadcastResult(response)).toEqual({ kind: "unknown" });
    }
  });
});

describe("staff search", () => {
  it("matches names ignoring case and accents", () => {
    expect(matchesName("María Rodríguez", "maria")).toBe(true);
    expect(matchesName("María Rodríguez", "RODRI")).toBe(true);
    expect(matchesName("James Lee", "maria")).toBe(false);
    expect(matchesName("James Lee", "  ")).toBe(true);
  });

  it("never offers the viewer themself", () => {
    expect(filterStaff(STAFF, "sup-1", "").map((m) => m.userId)).toEqual(["hk-1", "hk-2"]);
    expect(filterStaff(STAFF, "sup-1", "ja").map((m) => m.userId)).toEqual(["hk-2"]);
  });
});

describe("availability words", () => {
  it("says unknown when unknown — it is never folded into 'off shift'", () => {
    expect(availabilityKey("unknown")).toBe("supervisorComms.quick.statusUnknown");
    expect(availabilityKey(null)).toBe("supervisorComms.quick.statusUnknown");
    expect(availabilityKey("not_clocked_in")).toBe("supervisorToday.team.statusNotClockedIn");
    expect(availabilityKey("on_shift")).toBe("supervisorToday.team.statusOnShift");
    expect(availabilityKey("on_break")).toBe("supervisorToday.team.statusOnBreak");
    expect(availabilityKey("ended")).toBe("supervisorToday.team.statusEnded");
  });

  it("only labels roles it knows", () => {
    expect(roleKey("housekeeper")).toBe("supervisorComms.quick.roles.housekeeper");
    expect(roleKey("gm")).toBeNull();
    expect(roleKey(null)).toBeNull();
  });
});

describe("staff quick view", () => {
  const rooms = [
    room("101", "INSPECTED", "hk-1"),
    room("102", "CLEAN", "hk-1"),
    room("103", "CLEAN", "hk-1"),
    room("110", "DIRTY", "hk-1", { vip: true }),
    room("104", "IN_PROGRESS", "hk-1"),
    room("105", "OCCUPIED", "hk-1", { dnd: true }),
    room("201", "DIRTY", "hk-2"),
  ];
  const pulse = buildTeamPulse(rooms, STAFF, available(normalizeRoster([{ user_id: "hk-1", status: "active", started_at: "2026-10-16T13:00:00Z" }], NOW)), "sup-1");
  const view = buildStaffQuickView(pulse.members.find((m) => m.userId === "hk-1")!);

  it("uses the person's real assignments only", () => {
    expect(view.assigned).toBe(6);
    expect(view.remainingRooms.map((r) => r.roomNumber)).not.toContain("201");
  });

  it("does not confuse cleaning completed with inspection approved", () => {
    expect(view.cleaned).toBe(3); // submitted (2) + inspected (1)
    expect(view.inspected).toBe(1); // only INSPECTED passed
    expect(view.awaitingInspection).toBe(2); // CLEAN is not guest-ready
    expect(view.cleaned).toBe(view.inspected + view.awaitingInspection);
  });

  it("counts remaining as rooms still needing housekeeping and lists the one being cleaned first", () => {
    expect(view.remaining).toBe(3);
    expect(view.inProgress).toBe(1);
    expect(view.remainingRooms.map((r) => r.roomNumber)).toEqual(["104", "105", "110"]);
    expect(view.remainingRooms.find((r) => r.roomNumber === "110")?.vip).toBe(true);
    expect(view.remainingRooms.find((r) => r.roomNumber === "105")?.dnd).toBe(true);
  });

  it("takes availability from the roster: clocked in = on shift", () => {
    expect(view.availability).toBe("on_shift");
    expect(buildStaffQuickView(pulse.members.find((m) => m.userId === "hk-2")!).availability).toBe("not_clocked_in");
  });

  it("is UNKNOWN — not 'not clocked in' — when the roster could not be read", () => {
    const failed = buildTeamPulse(rooms, STAFF, { status: "failed", failure: { kind: "forbidden", status: 403 } }, "sup-1");
    expect(buildStaffQuickView(failed.members.find((m) => m.userId === "hk-1")!).availability).toBe("unknown");
  });

  it("previews a few rooms and counts the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => room(String(300 + i), "DIRTY", "hk-1"));
    const big = buildStaffQuickView(buildTeamPulse(many, STAFF, available([]), "sup-1").members.find((m) => m.userId === "hk-1")!);
    expect(big.remainingRooms).toHaveLength(QUICK_VIEW_ROOM_LIMIT);
    expect(big.hiddenRemaining).toBe(9 - QUICK_VIEW_ROOM_LIMIT);
  });

  it("handles a person with no rooms", () => {
    const none = buildStaffQuickView(buildTeamPulse(rooms, STAFF, available([]), "sup-1").members.find((m) => m.userId === "sup-1")!);
    expect(none).toMatchObject({ assigned: 0, cleaned: 0, remaining: 0, remainingRooms: [], hiddenRemaining: 0 });
  });
});
