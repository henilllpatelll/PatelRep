import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BlockedTaskItem } from "@/lib/api/tasks";
import type { InspectionRecordRaw } from "@/lib/api/housekeepingSupervisor";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import {
  HANDOFF_DRAFT_TTL_MS,
  HANDOFF_NOTES_MAX,
  HANDOFF_ROOM_LIST_MAX,
  availabilityOf,
  buildHandoffPayload,
  buildHandoffReport,
  classifyHandoffFailure,
  clearHandoffDraft,
  handoffBlockers,
  isMeaningfulHandoffDraft,
  loadHandoffDraft,
  materialChanges,
  newHandoffRequestId,
  parseHandoffDraft,
  readSavedHandoff,
  saveHandoffDraft,
} from "@/lib/housekeeping/supervisorHandoff";
import { availableSource, failedSource, loadingSource, offlineSource } from "@/lib/housekeeping/supervisorSources";
import { composeSupervisorToday, normalizeBoard, type TodaySources } from "@/lib/housekeeping/supervisorToday";

const ZONE = "America/Chicago";
const NOW = Date.parse("2026-10-16T17:00:00Z"); // 12:00 Friday in Chicago
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function room(id: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: `r-${id}`, status, rooms: { id: `r-${id}`, room_number: id, floor: 1 }, ...extra };
}

function inspection(id: string, result: string | null, completedAt = "2026-10-16T15:00:00Z"): InspectionRecordRaw {
  return { id, overall_result: result, completed_at: completedAt, room_number: "101" };
}

function blocker(id: string, taskType: string, status: "active" | "resolved" = "active"): BlockedTaskItem {
  return {
    blocker: { id, reason: "other", details: null, reported_by: null, reported_by_name: null, reported_at: null, status, notification_status: "none" },
    task: { id: `t-${id}`, title: "Task", task_type: taskType, priority: "normal", assigned_to_name: null, room_number: "101", location_text: null },
  } as unknown as BlockedTaskItem;
}

const BOARD = [
  room("101", "INSPECTED"),
  room("102", "INSPECTED"),
  room("103", "CLEAN", { assigned_to: "hk-1" }),
  room("104", "CLEAN", { assigned_to: "hk-1" }),
  room("105", "IN_PROGRESS", { assigned_to: "hk-1" }),
  room("106", "DIRTY", { assigned_to: "hk-2" }),
  room("107", "DIRTY"),
  room("108", "OCCUPIED"),
  room("109", "OOO"),
];

interface Overrides {
  board?: TodaySources["board"];
  inspections?: TodaySources["inspections"];
  blockedTasks?: TodaySources["blockedTasks"];
  now?: number;
}

function reportFor(over: Overrides = {}) {
  const sources: TodaySources = {
    board: over.board ?? availableSource(normalizeBoard(BOARD), NOW),
    staff: availableSource([], NOW),
    roster: availableSource([], NOW),
    inspections: over.inspections ?? availableSource([inspection("i1", "passed"), inspection("i2", "failed")], NOW),
    blockedTasks: over.blockedTasks ?? availableSource([], NOW),
  };
  return buildHandoffReport(composeSupervisorToday(sources, { now: over.now ?? NOW, timeZone: ZONE, viewerId: "sup-1" }));
}

describe("availabilityOf", () => {
  it("separates verified (including verified empty) from stale, loading and unavailable", () => {
    expect(availabilityOf(availableSource([1], NOW))).toBe("verified");
    expect(availabilityOf(availableSource([], NOW))).toBe("verified");
    expect(availabilityOf(offlineSource(availableSource([1], NOW)))).toBe("stale");
    expect(availabilityOf(loadingSource())).toBe("loading");
    expect(availabilityOf(failedSource(new Error("x"), loadingSource()))).toBe("unavailable");
  });
});

