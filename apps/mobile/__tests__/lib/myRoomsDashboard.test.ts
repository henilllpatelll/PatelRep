jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { classifyRoom } from "@/lib/housekeeping/needsAttention";
import {
  buildDashboard,
  buildFloorSections,
  categorizeRoom,
  effectiveStatus,
  elapsedMinutes,
  getAccessState,
  getLastTab,
  parseShiftDate,
  resolveListState,
  setLastTab,
  type RoomEntry,
} from "@/lib/housekeeping/myRoomsDashboard";
import {
  buildDoneItems,
  buildFloorItems,
  buildRouteItems,
  isFloorOpenByDefault,
  isRouteEmpty,
} from "@/lib/housekeeping/myRoomsItems";
import { buildSmartQueue } from "@/lib/ai/briefing";

const NOW = new Date("2026-10-08T15:00:00.000Z");

const LABELS: Record<string, string> = { DEP: "Departure", FULL: "Full", LIGHT: "Light" };

function room(id: string, overrides: Partial<Room> = {}): Room {
  const label =
    "clean_type_label" in overrides
      ? overrides.clean_type_label
      : "clean_type" in overrides
        ? (overrides.clean_type ? LABELS[overrides.clean_type] ?? null : null)
        : "Departure";
  return {
    id,
    room_number: id,
    floor: Math.floor(Number(id) / 100) || 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: "2026-10-08T12:00:00.000Z",
    clean_type: "DEP",
    ...overrides,
    clean_type_label: label,
  };
}

function session(roomId: string, overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId,
    sessionId: `s-${roomId}`,
    cleanType: "DEP",
    startedAt: "2026-10-08T14:30:00.000Z",
    entryAcknowledged: true,
    checklist: [
      { item_id: "a", section: "Bed", label: "Strip", is_required: true, checked: true, checked_at: null },
      { item_id: "b", section: "Bath", label: "Scrub", is_required: true, checked: false, checked_at: null },
    ],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-08T14:31:00.000Z",
    ...overrides,
  };
}

const ids = (entries: RoomEntry[]) => entries.map((e) => e.room.id);

describe("progress counts", () => {
  const rooms = [
    room("101"), // up next
    room("102", { status: "IN_PROGRESS" }), // current
    room("103", { dnd_flag: true }), // attention
    room("104", { status: "CLEAN" }), // submitted
    room("105", { status: "INSPECTED" }), // inspected
    room("106", { status: "OUT_OF_SERVICE" }), // unavailable
    room("107", { status: "OOO" }), // unavailable
  ];

  it("puts every assigned room in exactly one mutually exclusive category", () => {
    const { progress, current, upNext, attention, submitted, inspected, unavailable } = buildDashboard(rooms, {}, NOW);
    expect(progress.assigned).toBe(7);
    expect(current.length + upNext.length + attention.length + submitted.length + inspected.length + unavailable.length).toBe(7);
    const all = [...current, ...upNext, ...attention, ...submitted, ...inspected, ...unavailable].map((e) => e.room.id);
    expect(new Set(all).size).toBe(7);
  });

  it("keeps the in-progress room in remaining", () => {
    const { progress } = buildDashboard(rooms, {}, NOW);
    expect(progress.current).toBe(1);
    expect(progress.remaining).toBe(3); // 101 + 102 + 103
    expect(progress.workable).toBe(2);
  });

  it("excludes OOO/OOS from the denominator and never counts them as completed", () => {
    const { progress } = buildDashboard(rooms, {}, NOW);
    expect(progress.unavailable).toBe(2);
    expect(progress.serviceable).toBe(5);
    expect(progress.completed).toBe(2);
    expect(progress.percent).toBe(40); // 2 / 5, not 2 / 7 and not 4 / 7
    expect(progress.remaining + progress.completed).toBe(progress.serviceable);
  });

  it("counts CLEAN and INSPECTED as completed but keeps them distinct", () => {
    const { progress } = buildDashboard(rooms, {}, NOW);
    expect(progress.submitted).toBe(1);
    expect(progress.inspected).toBe(1);
    expect(progress.completed).toBe(progress.submitted + progress.inspected);
  });

  it("does not treat a blocked room as completed even if every other room is", () => {
    const { progress } = buildDashboard([room("201", { status: "INSPECTED" }), room("202", { status: "OUT_OF_ORDER" })], {}, NOW);
    expect(progress.percent).toBe(100);
    expect(progress.serviceable).toBe(1);
    expect(progress.completed).toBe(1);
  });

  it("is safe with no serviceable rooms or no rooms at all", () => {
    expect(buildDashboard([], {}, NOW).progress).toMatchObject({ assigned: 0, percent: 0, remaining: 0 });
    expect(buildDashboard([room("301", { status: "OOO" })], {}, NOW).progress).toMatchObject({
      assigned: 1,
      serviceable: 0,
      percent: 0,
    });
  });

  it("moves a room between categories consistently when its status changes", () => {
    const before = buildDashboard([room("101"), room("102")], {}, NOW).progress;
    const after = buildDashboard([room("101", { status: "CLEAN" }), room("102")], {}, NOW).progress;
    expect([before.completed, before.remaining]).toEqual([0, 2]);
    expect([after.completed, after.remaining]).toEqual([1, 1]);
  });

  it("collapses duplicate room ids from the source", () => {
    const { progress } = buildDashboard([room("101"), room("101")], {}, NOW);
    expect(progress.assigned).toBe(1);
  });
});

