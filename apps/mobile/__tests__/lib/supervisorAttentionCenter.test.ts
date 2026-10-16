import fs from "fs";
import path from "path";
import type { BlockedTaskItem, TaskBlocker } from "@/lib/api/tasks";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { buildSupervisorAttention, selectAttentionPreview, type SupervisorAttentionKind } from "@/lib/housekeeping/supervisorAttention";
import {
  CATEGORY_OF,
  DETAIL_RECORD_LIMIT,
  attentionListState,
  buildAttentionCenter,
  describeCard,
  itemsForFilter,
  partialNotices,
  primaryFor,
  resolveAttentionDetail,
  translateParams,
  visibleFilters,
  type AttentionFilter,
} from "@/lib/housekeeping/supervisorAttentionCenter";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { initialTodaySources, normalizeBoard, type TodaySources } from "@/lib/housekeeping/supervisorToday";
import { HOUSEKEEPER_ONLY_PATH_PREFIXES, isSupervisorSafePath } from "@/lib/navigation/supervisorRoutes";
import { localeHasKey, makeTranslator } from "../helpers/i18n";

// 12:00 in Chicago (CDT) on 2026-10-16.
const NOW = Date.parse("2026-10-16T17:00:00Z");
const ZONE = "America/Chicago";
const minutesFromNow = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const t = makeTranslator("en");

function raw(roomId: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: roomId, status, rooms: { id: roomId, room_number: roomId.replace("r-", ""), floor: 1 }, ...extra };
}

function blocker(id: string, overrides: Partial<TaskBlocker> = {}): TaskBlocker {
  return {
    id,
    reason: "missing_supplies",
    details: "No towels on the cart",
    reported_by: "hk-1",
    reported_by_name: "Ana",
    reported_at: "2026-10-16T15:00:00Z",
    status: "active",
    notification_status: "queued",
    ...overrides,
  };
}

function blockedTask(blockerId: string, overrides: Partial<TaskBlocker> = {}, priority: "urgent" | "normal" | "low" = "normal"): BlockedTaskItem {
  return {
    blocker: blocker(blockerId, overrides),
    task: { id: `t-${blockerId}`, title: "Restock 204", task_type: "housekeeping", priority, assigned_to_name: "Ana", room_number: "204", location_text: null },
  };
}

function sourcesWith(rooms: BoardRoomRaw[], extra: Partial<TodaySources> = {}): TodaySources {
  return {
    ...initialTodaySources(),
    board: availableSource(normalizeBoard(rooms), NOW, (b) => b.rooms.length === 0),
    staff: availableSource([{ userId: "hk-1", name: "Ana", role: "housekeeper" }, { userId: "hk-2", name: "Bea", role: "housekeeper" }], NOW),
    roster: availableSource<RosterEntry[]>([], NOW),
    inspections: availableSource([], NOW),
    blockedTasks: availableSource<BlockedTaskItem[]>([], NOW),
    ...extra,
  };
}

const attentionOf = (sources: TodaySources) => buildSupervisorAttention(sources, { now: NOW, timeZone: ZONE });
const ctx = { now: NOW, zone: ZONE, language: "en", someone: "A housekeeper" };

/** One of every supported item kind except workload. */
const BUSY_ROOMS = [
  raw("r-301", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(40), assigned_to: "hk-1" }), // arrival, critical
  raw("r-302", "DIRTY", { assigned_to: "hk-1", prediction: { risk_level: "HIGH" } }), // readiness risk
  raw("r-303", "DIRTY"), // unassigned
  raw("r-304", "OCCUPIED"), // unassigned
  raw("r-305", "CLEAN", { assigned_to: "hk-1" }), // awaiting inspection
  raw("r-306", "CLEAN", { assigned_to: "hk-1" }), // awaiting inspection
  raw("r-307", "DIRTY", { dnd_flag: true, assigned_to: "hk-1" }), // access restricted
  raw("r-308", "INSPECTED"),
  raw("r-309", "DIRTY", { assigned_to: "hk-2" }), // hk-2 clocked out with this open
];
const BUSY_ROSTER = availableSource<RosterEntry[]>([{ userId: "hk-2", availability: "ended", startedAt: "2026-10-16T12:00:00Z", onBreakSince: null }], NOW);
const BUSY = sourcesWith(BUSY_ROOMS, { roster: BUSY_ROSTER, blockedTasks: availableSource([blockedTask("b-1", {}, "urgent")], NOW) });