describe("buildHandoffReport — readiness is a snapshot, inspections are activity", () => {
  it("counts ready (INSPECTED) and awaiting inspection (CLEAN) separately and never mixes them with passed inspections", () => {
    const report = reportFor();
    expect(report.rooms).toEqual({ total: 9, outOfOrder: 1, inService: 8, ready: 2, awaitingInspection: 2, inProgress: 1, toClean: 3 });
    // 2 rooms are ready; 1 inspection passed. Neither number is derived from the other.
    expect(report.rooms?.ready).toBe(2);
    expect(report.inspections).toEqual({ passed: 1, failed: 1, conditional: 0 });
  });

  it("counts every completed inspection record: a room failed then passed counts as one of each", () => {
    const report = reportFor({
      inspections: availableSource(
        [inspection("i1", "failed"), inspection("i2", "passed"), inspection("i3", "conditional"), inspection("i3", "conditional"), inspection("i4", "passed")],
        NOW,
      ),
    });
    expect(report.inspections).toEqual({ passed: 2, failed: 1, conditional: 1 }); // duplicate id i3 counted once
  });

  it("treats a verified empty inspection history as a TRUE zero", () => {
    const report = reportFor({ inspections: availableSource([], NOW) });
    expect(report.inspections).toEqual({ passed: 0, failed: 0, conditional: 0 });
    expect(handoffBlockers(report)).toEqual([]);
  });

  it("lists unfinished work from real records only", () => {
    const report = reportFor();
    expect(report.unresolved).toEqual({
      unassignedRooms: 2,
      unassignedRoomNumbers: ["107", "108"],
      awaitingInspectionRoomNumbers: ["103", "104"],
      blockedTasks: 0,
    });
  });

  it("caps the room lists but keeps the true counts", () => {
    const many = Array.from({ length: 45 }, (_, index) => room(String(200 + index), "DIRTY"));
    const report = reportFor({ board: availableSource(normalizeBoard(many), NOW) });
    expect(report.unresolved?.unassignedRooms).toBe(45);
    expect(report.unresolved?.unassignedRoomNumbers).toHaveLength(HANDOFF_ROOM_LIST_MAX);
  });

  it("counts only ACTIVE blockers on HOUSEKEEPING tasks", () => {
    const report = reportFor({
      blockedTasks: availableSource([blocker("a", "housekeeping"), blocker("b", "engineering"), blocker("c", "housekeeping", "resolved"), blocker("d", "housekeeping")], NOW),
    });
    expect(report.unresolved?.blockedTasks).toBe(2);
  });

  it("reports blocked tasks as unknown (null), not zero, when that source failed — and still allows the report", () => {
    const report = reportFor({ blockedTasks: failedSource(new Error("403"), loadingSource()) });
    expect(report.unresolved?.blockedTasks).toBeNull();
    expect(report.availability.blockedTasks).toBe("unavailable");
    expect(handoffBlockers(report)).toEqual([]);
    expect(buildHandoffPayload(report, "", REQUEST_ID)?.unresolved.blocked_tasks).toBeNull();
  });
});

describe("handoffBlockers — mandatory figures must be verified", () => {
  it("does not turn an inspection failure into zero passed/failed", () => {
    const report = reportFor({ inspections: failedSource(new Error("500"), loadingSource()) });
    expect(report.inspections).toBeNull();
    expect(handoffBlockers(report)).toEqual(["inspectionsUnavailable"]);
    expect(buildHandoffPayload(report, "note", REQUEST_ID)).toBeNull();
  });

  it("blocks on a board that failed, is loading, or is only the last known answer", () => {
    expect(handoffBlockers(reportFor({ board: failedSource(new Error("x"), loadingSource()) }))).toEqual(["boardUnavailable"]);
    expect(handoffBlockers(reportFor({ board: loadingSource() }))).toEqual(["boardLoading"]);
    const stale = reportFor({ board: offlineSource(availableSource(normalizeBoard(BOARD), NOW)) });
    expect(stale.rooms).toBeNull();
    expect(handoffBlockers(stale)).toEqual(["boardStale"]);
  });

  it("treats an answer older than the freshness window as stale", () => {
    const report = reportFor({ now: NOW + 6 * 60_000 });
    expect(handoffBlockers(report)).toEqual(["boardStale", "inspectionsStale"]);
  });

  it("refuses figures that straddle the hotel's midnight", () => {
    const board = availableSource(normalizeBoard(BOARD), Date.parse("2026-10-17T04:59:30Z")); // 23:59 Oct 16 in Chicago
    const inspections = availableSource([inspection("i1", "passed")], Date.parse("2026-10-17T05:00:30Z")); // 00:00 Oct 17
    const report = reportFor({ board, inspections, now: Date.parse("2026-10-17T05:01:00Z") });
    expect(report.reportDate).toBeNull();
    expect(handoffBlockers(report)).toEqual(["dayMismatch"]);
  });

  it("dates the report by the HOTEL's day, not the UTC day", () => {
    const at = Date.parse("2026-10-17T03:30:00Z"); // 22:30 Oct 16 in Chicago, already Oct 17 in UTC
    const report = reportFor({ board: availableSource(normalizeBoard(BOARD), at), inspections: availableSource([], at), now: at });
    expect(report.reportDate).toBe("2026-10-16");
  });
});

