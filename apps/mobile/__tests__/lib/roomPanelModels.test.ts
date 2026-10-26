import { classifyLoadError, classifyWriteFailure } from "@/lib/housekeeping/roomPanelErrors";
import { checkNote, noteWasRecorded, ROOM_NOTE_MAX_LENGTH } from "@/lib/housekeeping/roomNote";
import {
  buildActivity,
  buildCleaningHistory,
  buildSessionDetail,
  durationLabel,
  type HistoryContext,
} from "@/lib/housekeeping/roomCleaningHistory";
import { buildInspectionHistory, inspectionWindow, inspectorNameOf } from "@/lib/housekeeping/roomInspectionHistory";
import { buildWorkOrderDetail } from "@/lib/housekeeping/roomWorkOrderDetail";
import { checkBeforeInspecting, normalizeRoomIdParam, resolveInspectionTarget } from "@/lib/housekeeping/inspectionTarget";
import { addDaysToYmd } from "@/lib/housekeeping/hotelTime";
import { makeTranslator, type Language } from "../helpers/i18n";
import { NOW, ZONE } from "../helpers/roomBoardFixtures";

const ctxOf = (language: Language = "en", names: Record<string, string> = { "hk-1": "Maria Santos" }): HistoryContext => ({
  now: NOW,
  timeZone: ZONE,
  language,
  t: makeTranslator(language),
  nameOf: (id) => (id ? (names[id] ?? null) : null),
});

describe("error classification", () => {
  it("a server answer is classified by status; no answer is a network problem", () => {
    expect(classifyLoadError(Object.assign(new Error("x"), { status: 403 }))).toBe("unauthorized");
    expect(classifyLoadError(Object.assign(new Error("x"), { status: 404 }))).toBe("not_found");
    expect(classifyLoadError(Object.assign(new Error("x"), { status: 500 }))).toBe("server");
    expect(classifyLoadError(new Error("Network request failed"))).toBe("network");
    expect(classifyLoadError(new Error("Session expired. Please log in again."))).toBe("unauthorized");
  });

  it("only a 4xx proves a write did not happen; no answer or 5xx is uncertain", () => {
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 422 }))).toBe("invalid");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 409 }))).toBe("conflict");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 403 }))).toBe("forbidden");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 404 }))).toBe("not_found");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 500 }))).toBe("uncertain");
    expect(classifyWriteFailure(new Error("Request timed out."))).toBe("uncertain");
  });
});

describe("note rules", () => {
  it("trims, rejects empty and over-long notes, and counts what will be sent", () => {
    expect(checkNote("   ")).toMatchObject({ issue: "empty", canSave: false });
    expect(checkNote("  Extra towels  ")).toMatchObject({ text: "Extra towels", issue: null, canSave: true });
    expect(checkNote("x".repeat(ROOM_NOTE_MAX_LENGTH))).toMatchObject({ canSave: true, remaining: 0 });
    expect(checkNote("x".repeat(ROOM_NOTE_MAX_LENGTH + 1))).toMatchObject({ issue: "too_long", canSave: false });
  });

  it("recognises its own recent note in the history, and nothing else", () => {
    const at = new Date(NOW).toISOString();
    const rows = [
      { from_status: "DIRTY", to_status: "DIRTY", notes: "Tray at door", changed_by: "sup-1", created_at: at },
      { from_status: "DIRTY", to_status: "CLEAN", notes: "Tray at door", changed_by: "sup-1", created_at: at },
    ];
    const input = { text: "Tray at door", userId: "sup-1", sinceMs: NOW - 1000 };
    expect(noteWasRecorded(rows, input)).toBe(true);
    expect(noteWasRecorded(rows, { ...input, userId: "sup-2" })).toBe(false);
    expect(noteWasRecorded(rows, { ...input, text: "Other" })).toBe(false);
    expect(noteWasRecorded(rows, { ...input, sinceMs: NOW + 10 * 60_000 })).toBe(false);
    // a status change that happens to carry the same text is not a note
    expect(noteWasRecorded([rows[1]], input)).toBe(false);
    expect(noteWasRecorded(rows, { ...input, userId: null })).toBe(false);
  });
});