describe("current room and sessions", () => {
  it("restores the current room from a persisted session even if the list status is stale", () => {
    // Offline start: the list still says DIRTY but a live local session exists.
    const model = buildDashboard([room("102")], { "102": session("102", { startConfirmed: false }) }, NOW);
    expect(ids(model.current)).toEqual(["102"]);
    expect(model.current[0].session).toMatchObject({ state: "starting", checklistDone: 1, checklistTotal: 2, pendingSync: true });
    expect(model.progress.remaining).toBe(1);
  });

  it("uses the real session start time, checklist counts and sync state", () => {
    const entry = buildDashboard([room("102", { status: "IN_PROGRESS" })], { "102": session("102") }, NOW).current[0];
    expect(entry.session).toMatchObject({ state: "active", startedAt: "2026-10-08T14:30:00.000Z", pendingSync: false });
    expect(elapsedMinutes(entry.session!.startedAt, NOW)).toBe(30);
  });

  it("never invents an elapsed time from nothing", () => {
    expect(elapsedMinutes(null, NOW)).toBeNull();
    expect(elapsedMinutes("not-a-date", NOW)).toBeNull();
    expect(elapsedMinutes("2026-10-08T16:00:00.000Z", NOW)).toBe(0);
  });

  it("flags an IN_PROGRESS room with no session as missing instead of faking one", () => {
    const entry = buildDashboard([room("102", { status: "IN_PROGRESS" })], {}, NOW).current[0];
    expect(entry.category).toBe("current");
    expect(entry.session).toMatchObject({ state: "missing", startedAt: null, checklistTotal: 0 });
  });

  it("shows each current room once even when both status and a session point at it", () => {
    const model = buildDashboard([room("102", { status: "IN_PROGRESS" })], { "102": session("102") }, NOW);
    expect(model.current).toHaveLength(1);
    expect(model.upNext).toHaveLength(0);
    expect(model.attention).toHaveLength(0);
  });

  it("orders a real session ahead of a recovery placeholder", () => {
    const model = buildDashboard(
      [room("101", { status: "IN_PROGRESS" }), room("102", { status: "IN_PROGRESS" })],
      { "102": session("102") },
      NOW,
    );
    expect(ids(model.current)).toEqual(["102", "101"]);
  });

  it("surfaces a sync conflict as a current room with that state", () => {
    const conflict = session("102", { conflict: { code: "DND_ACTIVE", message: "DND", at: "2026-10-08T14:40:00.000Z" } });
    const entry = buildDashboard([room("102", { status: "IN_PROGRESS" })], { "102": conflict }, NOW).current[0];
    expect(entry.session?.state).toBe("conflict");
    expect(entry.session?.pendingSync).toBe(false);
  });

  it("treats a server-confirmed completion as submitted before the list refreshes", () => {
    const done = session("102", { completionConfirmed: true });
    expect(effectiveStatus(room("102", { status: "IN_PROGRESS" }), done)).toBe("CLEAN");
    const model = buildDashboard([room("102", { status: "IN_PROGRESS" })], { "102": done }, NOW);
    expect(model.current).toHaveLength(0);
    expect(model.submitted).toHaveLength(1);
    expect(model.submitted[0].room.status).toBe("CLEAN");
    expect(model.progress.completed).toBe(1);
  });

  it("does not let an old completed record hide a reclean", () => {
    const done = session("102", { completionConfirmed: true });
    expect(categorizeRoom(room("102", { status: "DIRTY" }), done)).toBe("up_next");
  });

  it("keeps a locally finished, unconfirmed room as current rather than completed", () => {
    const completing = session("102", { completeRequestedAt: "2026-10-08T14:55:00.000Z" });
    const model = buildDashboard([room("102", { status: "IN_PROGRESS" })], { "102": completing }, NOW);
    expect(model.current[0].session).toMatchObject({ state: "completing", pendingSync: true });
    expect(model.progress.completed).toBe(0);
  });
});