describe("categories", () => {
  it("gives every item kind exactly one primary category", () => {
    const kinds = Object.keys(CATEGORY_OF) as SupervisorAttentionKind[];
    expect(kinds.sort()).toEqual(
      ["access_restricted", "arrival_at_risk", "awaiting_inspection", "message", "readiness_risk", "shift_ended_with_open_rooms", "task_blocker", "unassigned_rooms", "workload_over_assigned"].sort(),
    );
    expect(CATEGORY_OF.arrival_at_risk).toBe("rooms");
    expect(CATEGORY_OF.access_restricted).toBe("rooms");
    expect(CATEGORY_OF.unassigned_rooms).toBe("team");
    expect(CATEGORY_OF.shift_ended_with_open_rooms).toBe("team");
    expect(CATEGORY_OF.awaiting_inspection).toBe("inspect");
    expect(CATEGORY_OF.task_blocker).toBe("issues");
  });

  it("partitions the list: category counts add up to All, and nothing is counted twice", () => {
    const center = buildAttentionCenter(attentionOf(BUSY));
    const { all, urgent, rooms, team, inspect, issues, messages } = center.counts;
    expect(all).toBe(center.items.length);
    expect(rooms + team + inspect + issues + messages).toBe(all);
    expect(new Set(center.items.map((i) => i.id)).size).toBe(all);
    // Urgent is a view across categories, not a category.
    expect(urgent).toBe(center.items.filter((i) => i.severity === "critical").length);
    expect(urgent).toBeLessThanOrEqual(all);
  });

  it("does not report one room twice: an arrival-risk room is not also a readiness risk", () => {
    const rooms = [raw("r-301", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(40), assigned_to: "hk-1", prediction: { risk_level: "HIGH" } })];
    const kinds = attentionOf(sourcesWith(rooms)).items.map((i) => i.kind);
    expect(kinds).toEqual(["arrival_at_risk"]);
  });

  it("counts an aggregated queue as one item that carries every underlying room", () => {
    const center = buildAttentionCenter(attentionOf(BUSY));
    const unassigned = center.items.find((i) => i.kind === "unassigned_rooms");
    const inspect = center.items.find((i) => i.kind === "awaiting_inspection");
    expect(unassigned?.records.map((r) => r.label)).toEqual(["303", "304"]);
    expect(unassigned?.explain.params.count).toBe(2);
    expect(inspect?.records.map((r) => r.label)).toEqual(["305", "306"]);
    expect(inspect?.explain.params.count).toBe(2);
    // The header count is items, not rooms: two queues of two rooms are two items.
    expect(center.items.filter((i) => i.kind === "unassigned_rooms" || i.kind === "awaiting_inspection")).toHaveLength(2);
  });

  it("counts pending inspections from CLEAN rooms only — an INSPECTED room is not pending", () => {
    const sources = sourcesWith([raw("r-1", "CLEAN"), raw("r-2", "CLEAN"), raw("r-3", "CLEAN"), raw("r-4", "INSPECTED"), raw("r-5", "DIRTY", { assigned_to: "hk-1" })]);
    const item = attentionOf(sources).items.find((i) => i.kind === "awaiting_inspection");
    expect(item?.records).toHaveLength(3);
  });

  it("counts unassigned rooms from rooms that still need cleaning, not from ready, clean or out-of-order rooms", () => {
    const sources = sourcesWith([raw("r-1", "DIRTY"), raw("r-2", "IN_PROGRESS"), raw("r-3", "INSPECTED"), raw("r-4", "CLEAN"), raw("r-5", "OOO"), raw("r-6", "DIRTY", { assigned_to: "hk-1" })]);
    const item = attentionOf(sources).items.find((i) => i.kind === "unassigned_rooms");
    expect(item?.records.map((r) => r.label)).toEqual(["1", "2"]);
  });

  it("shows a blocker only while it is unresolved", () => {
    const resolved = sourcesWith([], { blockedTasks: availableSource([blockedTask("b-2", { status: "resolved" })], NOW) });
    expect(attentionOf(resolved).items).toEqual([]);
    const active = sourcesWith([], { blockedTasks: availableSource([blockedTask("b-3")], NOW) });
    expect(attentionOf(active).items.map((i) => i.id)).toEqual(["blocker:b-3"]);
  });
});