describe("buildHandoffPayload — the contract the API actually reads", () => {
  it("matches EndShiftSummaryRequest exactly and carries no pre-contract fields", () => {
    const payload = buildHandoffPayload(reportFor(), "  Watch 312  ", REQUEST_ID);
    expect(payload).toEqual({
      client_request_id: REQUEST_ID,
      report_date: "2026-10-16",
      rooms: { total: 9, out_of_order: 1, ready: 2, awaiting_inspection: 2, in_progress: 1, to_clean: 3 },
      inspections: { passed: 1, failed: 1, conditional: 0 },
      unresolved: {
        unassigned_rooms: 2,
        unassigned_room_numbers: ["107", "108"],
        awaiting_inspection_room_numbers: ["103", "104"],
        blocked_tasks: 0,
      },
      notes: "Watch 312",
    });
    for (const legacy of ["rooms_completed", "rooms_inspected", "rooms_failed", "rooms_ooo", "supervisor_notes", "stats", "notes_text"]) {
      expect(payload).not.toHaveProperty(legacy);
    }
  });

  it("sends null (not an empty string) for an empty note and caps a long one", () => {
    expect(buildHandoffPayload(reportFor(), "   ", REQUEST_ID)?.notes).toBeNull();
    expect(buildHandoffPayload(reportFor(), "x".repeat(HANDOFF_NOTES_MAX + 50), REQUEST_ID)?.notes).toHaveLength(HANDOFF_NOTES_MAX);
  });
});

describe("materialChanges", () => {
  it("is empty for the same figures and ignores timestamps", () => {
    const a = reportFor();
    const b = reportFor({ board: availableSource(normalizeBoard(BOARD), NOW + 1000), now: NOW + 1000 });
    expect(materialChanges(a, b)).toEqual([]);
  });

  it("names what moved", () => {
    const base = reportFor();
    const moreReady = reportFor({ board: availableSource(normalizeBoard([...BOARD.slice(1), room("103", "INSPECTED")]), NOW) });
    expect(materialChanges(base, moreReady)).toContain("rooms");
    const failed = reportFor({ inspections: availableSource([inspection("i1", "passed"), inspection("i2", "failed"), inspection("i3", "failed")], NOW) });
    expect(materialChanges(base, failed)).toEqual(["inspections"]);
    const blocked = reportFor({ blockedTasks: availableSource([blocker("a", "housekeeping")], NOW) });
    expect(materialChanges(base, blocked)).toEqual(["unresolved"]);
  });
});

describe("classifyHandoffFailure", () => {
  it("maps the server's structured codes", () => {
    expect(classifyHandoffFailure({ status: 409, code: "inspection_counts_changed" }).kind).toBe("countsChanged");
    expect(classifyHandoffFailure({ status: 422, code: "housekeeping_department_missing" }).kind).toBe("departmentMissing");
    expect(classifyHandoffFailure({ status: 422, code: "housekeeping_department_ambiguous" }).kind).toBe("departmentAmbiguous");
    expect(classifyHandoffFailure({ status: 422, code: "report_date_out_of_range" }).kind).toBe("dateOutOfRange");
  });

  it("separates 'the server said no' from 'no answer'", () => {
    expect(classifyHandoffFailure({ status: 403 }).kind).toBe("forbidden");
    expect(classifyHandoffFailure({ status: 401 }).kind).toBe("signedOut");
    expect(classifyHandoffFailure({ status: 422 }).kind).toBe("rejected");
    expect(classifyHandoffFailure({ status: 500 }).kind).toBe("unconfirmed");
    expect(classifyHandoffFailure(new Error("Request timed out. Please try again.")).kind).toBe("unconfirmed");
    expect(classifyHandoffFailure(new Error("Network request failed")).kind).toBe("unconfirmed");
    expect(classifyHandoffFailure(new Error("Session expired. Please log in again.")).kind).toBe("signedOut");
  });
});