describe("access state", () => {
  it("only trusts a verified checkout", () => {
    const verified = getAccessState(room("101"), NOW);
    expect(verified.kind).toBe("checkout_verified");
  });

  it("calls a past scheduled checkout 'not verified', never 'checked out'", () => {
    const state = getAccessState(
      room("101", { actual_checkout_at: null, checkout_time: "2026-10-08T11:00:00.000Z", status: "OCCUPIED" }),
      NOW,
    );
    expect(state.kind).toBe("checkout_not_verified");
  });

  it("distinguishes a checkout still ahead, occupied stayovers, DND and declined service", () => {
    expect(getAccessState(room("101", { actual_checkout_at: null, checkout_time: "2026-10-08T17:00:00.000Z" }), NOW).kind).toBe(
      "scheduled_checkout",
    );
    expect(getAccessState(room("101", { clean_type: "FULL", actual_checkout_at: null, fo_status: "OCC" }), NOW).kind).toBe("occupied");
    expect(getAccessState(room("101", { dnd_flag: true }), NOW).kind).toBe("dnd");
    expect(getAccessState(room("101", { do_not_service: true }), NOW).kind).toBe("do_not_service");
  });
});

describe("needs attention", () => {
  const primary = (r: Room) => classifyRoom(r, { now: NOW }).primary;
  const state = (r: Room) => classifyRoom(r, { now: NOW }).state;
  const stay = { clean_type: "FULL", actual_checkout_at: null, fo_status: "OCC" as const };

  it("classifies DND, declined, unverified checkout, blockers and work orders", () => {
    expect(primary(room("1", { dnd_flag: true }))).toBe("dnd");
    expect(primary(room("1", { ...stay, do_not_service: true }))).toBe("do_not_service");
    expect(primary(room("1", { ...stay, do_not_service: true, service_declined_reason: "privacy_request" }))).toBe("service_declined");
    expect(primary(room("1", { actual_checkout_at: null }))).toBe("checkout_unverified");
    expect(primary(room("1", { latest_note: "BLOCKER: Guest inside" }))).toBe("guest_inside");
    expect(primary(room("1", { latest_note: "BLOCKER: Can't enter (double-locked)" }))).toBe("access_problem");
    expect(primary(room("1", { clean_type: "FULL", open_work_order_id: "wo-1" }))).toBe("work_order");
  });

  it("keeps routine and reclean-safe rooms out of attention", () => {
    expect(state(room("1"))).toBe("cleanable");
    // A verified-vacant departure can be cleaned around informational notes / open work orders.
    expect(state(room("1", { open_work_order_id: "wo-1", latest_note: "Fridge humming" }))).toBe("cleanable");
    // A reclean that is safe to enter is actionable work, with its corrections visible.
    const reclean = room("1", { reclean_requested_at: "2026-10-08T13:00:00Z", reclean_corrections: ["Dust"] });
    expect(state(reclean)).toBe("cleanable");
    expect(classifyRoom(reclean, { now: NOW }).reclean).toEqual({ requestedAt: "2026-10-08T13:00:00Z", corrections: 1 });
    // Occupied stayovers are workable (knock protocol), not blocked.
    expect(state(room("1", { ...stay, status: "PICKUP" }))).toBe("cleanable");
    // A stale decline does not survive a verified checkout.
    expect(state(room("1", { do_not_service: true }))).toBe("cleanable");
  });

  it("never moves an attention room into Up Next, however high its priority or sequence", () => {
    const rush = room("103", { dnd_flag: true, priority: 1, sequence_order: 1 });
    const model = buildDashboard([rush, room("104", { sequence_order: 2 })], {}, NOW);
    expect(ids(model.upNext)).toEqual(["104"]);
    expect(ids(model.attention)).toEqual(["103"]);
  });

  it("does not count attention rooms as completed or hide them from remaining", () => {
    const { progress } = buildDashboard([room("103", { dnd_flag: true })], {}, NOW);
    expect(progress).toMatchObject({ attention: 1, remaining: 1, completed: 0, workable: 0 });
  });

  it("orders attention by how firmly it blocks, then retry time", () => {
    const model = buildDashboard(
      [
        room("201", { latest_note: "BLOCKER: stuck" }),
        room("202", { dnd_flag: true, dnd_retry_at: "2026-10-08T18:00:00Z" }),
        room("203", { dnd_flag: true, dnd_retry_at: "2026-10-08T16:00:00Z" }),
        room("204", { ...stay, do_not_service: true }),
      ],
      {},
      NOW,
    );
    expect(ids(model.attention)).toEqual(["203", "202", "204", "201"]);
  });
});