describe("ordering and identity", () => {
  it("orders by verified urgency: critical first, then kind, then a stable id", () => {
    const items = buildAttentionCenter(attentionOf(BUSY)).items;
    const rank = { critical: 0, high: 1, normal: 2 } as const;
    for (let i = 1; i < items.length; i += 1) expect(rank[items[i - 1].severity]).toBeLessThanOrEqual(rank[items[i].severity]);
    expect(items[0].severity).toBe("critical");
    expect(items.slice(0, 2).map((i) => i.kind).sort()).toEqual(["arrival_at_risk", "task_blocker"]);
  });

  it("keeps ids stable across rebuilds and refreshes", () => {
    const first = buildAttentionCenter(attentionOf(BUSY)).items.map((i) => i.id);
    const second = buildAttentionCenter(attentionOf({ ...BUSY, board: availableSource(normalizeBoard(BUSY_ROOMS), NOW + 60_000, (b) => b.rooms.length === 0) })).items.map((i) => i.id);
    expect(second).toEqual(first);
    expect(first).toContain("room:r-301:arrival_at_risk");
    expect(first).toContain("queue:unassigned_rooms");
    expect(first).toContain("blocker:b-1");
  });

  it("is a function of the operational records alone: a read notification cannot resolve or create an item", () => {
    // The builder's only inputs are the five operational sources; there is no notification input to flip.
    expect(Object.keys(initialTodaySources()).sort()).toEqual(["blockedTasks", "board", "inspections", "roster", "staff"]);
    const before = buildAttentionCenter(attentionOf(BUSY));
    const after = buildAttentionCenter(attentionOf(BUSY));
    expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(before.items.every((i) => !i.records.some((r) => r.type === "notification"))).toBe(true);
  });

  it("uses the same list and order as Today's preview", () => {
    const attention = attentionOf(BUSY);
    const center = buildAttentionCenter(attention);
    const preview = selectAttentionPreview(attention, 3);
    expect(preview.items.map((i) => i.id)).toEqual(center.items.slice(0, 3).map((i) => i.id));
    expect(preview.hiddenCount + preview.items.length).toBe(center.counts.all);
  });

  it("never invents urgency: no recorded arrival, a far-off arrival or another day's arrival raises nothing", () => {
    const rooms = [
      raw("r-1", "DIRTY", { fo_status: "VAC", assigned_to: "hk-1" }),
      raw("r-2", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(60 * 6), assigned_to: "hk-1" }),
      raw("r-3", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(60 * 30), assigned_to: "hk-1" }),
    ];
    expect(attentionOf(sourcesWith(rooms)).items).toEqual([]);
  });
});

describe("filters", () => {
  const center = buildAttentionCenter(attentionOf(BUSY));

  it("All is everything; Urgent is the critical subset; categories partition", () => {
    expect(itemsForFilter(center, "all")).toHaveLength(center.counts.all);
    expect(itemsForFilter(center, "urgent").every((i) => i.severity === "critical")).toBe(true);
    for (const filter of ["rooms", "team", "inspect", "issues"] as AttentionFilter[]) {
      expect(itemsForFilter(center, filter)).toHaveLength(center.counts[filter]);
      expect(itemsForFilter(center, filter).every((i) => CATEGORY_OF[i.kind] === filter)).toBe(true);
    }
  });

  it("keeps the shared order inside every filter", () => {
    const order = center.items.map((i) => i.id);
    for (const filter of center.filters) {
      const ids = itemsForFilter(center, filter).map((i) => i.id);
      expect(ids).toEqual(order.filter((id) => ids.includes(id)));
    }
  });

  it("offers only filters with data, and keeps a selected one even when a refresh emptied it", () => {
    expect(center.filters).toEqual(["all", "urgent", "rooms", "team", "inspect", "issues"]);
    expect(center.filters).not.toContain("messages");
    const quiet = buildAttentionCenter(attentionOf(sourcesWith([raw("r-1", "CLEAN")])));
    expect(quiet.filters).toEqual(["all", "inspect"]);
    expect(visibleFilters(quiet, "issues")).toEqual(["all", "inspect", "issues"]);
  });

  it("an emptied filter is empty — it never falls back to unrelated items", () => {
    const quiet = buildAttentionCenter(attentionOf(sourcesWith([raw("r-1", "CLEAN")])));
    expect(itemsForFilter(quiet, "issues")).toEqual([]);
    expect(attentionListState(quiet, "issues", sourcesWith([raw("r-1", "CLEAN")]))).toBe("filter_empty");
    expect(attentionListState(quiet, "all", sourcesWith([raw("r-1", "CLEAN")]))).toBe("list");
  });
});

