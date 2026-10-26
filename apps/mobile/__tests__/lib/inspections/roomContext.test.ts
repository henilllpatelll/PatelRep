import type { CleanSessionRaw, RoomHistoryRow, RoomInspectionRaw } from "@/lib/api/roomPanels";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";
import { latestInspection, matchingCleanSession, openWorkOrders, recentNotes } from "@/lib/inspections/roomContext";
import { makeTranslator } from "../../helpers/i18n";

const NOW = Date.parse("2026-10-20T18:00:00Z");
const ctx: HistoryContext = { now: NOW, timeZone: "America/Chicago", language: "en", t: makeTranslator("en"), nameOf: () => null };
const cleanedAt = Date.parse("2026-10-20T16:42:00Z");

const session = (over: Partial<CleanSessionRaw> = {}): CleanSessionRaw => ({
  id: "s1", status: "completed", ended_at: "2026-10-20T16:42:30Z", duration_seconds: 1920, checklist_done: 11, checklist_total: 12, ...over,
});

describe("the cleaning session behind this clean", () => {
  it("is the completed session that ended when the room became CLEAN", () => {
    expect(matchingCleanSession([session()], cleanedAt)).toEqual({ minutes: 32, checklistDone: 11, checklistTotal: 12 });
  });

  it("picks the closest of several, ignores unfinished ones, and never guesses across a long gap", () => {
    const rows = [session({ id: "old", ended_at: "2026-10-20T09:00:00Z" }), session({ id: "active", status: "active", ended_at: null }), session({ id: "near", ended_at: "2026-10-20T16:50:00Z", duration_seconds: 600 })];
    expect(matchingCleanSession(rows, cleanedAt)?.minutes).toBe(10);
    expect(matchingCleanSession([session({ ended_at: "2026-10-20T09:00:00Z" })], cleanedAt)).toBeNull();
    expect(matchingCleanSession([session()], null)).toBeNull();
  });

  it("a missing figure stays missing", () => {
    expect(matchingCleanSession([session({ duration_seconds: null, checklist_total: 0 })], cleanedAt)).toEqual({ minutes: null, checklistDone: 11, checklistTotal: null });
  });
});

describe("recent notes", () => {
  const note = (id: string, text: string, at: string, over: Partial<RoomHistoryRow> = {}): RoomHistoryRow => ({ id, notes: text, from_status: "CLEAN", to_status: "CLEAN", created_at: at, actor_name: "Hana", ...over });

  it("lists the newest notes, never status changes, and counts the rest", () => {
    const rows = [
      note("1", "old", "2026-10-18T10:00:00Z"),
      note("2", "mid", "2026-10-19T10:00:00Z"),
      note("3", "new", "2026-10-20T15:00:00Z"),
      note("4", "newer", "2026-10-20T16:00:00Z"),
      { id: "5", from_status: "DIRTY", to_status: "CLEAN", notes: "status change", created_at: "2026-10-20T17:00:00Z" } as RoomHistoryRow,
    ];
    const { notes, more } = recentNotes(rows, ctx);
    expect(notes.map((n) => n.text)).toEqual(["newer", "new", "mid"]);
    expect(more).toBe(1);
  });

  it("an unnamed author is null, never an id", () => {
    const { notes } = recentNotes([note("1", "hi", "2026-10-20T15:00:00Z", { actor_name: null, changed_by: "9f8e7d6c-1234" })], ctx);
    expect(notes[0].author).toBeNull();
  });
});

describe("open work orders", () => {
  const wo = (id: string, status: string, priority: string, created: string): WorkOrder => ({ id, title: `WO ${id}`, status, priority, created_at: created, work_order_number: `N${id}` } as WorkOrder);

  it("shows only open work, most urgent first, with the real status and priority", () => {
    const rows = [wo("a", "completed", "urgent", "2026-10-01"), wo("b", "open", "low", "2026-10-02"), wo("c", "in_progress", "emergency", "2026-10-03"), wo("d", "cancelled", "normal", "2026-10-04"), wo("e", "on_hold", "normal", "2026-10-05")];
    const { orders, total, mayBeMore } = openWorkOrders(rows, 50);
    expect(orders.map((o) => [o.id, o.status, o.priority])).toEqual([["c", "in_progress", "emergency"], ["e", "on_hold", "normal"], ["b", "open", "low"]]);
    expect(total).toBe(3);
    expect(mayBeMore).toBe(false);
  });

  it("says when the read hit the server's page ceiling, so 'none' is not over-claimed", () => {
    const rows = Array.from({ length: 50 }, (_, i) => wo(String(i), "completed", "low", "2026-10-01"));
    expect(openWorkOrders(rows, 50)).toMatchObject({ orders: [], total: 0, mayBeMore: true });
  });

  it("caps the list and keeps the count", () => {
    const rows = Array.from({ length: 8 }, (_, i) => wo(String(i), "open", "normal", `2026-10-0${i + 1}`));
    const { orders, total } = openWorkOrders(rows, 50);
    expect(orders).toHaveLength(5);
    expect(total).toBe(8);
  });
});

describe("the previous inspection", () => {
  const row = (id: string, result: string, at: string, inspector: string | null): RoomInspectionRaw => ({ id, overall_result: result, completed_at: at, inspector_name: inspector, notes: null });

  it("is the newest record, with a real inspector name or none", () => {
    const rows = [row("a", "passed", "2026-10-10T10:00:00Z", "Sam"), row("b", "failed", "2026-10-19T10:00:00Z", "a1b2c3d4")];
    const last = latestInspection(rows, ctx);
    expect(last).toMatchObject({ id: "b", result: "failed", inspector: null }); // an id fragment is not a name
    expect(latestInspection([], ctx)).toBeNull();
  });
});