describe("Up Next ordering", () => {
  function upNext(rooms: Room[]) {
    return ids(buildDashboard(rooms, {}, NOW).upNext);
  }

  it("follows supervisor sequence_order over the heuristic", () => {
    const rooms = [
      room("301", { sequence_order: 3 }),
      room("302", { sequence_order: 1 }),
      room("303", { sequence_order: 2, checkin_time: "2026-10-08T16:00:00.000Z" }), // arrival-soon would otherwise lead
    ];
    expect(upNext(rooms)).toEqual(["302", "303", "301"]);
  });

  it("puts sequenced rooms before unsequenced ones and ignores invalid sequence numbers", () => {
    const rooms = [
      room("301"),
      room("302", { sequence_order: 0 }),
      room("303", { sequence_order: -2 }),
      room("304", { sequence_order: 1.5 }),
      room("305", { sequence_order: 2 }),
    ];
    const order = upNext(rooms);
    expect(order[0]).toBe("305");
    expect(order.slice(1).sort()).toEqual(["301", "302", "303", "304"]);
  });

  it("breaks sequence ties deterministically", () => {
    const rooms = [room("302", { sequence_order: 1 }), room("301", { sequence_order: 1 })];
    expect(upNext(rooms)).toEqual(upNext([...rooms].reverse()));
  });

  it("falls back to the existing smart-queue ranking when nothing is sequenced", () => {
    const rooms = [
      room("301", { clean_type: "FULL", clean_type_label: "Full", status: "DIRTY" }),
      room("302", { checkin_time: "2026-10-08T17:00:00.000Z" }), // departure + arrival soon
      room("303"), // plain departure
    ];
    const smart = buildSmartQueue(rooms, NOW, () => true).map((e) => e.room.id);
    expect(upNext(rooms)).toEqual(smart);
    expect(upNext(rooms)[0]).toBe("302");
  });

  it("puts unsequenced rush rooms ahead of the heuristic, by priority then needed-by", () => {
    const rooms = [
      room("301"),
      room("302", { priority: 2, priority_needed_by: "2026-10-08T19:00:00Z" }),
      room("303", { priority: 1, priority_needed_by: "2026-10-08T20:00:00Z" }),
      room("304", { priority: 2, priority_needed_by: "2026-10-08T17:00:00Z" }),
      room("305", { priority: 5 }), // not rush
    ];
    expect(upNext(rooms).slice(0, 3)).toEqual(["303", "304", "302"]);
    expect(upNext(rooms).slice(3).sort()).toEqual(["301", "305"]);
  });

  it("falls back to floor then natural room number when data is thin", () => {
    const rooms = [
      room("1002", { floor: 10, clean_type: null, clean_type_label: null, actual_checkout_at: null, status: "DIRTY" }),
      room("202", { floor: 2, clean_type: null, clean_type_label: null, actual_checkout_at: null, status: "DIRTY" }),
      room("21", { floor: 2, clean_type: null, clean_type_label: null, actual_checkout_at: null, status: "DIRTY" }),
    ];
    expect(upNext(rooms).indexOf("1002")).toBe(2); // floor 10 after floor 2
    expect(upNext(rooms).slice(0, 2)).toEqual(["21", "202"]); // 21 < 202 numerically
  });

  it("keeps stayovers in the route (the smart-queue bucket filter would drop them)", () => {
    const stayover = room("401", { clean_type: "FULL", clean_type_label: "Full", status: "PICKUP", actual_checkout_at: null, fo_status: "OCC" });
    expect(upNext([stayover, room("402")])).toEqual(expect.arrayContaining(["401", "402"]));
    expect(upNext([stayover, room("402")])).toHaveLength(2);
  });
});