describe("list state — honest empties", () => {
  const sources = (extra: Partial<TodaySources> = {}) => sourcesWith([raw("r-1", "INSPECTED")], extra);
  const stateOf = (s: TodaySources, filter: AttentionFilter = "all") => attentionListState(buildAttentionCenter(attentionOf(s)), filter, s);

  it("says caught up only when the board and blockers were both verified", () => {
    expect(stateOf(sources())).toBe("caught_up");
  });

  it("is loading before anything has answered", () => {
    expect(stateOf(initialTodaySources())).toBe("loading");
  });

  it("is unavailable — not zero — when nothing could be loaded", () => {
    const failed = sources({ board: failedSource({ status: 500 }, loadingSource()), blockedTasks: failedSource({ status: 500 }, loadingSource()) });
    expect(stateOf(failed)).toBe("unavailable");
  });

  it("does not claim all clear when one source failed or the answer is stale", () => {
    expect(stateOf(sources({ blockedTasks: failedSource({ status: 500 }, loadingSource()) }))).toBe("unconfirmed_empty");
    const stale = { status: "stale" as const, data: null, fetchedAt: NOW - 600_000, reason: "age" as const, failure: null };
    expect(stateOf(sources({ board: stale }))).toBe("unconfirmed_empty");
  });

  it("still shows the items it has when another source failed, and says what is missing", () => {
    const partial = sourcesWith([raw("r-1", "CLEAN")], { blockedTasks: failedSource({ status: 500 }, loadingSource()) });
    const center = buildAttentionCenter(attentionOf(partial));
    expect(center.counts.all).toBe(1);
    expect(attentionListState(center, "all", partial)).toBe("list");
    expect(partialNotices(center, partial).map((n) => n.key)).toEqual(["supervisorAttention.partialSource.blockedTasks"]);
  });

  it("names a permission problem plainly", () => {
    const denied = sourcesWith([raw("r-1", "CLEAN")], { blockedTasks: failedSource({ status: 403 }, loadingSource()) });
    const keys = partialNotices(buildAttentionCenter(attentionOf(denied)), denied).map((n) => n.key);
    expect(keys).toContain("supervisorAttention.forbidden");
  });
});

describe("cards", () => {
  it("words every item and carries severity as text, not only colour", () => {
    for (const item of buildAttentionCenter(attentionOf(BUSY)).items) {
      const card = describeCard(item, { zone: ZONE, language: "en", someone: "A housekeeper" });
      expect(card).not.toBeNull();
      expect(t(card!.severityLabelKey)).toMatch(/Urgent|High priority|Pending/);
      expect(t(card!.title.key, translateParams(t, card!.title.params))).not.toContain("{{");
    }
  });

  it("marks a card stale when its backing data is the last known answer", () => {
    const stale = { status: "stale" as const, data: normalizeBoard([raw("r-1", "CLEAN")]), fetchedAt: NOW - 600_000, reason: "age" as const, failure: null };
    const item = attentionOf(sourcesWith([], { board: stale })).items[0];
    expect(describeCard(item, { zone: ZONE, language: "en", someone: "x" })).toMatchObject({ stale: true, fetchedAt: NOW - 600_000 });
  });
});