describe("readSavedHandoff — success needs a record id", () => {
  it("reads the saved record", () => {
    expect(
      readSavedHandoff({ data: { id: "abc", created_at: "2026-10-16T21:00:00Z", report_date: "2026-10-16" }, idempotent_replay: false, notifications: { status: "complete" } }),
    ).toEqual({ id: "abc", createdAt: "2026-10-16T21:00:00Z", reportDate: "2026-10-16", replay: false, managers: "complete" });
  });

  it("returns null without an id, however successful the rest looks", () => {
    expect(readSavedHandoff({ data: null })).toBeNull();
    expect(readSavedHandoff({ data: {} })).toBeNull();
    expect(readSavedHandoff({ data: { id: "  " } })).toBeNull();
    expect(readSavedHandoff({})).toBeNull();
    expect(readSavedHandoff(null)).toBeNull();
  });

  it("does not claim managers were notified when the answer does not say", () => {
    expect(readSavedHandoff({ data: { id: "abc" } })?.managers).toBe("unknown");
    expect(readSavedHandoff({ data: { id: "abc" }, notifications: { status: "failed" } })?.managers).toBe("failed");
  });
});

describe("the kept draft", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("makes unique, well-formed request ids", () => {
    const a = newHandoffRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newHandoffRequestId()).not.toBe(a);
  });

  it("round-trips for the same person and hotel", async () => {
    await saveHandoffDraft("h1:u1", { notes: "Watch 312", requestId: REQUEST_ID, attempted: false, notificationPending: false, savedAt: NOW });
    expect(await loadHandoffDraft("h1:u1", NOW + 1000)).toEqual({ notes: "Watch 312", requestId: REQUEST_ID, attempted: false, notificationPending: false, recoveryPayload: undefined, savedAt: NOW });
  });

  it("never shows one person's or one hotel's draft to another", async () => {
    await saveHandoffDraft("h1:u1", { notes: "private", requestId: REQUEST_ID, attempted: false, notificationPending: false, savedAt: NOW });
    expect(await loadHandoffDraft("h1:u2", NOW)).toBeNull();
    expect(await loadHandoffDraft("h2:u1", NOW)).toBeNull();
  });

  it("expires, and ignores corrupt or future-dated data", () => {
    const base = { notes: "n", requestId: REQUEST_ID, attempted: false };
    expect(parseHandoffDraft(JSON.stringify({ ...base, savedAt: NOW }), NOW + HANDOFF_DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(parseHandoffDraft(JSON.stringify({ ...base, savedAt: NOW }), NOW + HANDOFF_DRAFT_TTL_MS + 1)).toBeNull();
    expect(parseHandoffDraft(JSON.stringify({ ...base, savedAt: NOW + 10 * 60_000 }), NOW)).toBeNull();
    expect(parseHandoffDraft("{not json", NOW)).toBeNull();
    expect(parseHandoffDraft(JSON.stringify({ notes: 5 }), NOW)).toBeNull();
    expect(parseHandoffDraft(null, NOW)).toBeNull();
  });

  it("is dropped when empty, kept when a submit is unresolved, and cleared on request", async () => {
    await saveHandoffDraft("h1:u1", { notes: "  ", requestId: REQUEST_ID, attempted: false, notificationPending: false, savedAt: NOW });
    expect(await loadHandoffDraft("h1:u1", NOW)).toBeNull();
    expect(isMeaningfulHandoffDraft({ notes: "", attempted: true })).toBe(true);
    await saveHandoffDraft("h1:u1", { notes: "", requestId: REQUEST_ID, attempted: true, notificationPending: false, savedAt: NOW });
    expect((await loadHandoffDraft("h1:u1", NOW))?.attempted).toBe(true);
    await clearHandoffDraft("h1:u1");
    expect(await loadHandoffDraft("h1:u1", NOW)).toBeNull();
  });

  it("stores no figures until a saved report needs GM-notification recovery", async () => {
    await saveHandoffDraft("h1:u1", { notes: "n", requestId: REQUEST_ID, attempted: false, notificationPending: false, savedAt: NOW });
    const stored = JSON.parse((await AsyncStorage.getItem("@patelrep/mobile/supervisor-handoff-draft:h1:u1")) as string);
    expect(Object.keys(stored).sort()).toEqual(["attempted", "notes", "notificationPending", "requestId", "savedAt"]);
  });
});