describe("Floors", () => {
  const rooms = [
    room("101", { floor: 1, building: "East", status: "CLEAN" }),
    room("102", { floor: 1, building: "East", status: "DIRTY" }),
    room("201", { floor: 2, building: "East", status: "OUT_OF_SERVICE" }),
    room("301", { floor: 3, building: "West", status: "DIRTY" }),
    room("302", { floor: 3, building: "West", status: "INSPECTED" }),
    room("1001", { floor: 10, building: "West", status: "DIRTY" }),
  ];
  const model = buildDashboard(rooms, {}, NOW);

  it("groups by the API's real buildings and sorts floors numerically", () => {
    const sections = buildFloorSections(model.all);
    expect(sections.map((s) => s.building)).toEqual(["East", "West"]);
    expect(sections[1].floors.map((f) => f.floor)).toEqual([3, 10]);
  });

  it("never infers buildings from room-number suffixes", () => {
    const noTopology = buildDashboard([room("101", { building: null }), room("133", { building: null }), room("201")], {}, NOW);
    const sections = buildFloorSections(noTopology.all);
    expect(sections).toHaveLength(1);
    expect(sections[0].building).toBeNull();
    expect(sections[0].unassigned).toBe(false);
    expect(sections[0].floors.map((f) => f.floor)).toEqual([1, 2]);
  });

  it("collects rooms with no building under 'unassigned' only when others have one", () => {
    const mixed = buildDashboard([room("101", { building: "East" }), room("201", { building: null })], {}, NOW);
    const sections = buildFloorSections(mixed.all);
    expect(sections.map((s) => [s.building, s.unassigned])).toEqual([["East", false], [null, true]]);
  });

  it("counts per-floor progress over serviceable rooms only", () => {
    const east = buildFloorSections(model.all)[0];
    const [floor1, floor2] = east.floors;
    expect([floor1.completed, floor1.serviceable]).toEqual([1, 2]);
    expect([floor2.completed, floor2.serviceable, floor2.unavailable]).toEqual([0, 0, 1]);
  });

  it("handles one floor, many floors and unconventional numbering", () => {
    const odd = buildDashboard(
      [room("A-12", { floor: 0 }), room("PH1", { floor: null as unknown as number }), room("Cabana 3", { floor: 0 })],
      {},
      NOW,
    );
    const sections = buildFloorSections(odd.all);
    expect(sections[0].floors.map((f) => f.floor)).toEqual([0, null]);
    expect(sections[0].floors[0].rooms.map((e) => e.room.room_number)).toEqual(["A-12", "Cabana 3"]);
  });

  it("searches room numbers, keeping full-floor counts and dropping empty floors", () => {
    const sections = buildFloorSections(model.all, " 30 ");
    expect(sections).toHaveLength(1);
    expect(sections[0].floors).toHaveLength(1);
    expect(sections[0].floors[0].rooms.map((e) => e.room.room_number)).toEqual(["301", "302"]);
    expect(sections[0].floors[0].serviceable).toBe(2);
    expect(buildFloorSections(model.all, "zzz")).toEqual([]);
    const tenMatches = buildFloorSections(model.all, "10").flatMap((b) =>
      b.floors.flatMap((f) => f.rooms.map((e) => e.room.room_number)),
    );
    expect(tenMatches.sort()).toEqual(["1001", "101", "102"]);
  });

  it("opens floors with unfinished work by default and everything while searching", () => {
    const sections = buildFloorSections(model.all);
    const [floor1, floor2] = sections[0].floors;
    expect(isFloorOpenByDefault(floor1)).toBe(true);
    expect(isFloorOpenByDefault(floor2)).toBe(false);

    const collapsed = buildFloorItems(sections, {}, false);
    expect(collapsed.some((i) => i.kind === "row" && i.entry.room.id === "201")).toBe(false);
    const forced = buildFloorItems(sections, { [floor2.key]: true, [floor1.key]: false }, false);
    expect(forced.some((i) => i.kind === "row" && i.entry.room.id === "201")).toBe(true);
    expect(forced.some((i) => i.kind === "row" && i.entry.room.id === "101")).toBe(false);
    expect(buildFloorItems(sections, { [floor1.key]: false }, true).some((i) => i.kind === "row" && i.entry.room.id === "101")).toBe(true);
  });

  it("emits building headers only when the hotel has building data", () => {
    expect(buildFloorItems(buildFloorSections(model.all), {}, false).filter((i) => i.kind === "building")).toHaveLength(2);
    const flat = buildDashboard([room("101", { building: null })], {}, NOW);
    expect(buildFloorItems(buildFloorSections(flat.all), {}, false).some((i) => i.kind === "building")).toBe(false);
  });
});