describe("detail", () => {
  const detail = (id: string, sources = BUSY) => resolveAttentionDetail(attentionOf(sources), sources, id, ctx);
  const ready = (id: string, sources = BUSY) => {
    const view = detail(id, sources);
    if (view.state !== "ready") throw new Error(`expected ${id} to be ready`);
    return view;
  };

  it("arrival: shows verified status, the recorded arrival time, how far off it is and who has the room", () => {
    const view = ready("room:r-301:arrival_at_risk");
    expect(view.severity).toBe("critical");
    const text = view.facts.map((f) => t(f.key, translateParams(t, f.params)));
    expect(text).toContain("Status: Vacant Dirty");
    expect(text.some((line) => /^Expected arrival \d/.test(line))).toBe(true);
    expect(text).toContain("Arrives in about 40 min");
    expect(text).toContain("Assigned to Ana");
    expect(view.primary).toMatchObject({ labelKey: "supervisorAttention.action.viewRoom", href: { pathname: "/(app)/room-board", params: { roomId: "r-301" } } });
  });

  it("arrival that has passed says so without calling the room overdue", () => {
    const passed = sourcesWith([raw("r-9", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(-25), assigned_to: "hk-1" })]);
    const text = ready("room:r-9:arrival_at_risk", passed).facts.map((f) => t(f.key, translateParams(t, f.params)));
    expect(text).toContain("Expected arrival was about 25 min ago");
    expect(text.join(" ")).not.toMatch(/overdue|late/i);
  });

  it("readiness risk labels the flag as a prediction, not a fact", () => {
    const view = ready("room:r-302:readiness_risk");
    expect(view.facts.map((f) => t(f.key))).toContain("From the readiness prediction (not a confirmed delay)");
    expect(t(view.whyKey)).toMatch(/prediction, not a confirmed delay/);
  });

  it("an arrival on a CLEAN room goes to Inspect, not the board", () => {
    const clean = sourcesWith([raw("r-8", "CLEAN", { fo_status: "VAC", checkin_time: minutesFromNow(30), assigned_to: "hk-1" })]);
    const view = ready("room:r-8:arrival_at_risk", clean);
    expect(view.primary.href).toEqual({ pathname: "/(app)/inspect" });
  });

  it("unassigned: lists the affected rooms with their status and goes to Assignments — never one arbitrary room", () => {
    const view = ready("queue:unassigned_rooms");
    expect(view.records.map((r) => r.label)).toEqual(["303", "304"]);
    expect(view.records.map((r) => t(r.noteKey ?? "", translateParams(t, r.noteParams ?? {})))).toEqual(["Vacant Dirty", "Occupied"]);
    expect(view.primary).toMatchObject({ labelKey: "supervisorAttention.action.reviewAssignments", href: { pathname: "/(app)/assignments" } });
    expect(view.primary.href.params).toBeUndefined();
  });

  it("inspection: lists the pending queue and opens Inspect", () => {
    const view = ready("queue:awaiting_inspection");
    expect(view.records.map((r) => r.label)).toEqual(["305", "306"]);
    expect(view.primary).toMatchObject({ labelKey: "supervisorAttention.action.openInspect", href: { pathname: "/(app)/inspect" } });
  });

  it("blocker: shows the recorded task, reason, note, owner and reporter, and opens the Tasks workflow", () => {
    const view = ready("blocker:b-1");
    const text = view.facts.map((f) => t(f.key, translateParams(t, f.params)));
    expect(text).toEqual(
      expect.arrayContaining([
        "Task: Restock 204",
        "Room 204",
        "Problem: Missing supplies",
        "Note: No towels on the cart",
        "Task owner: Ana",
        "Marked urgent",
      ]),
    );
    expect(text.some((line) => line.startsWith("Reported by Ana at "))).toBe(true);
    expect(view.primary).toMatchObject({ labelKey: "supervisorAttention.action.reviewTask", href: { pathname: "/(app)/tasks" } });
  });

  it("access restriction: explains the restriction and offers no way into the room", () => {
    const view = ready("queue:access_restricted");
    expect(view.restriction).toBe(true);
    expect(t(view.whyKey)).toMatch(/cannot be serviced until the restriction is cleared/);
    expect(view.records[0]).toMatchObject({ label: "307", noteKey: "supervisorAttention.record.doNotDisturb" });
    // One restricted room opens that room; its action is a review, never a start/override.
    expect(view.primary.action).toBe("review_rooms");
    expect(view.primary.href).toEqual({ pathname: "/(app)/room-board", params: { roomId: "r-307" } });
    expect(JSON.stringify(view)).not.toMatch(/start|override|enter/i);
  });

  it("several restricted rooms open the board, not an arbitrary room", () => {
    const sources = sourcesWith([raw("r-1", "DIRTY", { dnd_flag: true, assigned_to: "hk-1" }), raw("r-2", "DIRTY", { dnd_flag: true, assigned_to: "hk-1" })]);
    const view = ready("queue:access_restricted", sources);
    expect(view.primary).toMatchObject({ labelKey: "supervisorAttention.action.reviewRooms", href: { pathname: "/(app)/room-board" } });
    expect(view.primary.href.params).toBeUndefined();
  });

  it("staff concern: names the person and their open rooms and opens Team", () => {
    const view = ready("staff:hk-2:shift_ended_with_open_rooms");
    const text = view.facts.map((f) => t(f.key, translateParams(t, f.params)));
    expect(text).toEqual(["Bea has clocked out", "1 assigned room still open"]);
    expect(view.primary.href).toEqual({ pathname: "/(app)/assignments" });
  });

  it("lists a short set of rooms and counts the rest", () => {
    const many = Array.from({ length: DETAIL_RECORD_LIMIT + 4 }, (_, i) => raw(`r-${500 + i}`, "CLEAN"));
    const view = ready("queue:awaiting_inspection", sourcesWith(many));
    expect(view.records).toHaveLength(DETAIL_RECORD_LIMIT);
    expect(view.moreRecords).toBe(4);
  });

  it("states where the data came from and whether it is the last known answer", () => {
    expect(ready("queue:awaiting_inspection").source).toEqual({ names: ["supervisorAttention.source.board"], stale: false, fetchedAt: NOW });
    const stale = { status: "stale" as const, data: normalizeBoard([raw("r-1", "CLEAN")]), fetchedAt: NOW - 600_000, reason: "offline" as const, failure: null };
    expect(ready("queue:awaiting_inspection", sourcesWith([], { board: stale })).source).toMatchObject({ stale: true, fetchedAt: NOW - 600_000 });
  });

  it("an item that was resolved while its sheet was open is simply gone", () => {
    expect(detail("queue:awaiting_inspection").state).toBe("ready");
    const resolved = sourcesWith(BUSY_ROOMS.map((room) => (room.status === "CLEAN" ? { ...room, status: "INSPECTED" } : room)), { roster: BUSY_ROSTER });
    expect(resolveAttentionDetail(attentionOf(resolved), resolved, "queue:awaiting_inspection", ctx)).toEqual({ state: "gone" });
    expect(detail("room:does-not-exist:arrival_at_risk")).toEqual({ state: "gone" });
  });

  it("does not crash on a room the board no longer carries", () => {
    const attention = attentionOf(BUSY);
    const without = sourcesWith([]);
    const view = resolveAttentionDetail(attention, without, "room:r-301:arrival_at_risk", ctx);
    expect(view.state).toBe("ready");
  });
});

