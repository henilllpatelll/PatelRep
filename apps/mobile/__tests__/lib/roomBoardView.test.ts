import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { buildBoardMetrics } from "@/lib/housekeeping/roomBoardSelectors";
import type { BoardAvailability, BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import {
  BOARD_SEGMENTS,
  buildAttentionSignals,
  buildBoardSummary,
  buildTileModel,
  describeAge,
  describeBoardStatus,
  flattenBoard,
  gridColumns,
  groupBoard,
  inSegment,
  segmentCounts,
  type BoardListItem,
} from "@/lib/housekeeping/roomBoardView";
import { buildReadinessSummary } from "@/lib/housekeeping/supervisorToday";
import { HOTEL_DATE, NOW, ZONE, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);
const ctx = { now: NOW, timeZone: ZONE, language: "en", t };

function views(rows: ReturnType<typeof rawRoom>[], names: Record<string, string> = {}): BoardRoomView[] {
  return normalizeBoardRecords(rows, HOTEL_DATE).rooms.map((room) => ({
    room,
    assignee: room.assignment.userId
      ? { userId: room.assignment.userId, name: names[room.assignment.userId] ?? null, availability: "unknown" as const }
      : null,
  }));
}

const tile = (rows: ReturnType<typeof rawRoom>[], names: Record<string, string> = {}) => buildTileModel(views(rows, names)[0], ctx);
const rowNumbers = (items: BoardListItem[]) =>
  items.filter((item): item is Extract<BoardListItem, { type: "row" }> => item.type === "row").flatMap((item) => item.views.map((v) => v.room.roomNumber));

describe("status segments", () => {
  const all = views(hotelBoard());
  const inSeg = (segment: (typeof BOARD_SEGMENTS)[number]) => all.filter((v) => inSegment(v.room.statusInfo.stage, segment)).map((v) => v.room.roomNumber);

  it("maps CLEAN to To inspect, IN_PROGRESS to Working, INSPECTED to Ready, and the rest of the work to To clean", () => {
    expect(inSeg("toInspect")).toEqual(["105"]);
    expect(inSeg("working")).toEqual(["104"]);
    expect(inSeg("ready")).toEqual(["106"]);
    expect(inSeg("toClean").sort()).toEqual(["101", "102", "103", "201"]);
  });

  it("keeps out-of-service rooms (all three spellings) visible only in All", () => {
    expect(inSeg("all")).toHaveLength(10);
    for (const segment of ["toClean", "working", "toInspect", "ready"] as const) {
      expect(inSeg(segment)).not.toEqual(expect.arrayContaining(["107"]));
      expect(inSeg(segment)).not.toEqual(expect.arrayContaining(["108"]));
      expect(inSeg(segment)).not.toEqual(expect.arrayContaining(["109"]));
    }
  });

  it("counts every room exactly once: segments + out of service + unrecognised = inventory", () => {
    const rows = [...hotelBoard(), rawRoom("301", "MYSTERY")];
    const metrics = buildBoardSummary(views(rows));
    const counts = segmentCounts(metrics);
    expect(counts.all).toBe(11);
    expect(counts.toClean + counts.working + counts.toInspect + counts.ready + metrics.unavailable + metrics.unknown).toBe(counts.all);
    expect(metrics.unknown).toBe(1);
  });

  it("an unrecognised status shows in All only and is counted, never folded into another segment", () => {
    const [mystery] = views([rawRoom("301", "MYSTERY")]);
    expect(mystery.room.statusInfo.stage).toBe("unknown");
    for (const segment of ["toClean", "working", "toInspect", "ready"] as const) expect(inSegment("unknown", segment)).toBe(false);
    expect(inSegment("unknown", "all")).toBe(true);
  });

  it("agrees with the Supervisor Today readiness summary for the same rooms", () => {
    const rooms = normalizeBoardRecords(hotelBoard(), HOTEL_DATE).rooms;
    const summary = buildReadinessSummary(rooms, { nowMs: NOW, timeZone: ZONE });
    const metrics = buildBoardMetrics(rooms);
    expect(metrics.inService).toBe(summary.inService);
    expect(metrics.guestReady).toBe(summary.ready);
    expect(metrics.awaitingInspection).toBe(summary.awaitingInspection);
    expect(metrics.inProgress).toBe(summary.inProgress);
    expect(metrics.toClean).toBe(summary.toClean);
    expect(metrics.unavailable).toBe(summary.outOfOrder);
    expect(metrics.unknown).toBe(summary.unclassified);
  });

  it("has no readiness percentage when nothing is in service", () => {
    const metrics = buildBoardSummary(views([rawRoom("101", "OOO"), rawRoom("102", "OUT_OF_SERVICE")]));
    expect(metrics.inService).toBe(0);
    expect(metrics.readiness).toBeNull();
  });
});

describe("flattenBoard", () => {
  it("lists one building's floors in numeric order with no building heading", () => {
    const rows = [rawRoom("301", "DIRTY"), rawRoom("101", "DIRTY"), rawRoom("1001", "DIRTY"), rawRoom("201", "DIRTY")];
    const items = flattenBoard(groupBoard(views(rows)), "all", 2);
    expect(items.some((item) => item.type === "building")).toBe(false);
    expect(items.filter((item) => item.type === "floor").map((item) => (item as { floor: number }).floor)).toEqual([1, 2, 3, 10]);
  });

  it("adds building headings only for a multi-building hotel", () => {
    const items = flattenBoard(groupBoard(views(hotelBoard())), "all", 2);
    expect(items.filter((item) => item.type === "building").map((item) => (item as { building: string | null }).building)).toEqual(["A", "B"]);
  });

  it("puts rooms with no floor in their own trailing group, never on floor 0", () => {
    const noFloor = rawRoom("X1", "DIRTY", { rooms: { id: "room-X1", room_number: "X1", building: "A" } as never });
    const items = flattenBoard(groupBoard(views([noFloor, rawRoom("101", "DIRTY")])), "all", 2);
    const floors = items.filter((item) => item.type === "floor") as Array<{ floor: number | null }>;
    expect(floors.map((f) => f.floor)).toEqual([1, null]);
  });

  it("sorts room numbers naturally, including non-numeric identifiers", () => {
    const rows = ["110", "12", "2", "10B", "10A", "PH1"].map((n) => rawRoom(n, "DIRTY", { rooms: { id: `room-${n}`, room_number: n, floor: 1, building: "A" } as never }));
    const items = flattenBoard(groupBoard(views(rows)), "all", 3);
    expect(rowNumbers(items)).toEqual(["2", "10A", "10B", "12", "110", "PH1"]);
  });

  it("chunks rooms into rows of `columns` and reports shown / total per floor", () => {
    const rows = ["101", "102", "103", "104", "105"].map((n, i) => rawRoom(n, i < 2 ? "INSPECTED" : "DIRTY"));
    const all = flattenBoard(groupBoard(views(rows)), "all", 2);
    expect(all.filter((item) => item.type === "row").map((item) => (item as { views: unknown[] }).views.length)).toEqual([2, 2, 1]);
    const ready = flattenBoard(groupBoard(views(rows)), "ready", 2);
    expect(ready.find((item) => item.type === "floor")).toMatchObject({ shown: 2, total: 5 });
  });

  it("drops floors and buildings that are empty in the segment, and returns [] for an empty segment", () => {
    const groups = groupBoard(views(hotelBoard()));
    const ready = flattenBoard(groups, "ready", 2);
    expect(ready.some((item) => item.type === "building")).toBe(true); // still a two-building hotel
    expect(ready.filter((item) => item.type === "floor")).toHaveLength(1);
    expect(flattenBoard(groupBoard(views([rawRoom("101", "DIRTY")])), "ready", 2)).toEqual([]);
  });

  it("gives every item a unique, stable key that survives a status change", () => {
    const before = flattenBoard(groupBoard(views([rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY"), rawRoom("201", "DIRTY")])), "all", 2);
    const after = flattenBoard(groupBoard(views([rawRoom("101", "IN_PROGRESS"), rawRoom("102", "DIRTY"), rawRoom("201", "INSPECTED")])), "all", 2);
    expect(new Set(before.map((i) => i.key)).size).toBe(before.length);
    expect(after.map((i) => i.key)).toEqual(before.map((i) => i.key));
  });

  it("handles a large inventory in one pass", () => {
    const rows = Array.from({ length: 600 }, (_, i) => rawRoom(String(100 * (Math.floor(i / 30) + 1) + (i % 30) + 1), ["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO"][i % 5]));
    const items = flattenBoard(groupBoard(views(rows)), "all", 2);
    expect(rowNumbers(items)).toHaveLength(600);
    expect(items.filter((item) => item.type === "floor")).toHaveLength(20);
    expect(items.filter((item) => item.type === "row")).toHaveLength(300);
  });
});

describe("gridColumns", () => {
  it("uses two columns on ordinary phones, even narrow ones", () => {
    expect(gridColumns(390, 1)).toBe(2);
    expect(gridColumns(360, 1)).toBe(2);
    expect(gridColumns(320, 1)).toBe(2);
  });
  it("falls back to one wide column for large text, so room numbers never clip", () => {
    expect(gridColumns(390, 1.3)).toBe(1);
    expect(gridColumns(360, 2)).toBe(1);
  });
  it("adds columns on tablets", () => {
    expect(gridColumns(768, 1)).toBeGreaterThanOrEqual(4);
    expect(gridColumns(4000, 1)).toBe(6);
  });
  it("is safe on nonsense input", () => {
    expect(gridColumns(0, 1)).toBe(2);
    expect(gridColumns(Number.NaN, Number.NaN)).toBe(2);
    expect(gridColumns(390, Number.NaN)).toBe(2);
  });
});

describe("describeBoardStatus", () => {
  const base = { refreshing: false, isOnline: true, now: NOW };
  const verifiedAt = NOW - 20_000;
  const cases: Array<[string, BoardAvailability, Partial<typeof base>, string]> = [
    ["loading", { kind: "loading" }, {}, "loading"],
    ["fresh verified board", { kind: "ready", verifiedAt }, {}, "live"],
    ["verified empty board", { kind: "verified_empty", verifiedAt }, {}, "live"],
    ["refresh in flight", { kind: "ready", verifiedAt }, { refreshing: true }, "updating"],
    ["stale (age)", { kind: "stale", reason: "age" as never, verifiedAt, failure: null }, {}, "stale"],
    ["stale (refresh failed)", { kind: "stale", reason: "refresh_failed" as never, verifiedAt, failure: null }, {}, "stale"],
    ["stale (offline)", { kind: "stale", reason: "offline" as never, verifiedAt, failure: null }, {}, "offline"],
    ["verified but the device is offline", { kind: "ready", verifiedAt }, { isOnline: false }, "offline"],
    ["unavailable (error)", { kind: "unavailable", cause: "error", failure: null }, {}, "unavailable"],
    ["unavailable (offline)", { kind: "unavailable", cause: "offline", failure: null }, {}, "offline"],
    ["an earlier day", { kind: "previous_day", boardDate: "2026-10-15", hotelDate: HOTEL_DATE, verifiedAt }, {}, "previous_day"],
  ];
  it.each(cases)("%s", (_name, availability, override, kind) => {
    expect(describeBoardStatus(availability, { ...base, ...override }).kind).toBe(kind);
  });

  it("reports the real verified age, never a made-up one", () => {
    expect(describeBoardStatus({ kind: "ready", verifiedAt }, base)).toEqual({ kind: "live", ageMs: 20_000 });
    expect(describeBoardStatus({ kind: "ready", verifiedAt: NOW + 5_000 }, base)).toEqual({ kind: "live", ageMs: 0 });
  });

  it("never calls a stale, failed or earlier-day board live", () => {
    for (const [, availability, override, kind] of cases) if (kind !== "live") expect(describeBoardStatus(availability, { ...base, ...override }).kind).not.toBe("live");
  });

  it("describes ages in just-now / seconds / minutes, then falls back to a clock time", () => {
    expect(describeAge(2_000)).toEqual({ unit: "now" });
    expect(describeAge(20_000)).toEqual({ unit: "seconds", value: 20 });
    expect(describeAge(3 * 60_000 + 5_000)).toEqual({ unit: "minutes", value: 3 });
    expect(describeAge(61 * 60_000)).toBeNull();
  });
});

describe("attention signals", () => {
  it("lists only non-zero, substantiated signals", () => {
    const v = views([rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY", { dnd_flag: true }), rawRoom("103", "INSPECTED")]);
    const signals = buildAttentionSignals(v, buildBoardSummary(v), NOW, ZONE);
    expect(signals).toEqual([
      { key: "unassigned", count: 2 },
      { key: "dnd", count: 1 },
    ]);
  });

  it("shows nothing when nothing needs attention", () => {
    const v = views([rawRoom("103", "INSPECTED"), rawRoom("104", "OOO")]);
    expect(buildAttentionSignals(v, buildBoardSummary(v), NOW, ZONE)).toEqual([]);
  });

  it("counts urgent only from recorded facts: a VIP room that is not ready, a reclean request, an elevated priority", () => {
    const v = views([
      rawRoom("101", "DIRTY", { vip_flag: true }),
      rawRoom("102", "DIRTY", { reclean_requested_at: "2026-10-16T15:00:00Z" } as never),
      rawRoom("103", "DIRTY", { priority: 2 }),
      rawRoom("104", "DIRTY"),
      rawRoom("105", "INSPECTED", { vip_flag: true }),
    ]);
    const urgent = buildAttentionSignals(v, buildBoardSummary(v), NOW, ZONE).find((s) => s.key === "urgent");
    expect(urgent?.count).toBe(3);
  });

  it("does not count an out-of-service room as unassigned work", () => {
    const v = views([rawRoom("101", "OOO"), rawRoom("102", "OUT_OF_ORDER")]);
    expect(buildAttentionSignals(v, buildBoardSummary(v), NOW, ZONE).find((s) => s.key === "unassigned")).toBeUndefined();
  });
});

describe("buildTileModel", () => {
  it("dirty + VIP + arrival today: status, 'Unassigned', and the two most important details", () => {
    const model = tile([rawRoom("201", "DIRTY", { vip_flag: true, checkin_time: "2026-10-16T19:00:00Z" } as never)]);
    expect(model.statusLabel).toBe("roomBoard.card.status.DIRTY");
    expect(model.assignee).toEqual({ kind: "none", text: "roomBoard.unassigned" });
    expect(model.details).toEqual(["roomBoard.card.detail.vip", `roomBoard.card.detail.arrival:${JSON.stringify({ time: "2:00 PM" })}`]);
    expect(model.flags.vip).toBe(true);
  });

  it("in progress: the housekeeper's name and the base detail", () => {
    const model = tile([rawRoom("202", "IN_PROGRESS", { assigned_to: "hk-1", assignment_id: "a1" })], { "hk-1": "Ana Torres" });
    expect(model.statusLabel).toBe("roomBoard.card.status.IN_PROGRESS");
    expect(model.assignee).toEqual({ kind: "named", text: "Ana Torres" });
    expect(model.details).toEqual(["roomBoard.card.base.IN_PROGRESS"]);
  });

  it("CLEAN reads 'to inspect', not clean/ready; INSPECTED reads 'ready'", () => {
    expect(tile([rawRoom("203", "CLEAN")]).statusLabel).toBe("roomBoard.card.status.CLEAN");
    expect(tile([rawRoom("203", "CLEAN")]).details).toEqual(["roomBoard.card.base.CLEAN"]);
    expect(tile([rawRoom("204", "INSPECTED")]).statusLabel).toBe("roomBoard.card.status.INSPECTED");
    expect(tile([rawRoom("204", "INSPECTED")]).icon).toBe("checkmark-circle");
  });

  it("an assigned room whose name is unknown is ASSIGNED, never 'Unassigned'", () => {
    const model = tile([rawRoom("205", "DIRTY", { assigned_to: "ghost", assignment_id: "a9" })]);
    expect(model.assignee).toEqual({ kind: "unnamed", text: "roomBoard.assigneeUnknown" });
    expect(model.accessibilityLabel).not.toContain("roomBoard.unassigned");
  });

  it("out of service: no assignment line unless someone is tied to it; the work-order title is the reason", () => {
    const plain = tile([rawRoom("206", "OUT_OF_ORDER")]);
    expect(plain.assignee).toEqual({ kind: "hidden", text: null });
    expect(plain.details).toEqual(["roomBoard.card.detail.unavailable"]);
    const withReason = tile([rawRoom("206", "OOO", { open_work_order_id: "w1", open_work_order_title: "Leaking pipe" } as never)]);
    expect(withReason.details[0]).toBe("Leaking pipe");
    expect(tile([rawRoom("207", "OUT_OF_SERVICE")]).statusLabel).toBe("roomBoard.card.status.OUT_OF_SERVICE");
  });

  it("omits a detail rather than inventing it: no arrival when none is recorded or it is not today", () => {
    expect(tile([rawRoom("208", "DIRTY")]).details).toEqual(["roomBoard.card.base.DIRTY"]);
    const yesterday = tile([rawRoom("208", "DIRTY", { checkin_time: "2026-10-15T19:00:00Z" } as never)]);
    expect(yesterday.details).toEqual(["roomBoard.card.base.DIRTY"]);
    const junk = tile([rawRoom("208", "DIRTY", { checkin_time: "not a date" } as never)]);
    expect(junk.details).toEqual(["roomBoard.card.base.DIRTY"]);
  });

  it("shows at most two details", () => {
    const model = tile([rawRoom("209", "DIRTY", { vip_flag: true, dnd_flag: true, do_not_service: true, checkin_time: "2026-10-16T19:00:00Z" } as never)]);
    expect(model.details).toHaveLength(2);
  });

  it("an unrecognised status is labelled unknown and keeps the raw value for colouring", () => {
    const model = tile([rawRoom("210", "MYSTERY")]);
    expect(model.statusLabel).toBe("roomBoard.card.status.UNKNOWN");
    expect(model.rawStatus).toBe("MYSTERY");
    expect(model.icon).toBe("help-circle-outline");
  });

  it("missing room fields never throw and never show a guest name", () => {
    const sparse = rawRoom("211", "DIRTY", { guest_name: "Jane Doe", fo_status: undefined, priority: undefined } as never);
    const model = buildTileModel(views([sparse])[0], ctx);
    expect(JSON.stringify(model)).not.toContain("Jane");
  });

  it("announces room, status, assignment and details in one accessibility label", () => {
    const model = tile([rawRoom("201", "DIRTY", { vip_flag: true })]);
    expect(model.accessibilityLabel).toBe(
      [`roomBoard.card.roomLabel:${JSON.stringify({ room: "201" })}`, "roomBoard.card.status.DIRTY", "roomBoard.unassigned", "roomBoard.card.detail.vip"].join(", "),
    );
  });

  it("changes its signature only when something visible changes", () => {
    const a = tile([rawRoom("201", "DIRTY")]);
    expect(tile([rawRoom("201", "DIRTY")]).signature).toBe(a.signature);
    expect(tile([rawRoom("201", "IN_PROGRESS")]).signature).not.toBe(a.signature);
    expect(tile([rawRoom("201", "DIRTY", { dnd_flag: true })]).signature).not.toBe(a.signature);
    expect(tile([rawRoom("201", "DIRTY", { assigned_to: "hk-1", assignment_id: "a" })], { "hk-1": "Ana" }).signature).not.toBe(a.signature);
  });
});

describe("translations for the dynamic tile keys", () => {
  const codes = ["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE", "UNKNOWN"];
  const node = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((n, part) => (n as Record<string, unknown> | undefined)?.[part], tree);
  it.each(codes)("%s has a status label and a base detail in both languages", (code) => {
    for (const prefix of ["roomBoard.card.status", "roomBoard.card.base"]) {
      expect(typeof node(en, `${prefix}.${code}`)).toBe("string");
      expect(typeof node(es, `${prefix}.${code}`)).toBe("string");
    }
  });
  it.each(BOARD_SEGMENTS)("segment %s has a label in both languages", (segment) => {
    expect(typeof node(en, `roomBoard.seg.${segment}`)).toBe("string");
    expect(typeof node(es, `roomBoard.seg.${segment}`)).toBe("string");
  });
});