describe("Route and Done rows", () => {
  const rooms = [
    room("101", { status: "IN_PROGRESS" }),
    room("102", { sequence_order: 1 }),
    room("103", { dnd_flag: true }),
    room("104", { status: "CLEAN" }),
    room("105", { status: "INSPECTED" }),
    room("106", { status: "OOO" }),
  ];
  const model = buildDashboard(rooms, { "101": session("101") }, NOW);

  it("lays Route out as Current Room → Up Next → Needs Attention", () => {
    const items = buildRouteItems(model);
    expect(items.map((i) => i.key)).toEqual(["s-current", "current-101", "s-next", "next-102", "s-attention", "attn-103"]);
    const card = items.find((i) => i.kind === "card" && i.entry.room.id === "102");
    expect(card && card.kind === "card" ? card.position : null).toBe(1);
  });

  it("explains an attention-only route and reports a truly empty one", () => {
    const only = buildRouteItems(buildDashboard([room("103", { dnd_flag: true })], {}, NOW));
    expect(only.some((i) => i.kind === "text")).toBe(true);
    expect(isRouteEmpty(buildDashboard([room("104", { status: "CLEAN" })], {}, NOW))).toBe(true);
    expect(isRouteEmpty(model)).toBe(false);
  });

  it("keeps submitted, inspected and unavailable distinct in Done", () => {
    const items = buildDoneItems(model);
    const sectionOf = (roomId: string) => {
      let section = "";
      for (const item of items) {
        if (item.kind === "section") section = item.key;
        if (item.kind === "row" && item.entry.room.id === roomId) return section;
      }
      return null;
    };
    expect(sectionOf("104")).toBe("s-awaiting");
    expect(sectionOf("105")).toBe("s-ready");
    expect(sectionOf("106")).toBe("s-unavailable");
    expect(sectionOf("103")).toBeNull(); // blocked/attention rooms are not "done"
    expect(sectionOf("101")).toBeNull();
  });

  it("handles zero rooms in any Done section", () => {
    const none = buildDoneItems(buildDashboard([room("101")], {}, NOW));
    expect(none.map((i) => i.key)).toEqual(["s-awaiting", "t-awaiting", "s-ready", "t-ready"]);
    const onlyOne = buildDoneItems(buildDashboard([room("101", { status: "CLEAN" })], {}, NOW));
    expect(onlyOne.map((i) => i.key)).toEqual(["s-awaiting", "awaiting-101", "s-ready", "t-ready"]);
  });
});