describe("cleaning history", () => {
  const done = { id: "s1", status: "completed", clean_type: "DEP", started_at: "2026-10-16T15:11:00Z", ended_at: "2026-10-16T15:42:00Z", duration_seconds: 1860, checklist_done: 12, checklist_total: 12, housekeeper_id: "hk-1", notes: null };

  it("shows a completed clean with type, time, duration, checklist and a verified name", () => {
    const { groups } = buildCleaningHistory([done], ctxOf(), 10);
    expect(groups[0].label).toBe("TODAY · OCT 16");
    expect(groups[0].rows[0]).toMatchObject({
      state: "completed", typeLabel: "Departure clean", timeLine: "Completed 10:42 AM", duration: "31 min", checklist: "12 / 12", housekeeper: "Maria Santos",
    });
  });

  it("never turns an id into a name, a missing duration into zero minutes, or an unfinished clean into a completed one", () => {
    const rows = buildCleaningHistory(
      [
        { ...done, id: "a", housekeeper_id: "hk-9", duration_seconds: null },
        { ...done, id: "b", status: "active", ended_at: null, duration_seconds: null },
        { ...done, id: "c", status: "abandoned", duration_seconds: 5 },
      ],
      ctxOf(),
      10,
    ).groups[0].rows;
    expect(rows[0]).toMatchObject({ housekeeper: null, duration: null, durationMissing: true });
    expect(rows[1]).toMatchObject({ state: "in_progress", stateLabel: "In progress", durationMissing: false, timeLine: "Started 10:11 AM" });
    expect(rows[2]).toMatchObject({ state: "abandoned", duration: null, stateLabel: "Stopped" });
    expect(durationLabel(0, ctxOf().t)).toBeNull();
    expect(durationLabel(null, ctxOf().t)).toBeNull();
  });

  it("groups by hotel-local day and bounds what is shown", () => {
    const older = { ...done, id: "old", started_at: "2026-10-15T16:00:00Z", ended_at: "2026-10-15T16:20:00Z" };
    const result = buildCleaningHistory([done, older], ctxOf(), 10);
    expect(result.groups.map((g) => g.label)).toEqual(["TODAY · OCT 16", "OCT 15"]);
    const limited = buildCleaningHistory([done, older], ctxOf(), 1);
    expect(limited).toMatchObject({ shown: 1, total: 2 });
  });

  it("an empty list is empty, not an error", () => {
    expect(buildCleaningHistory([], ctxOf(), 10)).toMatchObject({ groups: [], total: 0 });
  });

  it("a session detail lists checklist items, only real photo links, and Spanish labels", () => {
    const detail = buildSessionDetail(
      {
        ...done,
        checklist: [{ item_id: "i1", label: "Beds made", checked: true }, { item_id: "i2", label: "Bathroom", checked: false }, { label: "  " }],
        photos: [{ id: "p1", kind: "proof", url: "https://signed.example/p1", created_at: done.ended_at }, { id: "p2", kind: "issue", url: "" }],
      },
      ctxOf("es"),
    );
    expect(detail.checklist.map((c) => [c.label, c.checked])).toEqual([["Beds made", true], ["Bathroom", false]]);
    expect(detail.photos.map((p) => p.url)).toEqual(["https://signed.example/p1", null]);
    expect(detail.row.stateLabel).toBe("Completada");
    expect(detail.facts.find((f) => f.key === "duration")?.value).toBe("31 min");
  });
});

describe("activity", () => {
  it("separates notes from status changes and never shows machine text from a status row", () => {
    const at = "2026-10-16T15:00:00Z";
    const entries = buildActivity(
      [
        { id: "1", from_status: "DIRTY", to_status: "DIRTY", notes: "Guest wants towels", created_at: at, actor_name: "Ben" },
        { id: "2", from_status: "OCCUPIED", to_status: "DIRTY", notes: "Guest checked out|prev_clean_type=DEP", created_at: at, actor_name: null },
        { id: "3", from_status: "DIRTY", to_status: "DIRTY", notes: "", created_at: at },
      ],
      ctxOf(),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "note", text: "Guest wants towels", actor: "Ben" });
    expect(entries[1]).toMatchObject({ kind: "status", actor: null });
    expect(entries[1].text).not.toContain("prev_clean_type");
  });
});

describe("inspection history", () => {
  it("windows are hotel-local calendar days, DST-safe", () => {
    expect(inspectionWindow(7, NOW, ZONE)).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    // 02:30 UTC on Oct 17 is still the 16th in Chicago.
    expect(inspectionWindow(1, Date.parse("2026-10-17T02:30:00Z"), ZONE)).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(addDaysToYmd("2026-11-02", -1)).toBe("2026-11-01");
    expect(addDaysToYmd("2026-03-09", -1)).toBe("2026-03-08");
  });

  it("labels results, keeps summary fields only, and treats an id fragment as an unrecorded inspector", () => {
    const rows = buildInspectionHistory(
      [
        { id: "i1", overall_result: "failed", notes: "Mirror", inspector_name: "a1b2c3d4", completed_at: "2026-10-15T15:00:00Z" },
        { id: "i2", overall_result: "passed", notes: null, inspector_name: "Dana Cole", completed_at: "2026-10-16T16:06:00Z" },
        { id: "i3", overall_result: "weird", inspector_name: "Unknown", completed_at: "2026-10-14T16:00:00Z" },
      ],
      ctxOf(),
    );
    expect(rows.map((r) => r.id)).toEqual(["i2", "i1", "i3"]);
    expect(rows[0]).toMatchObject({ resultLabel: "Passed", inspector: "Dana Cole", note: null, at: "Today, 11:06 AM" });
    expect(rows[1]).toMatchObject({ resultLabel: "Failed", inspector: null, note: "Mirror" });
    expect(rows[2]).toMatchObject({ result: "unknown", inspector: null });
    expect(inspectorNameOf("")).toBeNull();
  });
});