describe("navigation", () => {
  const items = buildAttentionCenter(attentionOf(BUSY)).items;

  it("every primary action targets a registered supervisor screen, never a housekeeper-only one", () => {
    for (const item of items) {
      const { href } = primaryFor(item);
      expect(isSupervisorSafePath(href.pathname)).toBe(true);
      expect(HOUSEKEEPER_ONLY_PATH_PREFIXES.some((prefix) => href.pathname.startsWith(prefix))).toBe(false);
      expect(href.pathname).not.toMatch(/my-rooms/);
    }
  });

  it("only room targets carry params, and only a room id", () => {
    for (const item of items) {
      const { href } = primaryFor(item);
      if (href.params) expect(Object.keys(href.params)).toEqual(["roomId"]);
    }
  });
});

describe("copy", () => {
  const KEY = /(?<=["'`])supervisorAttention\.[A-Za-z0-9_.]+/g;
  const sourceFiles = [
    "../../components/supervisor/attention/AttentionCard.tsx",
    "../../components/supervisor/attention/AttentionFilters.tsx",
    "../../components/supervisor/attention/SupervisorAttentionSheet.tsx",
    "../../components/supervisor/attention/SupervisorAttentionScreen.tsx",
    "../../lib/housekeeping/supervisorAttentionCenter.ts",
    "../../app/(app)/room-board/index.tsx",
  ].map((file) => fs.readFileSync(path.resolve(__dirname, file), "utf8"));

  it("every literal supervisorAttention key the code uses exists in English and Spanish", () => {
    const used = new Set<string>();
    for (const source of sourceFiles) for (const match of source.matchAll(KEY)) used.add(match[0].replace(/\.$/, ""));
    const dynamic = ["filter", "severity", "category", "why", "fact.count", "fact.priority", "partialSource"];
    for (const key of used) {
      if (dynamic.some((prefix) => key === `supervisorAttention.${prefix}`)) continue;
      for (const language of ["en", "es"] as const) expect({ key, language, ok: localeHasKey(language, key) || localeHasKey(language, `${key}_plural`) }).toEqual({ key, language, ok: true });
    }
  });

  it("the dynamic key families are complete in both languages", () => {
    const families: Record<string, string[]> = {
      "supervisorAttention.filter": ["all", "urgent", "rooms", "team", "inspect", "issues", "messages"],
      "supervisorAttention.severity": ["critical", "high", "normal"],
      "supervisorAttention.category": ["rooms", "team", "inspect", "issues", "messages"],
      "supervisorAttention.source": ["board", "staff", "roster", "inspections", "blockedTasks"],
      "supervisorAttention.why": Object.keys(CATEGORY_OF),
      "supervisorAttention.fact.priority": ["urgent", "normal", "low"],
      "supervisorAttention.partialSource": ["board", "blockedTasks", "roster"],
      "supervisorAttention.action": ["viewRoom", "reviewRooms", "reviewAssignments", "openInspect", "reviewTask", "openTeam", "openNotifications"],
    };
    for (const [family, names] of Object.entries(families)) {
      for (const name of names) for (const language of ["en", "es"] as const) expect({ key: `${family}.${name}`, language, ok: localeHasKey(language, `${family}.${name}`) }).toEqual({ key: `${family}.${name}`, language, ok: true });
    }
    for (const kind of ["unassigned_rooms", "awaiting_inspection", "access_restricted"]) {
      for (const language of ["en", "es"] as const) {
        expect(localeHasKey(language, `supervisorAttention.fact.count.${kind}`)).toBe(true);
        expect(localeHasKey(language, `supervisorAttention.fact.count.${kind}_plural`)).toBe(true);
      }
    }
  });

  it("Spanish carries exactly the English key set and no English leftovers in the headline strings", () => {
    const flat = (node: unknown, prefix = ""): string[] =>
      typeof node === "object" && node !== null ? Object.entries(node).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
    const en = (require("@/i18n/locales/en.json") as { supervisorAttention: unknown }).supervisorAttention;
    const es = (require("@/i18n/locales/es.json") as { supervisorAttention: unknown }).supervisorAttention;
    expect(flat(es).sort()).toEqual(flat(en).sort());
    const strings = (node: unknown): string[] => (typeof node === "object" && node !== null ? Object.values(node).flatMap(strings) : [String(node)]);
    expect(strings(es)).not.toContain("Needs your attention");
  });

  it("every translated string interpolates the same variables in both languages", () => {
    const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    const walk = (a: unknown, b: unknown, trail: string) => {
      if (typeof a === "object" && a !== null) for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${trail}.${key}`);
      else expect({ trail, vars: vars(String(b)) }).toEqual({ trail, vars: vars(String(a)) });
    };
    walk(require("@/i18n/locales/en.json").supervisorAttention, require("@/i18n/locales/es.json").supervisorAttention, "supervisorAttention");
  });
});

describe("no AI spend", () => {
  it("the attention model, store and realtime modules never touch AI routes, credits or models", () => {
    const files = [
      "../../lib/housekeeping/supervisorAttention.ts",
      "../../lib/housekeeping/supervisorAttentionCenter.ts",
      "../../lib/housekeeping/supervisorRealtime.ts",
      "../../lib/housekeeping/useSupervisorToday.ts",
      "../../stores/supervisorTodayStore.ts",
      "../../components/supervisor/attention/SupervisorAttentionScreen.tsx",
      "../../components/supervisor/attention/SupervisorAttentionSheet.tsx",
      "../../components/supervisor/attention/AttentionSheetHost.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
      expect({ file, ai: /\/lib\/ai\/|openai|anthropic|\/ai\/|credit|copilot|assistant/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) }).toEqual({ file, ai: false });
    }
  });
});