describe("large assignment lists", () => {
  it("classifies, orders and groups 400 rooms quickly and consistently", () => {
    const many: Room[] = [];
    for (let floor = 1; floor <= 20; floor += 1) {
      for (let n = 1; n <= 20; n += 1) {
        const id = `${floor}${String(n).padStart(2, "0")}`;
        const status: Room["status"] = n % 7 === 0 ? "CLEAN" : n % 11 === 0 ? "OUT_OF_ORDER" : "DIRTY";
        many.push(room(id, { floor, status, building: floor <= 10 ? "North" : "South", dnd_flag: n === 5 }));
      }
    }
    const started = Date.now();
    const model = buildDashboard(many, {}, NOW);
    const sections = buildFloorSections(model.all, "");
    const items = buildFloorItems(sections, {}, true);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(model.progress.assigned).toBe(400);
    expect(
      model.progress.workable + model.progress.attention + model.progress.completed + model.progress.unavailable,
    ).toBe(400);
    expect(items.filter((i) => i.kind === "row")).toHaveLength(400);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

describe("list state resolution", () => {
  it("never renders a failed fetch as an empty success", () => {
    expect(resolveListState({ loading: true, roomCount: 0, fetchError: null })).toBe("loading");
    expect(resolveListState({ loading: false, roomCount: 0, fetchError: "boom" })).toBe("error");
    expect(resolveListState({ loading: false, roomCount: 0, fetchError: null })).toBe("empty");
    // Cached rows + a failed refresh stay visible (the screen shows a stale-data notice).
    expect(resolveListState({ loading: false, roomCount: 3, fetchError: "boom" })).toBe("ready");
  });
});

describe("session helpers", () => {
  it("remembers the last tab for the app session and defaults to Route", () => {
    expect(getLastTab()).toBe("route");
    setLastTab("done");
    expect(getLastTab()).toBe("done");
    setLastTab("route");
  });

  it("parses the shift date without timezone drift", () => {
    const parsed = parseShiftDate("2026-10-08")!;
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 9, 8]);
    expect(parseShiftDate(null)).toBeNull();
    expect(parseShiftDate("garbage")).toBeNull();
  });
});


describe("Phase 3 ordering and counting", () => {
  const recleanFields = { reclean_requested_at: "2026-10-08T13:00:00Z", reclean_corrections: ["Mirror"] };
  const stay = { clean_type: "FULL", actual_checkout_at: null, fo_status: "OCC" as const, status: "PICKUP" as const };

  it("puts unsequenced rush first, then reclean corrections, then the heuristic", () => {
    const model = buildDashboard(
      [room("301"), room("302", recleanFields), room("303", { priority: 1 }), room("304")],
      {},
      NOW,
    );
    expect(ids(model.upNext).slice(0, 2)).toEqual(["303", "302"]);
    expect(ids(model.upNext).slice(2).sort()).toEqual(["301", "304"]);
  });

  it("keeps the supervisor's sequence ahead of both rush and reclean", () => {
    const model = buildDashboard(
      [room("301", { sequence_order: 1 }), room("302", { priority: 1 }), room("303", recleanFields)],
      {},
      NOW,
    );
    expect(ids(model.upNext)[0]).toBe("301");
  });

  it("exposes the rush as data (reason, deadline, note), not a boolean, and drops it when the priority is revoked", () => {
    const rush = buildDashboard([room("301", { priority: 1, priority_reason: "vip", priority_needed_by: "2099-01-01T18:00:00Z", priority_note: "Owner" })], {}, NOW).upNext[0];
    expect(rush.rush).toEqual({ reason: "vip", neededBy: "2099-01-01T18:00:00Z", note: "Owner", overdue: false });
    expect(buildDashboard([room("301", { priority: 5 })], {}, NOW).upNext[0].rush).toBeNull();
  });

  it("a room with Rush + DND + a near arrival is counted once, in Needs Attention, with every reason kept", () => {
    const model = buildDashboard(
      [room("314", { ...stay, dnd_flag: true, priority: 1, priority_needed_by: "2099-01-01T18:00:00Z", checkin_time: "2026-10-08T17:00:00Z", reclean_requested_at: "2026-10-08T13:00:00Z", reclean_corrections: ["x"] })],
      {},
      NOW,
    );
    expect(ids(model.attention)).toEqual(["314"]);
    expect(model.upNext).toHaveLength(0);
    const entry = model.attention[0];
    expect(entry.attention).toBe("dnd");
    expect(entry.classification.reasons).toEqual(["dnd", "reclean"]);
    expect(entry.rush?.neededBy).toBe("2099-01-01T18:00:00Z");
    expect(model.progress).toMatchObject({ assigned: 1, attention: 1, workable: 0, remaining: 1, completed: 0 });
  });

  it("keeps the mutually exclusive categories summing to assigned across every mix of states", () => {
    const rooms = [
      room("1"),
      room("2", { dnd_flag: true }),
      room("3", { ...stay, do_not_service: true }),
      room("4", { ...stay, dnd_retry_at: "2099-01-01T00:00:00Z" }),
      room("5", { ...stay, dnd_retry_at: "2020-01-01T00:00:00Z" }),
      room("6", recleanFields),
      room("7", { status: "CLEAN", ...recleanFields }),
      room("8", { status: "INSPECTED" }),
      room("9", { status: "OUT_OF_ORDER", dnd_flag: true, priority: 1 }),
      room("10", { status: "IN_PROGRESS", dnd_flag: true }),
      room("11", { actual_checkout_at: null }),
    ];
    const { progress, current, upNext, attention, submitted, inspected, unavailable } = buildDashboard(rooms, {}, NOW);
    expect(current.length + upNext.length + attention.length + submitted.length + inspected.length + unavailable.length).toBe(rooms.length);
    expect(progress.remaining + progress.completed).toBe(progress.serviceable);
    expect(ids(attention).sort()).toEqual(["11", "2", "3", "4"]);
    expect(ids(upNext).sort()).toEqual(["1", "5", "6"]);
    expect(ids(current)).toEqual(["10"]);
  });
});