describe("work order detail", () => {
  const wo = { id: "wo-1", title: "Faucet leaking", status: "open", priority: "high", room_id: "room-201", work_order_number: "WO-1042", description: "Sink faucet leaks", created_at: "2026-10-16T14:42:00Z", assigned_to: "eng-1" } as never;
  const c = { ...ctxOf(), expectedRoomId: "room-201", roomNumber: "201" };

  it("shows what the record holds and never names an engineer or offers anything to change", () => {
    const view = buildWorkOrderDetail(wo, c);
    expect(view.kind).toBe("ok");
    if (view.kind !== "ok") return;
    expect(view.detail).toMatchObject({ number: "WO-1042", title: "Faucet leaking", statusLabel: "Open", priorityLabel: "High", highPriority: true, closed: false, assignment: "assigned" });
    expect(view.detail.rows.find((r) => r.key === "reported")?.value).toBe("Today, 9:42 AM");
    expect(view.detail.rows.find((r) => r.key === "assignment")?.value).toBe("Assigned");
    expect(JSON.stringify(view)).not.toContain("eng-1");
  });

  it("a closed order is closed, with its resolution; a missing description is honest", () => {
    const view = buildWorkOrderDetail({ ...(wo as object), status: "completed", completed_at: "2026-10-16T15:00:00Z", notes: "Replaced cartridge", description: null, assigned_to: null } as never, c);
    if (view.kind !== "ok") throw new Error("expected ok");
    expect(view.detail).toMatchObject({ closed: true, highPriority: false, description: null, resolution: { notes: "Replaced cartridge", parts: null }, assignment: "unassigned" });
  });

  it("refuses a work order that belongs to a different room", () => {
    expect(buildWorkOrderDetail({ ...(wo as object), room_id: "room-999" } as never, c).kind).toBe("wrong_room");
  });
});

describe("inspection target", () => {
  const queue = [
    { room_id: "room-203", room_number: "203", floor: 2, cleaned_by: "Ana", cleaned_at: null, housekeeper_id: null, clean_type: null },
  ];

  it("resolves by id only, and only against a verified queue", () => {
    expect(resolveInspectionTarget(null, queue, true)).toEqual({ kind: "none" });
    expect(resolveInspectionTarget("room-203", queue, false)).toEqual({ kind: "waiting" });
    expect(resolveInspectionTarget("room-203", queue, true)).toMatchObject({ kind: "ready", room: { room_number: "203" } });
    expect(resolveInspectionTarget("room-999", queue, true)).toEqual({ kind: "not_awaiting", roomId: "room-999" });
    expect(resolveInspectionTarget("../etc", queue, true)).toEqual({ kind: "invalid" });
    expect(resolveInspectionTarget("203", queue, true)).toMatchObject({ kind: "not_awaiting" });
  });

  it("normalises router params", () => {
    expect(normalizeRoomIdParam(" room-1 ")).toBe("room-1");
    expect(normalizeRoomIdParam(["a", "b"])).toBe("a");
    expect(normalizeRoomIdParam("")).toBeNull();
    expect(normalizeRoomIdParam(undefined)).toBeNull();
  });

  const guard = (over: Partial<Parameters<typeof checkBeforeInspecting>[0]> = {}) =>
    checkBeforeInspecting({
      roomId: "room-203",
      templateId: "t1",
      date: "2026-10-16",
      fetchQueue: async () => queue,
      fetchTemplates: async () => ({ data: [{ id: "t1", name: "Std", items: [] }] }),
      ...over,
    });

  it("allows the write only when the room is still queued and the checklist still exists", async () => {
    await expect(guard()).resolves.toBe("ok");
    await expect(guard({ fetchQueue: async () => [] })).resolves.toBe("not_awaiting");
    await expect(guard({ templateId: "gone" })).resolves.toBe("template_changed");
    await expect(guard({ fetchQueue: async () => { throw new Error("offline"); } })).resolves.toBe("unavailable");
  });

  it("a checklist whose id is unchanged but whose digest differs was edited, so the write is stopped", async () => {
    const withDigest = (fingerprint: string | undefined) => async () => ({ data: [{ id: "t1", name: "Std", items: [], fingerprint }] });
    await expect(guard({ templateFingerprint: "fp-1", fetchTemplates: withDigest("fp-1") })).resolves.toBe("ok");
    await expect(guard({ templateFingerprint: "fp-1", fetchTemplates: withDigest("fp-2") })).resolves.toBe("template_changed");
    // a server that sends no digest cannot disprove it; the id check above still applies
    await expect(guard({ templateFingerprint: "fp-1", fetchTemplates: withDigest(undefined) })).resolves.toBe("ok");
    await expect(guard({ templateFingerprint: undefined, fetchTemplates: withDigest("fp-2") })).resolves.toBe("ok");
  });
});
