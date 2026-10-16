import { buildDashboard } from "@/lib/housekeeping/myRoomsDashboard";
import { buildRecommendation, recommendNext } from "@/lib/housekeeping/homeRecommendation";
import { freshnessView, resolveDashboardWhy, resolveWhyRoom } from "@/lib/housekeeping/homeSheets";
import { leadOf } from "@/lib/housekeeping/homeState";
import type { Room } from "@/stores/appStore";
import { NOW, build, room, session } from "../helpers/homeModelFixture";

/** Home and My Rooms must name the same room, whatever competes for first place. */
function bothLeads(rooms: Room[], sessions: Record<string, ReturnType<typeof session>> = {}) {
  const home = leadOf(build(rooms, { sessions }))?.room.id ?? null;
  const dashboard = buildDashboard(rooms, sessions, NOW);
  const myRooms = buildRecommendation(dashboard, NOW)?.room.id ?? null;
  return { home, myRooms };
}

const dnd = (id: string) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null });

describe("Home and My Rooms agree on the next room", () => {
  it("follows the supervisor's sequence over every other signal", () => {
    const rooms = [
      room("101", { sequence_order: 3 } as Partial<Room>),
      room("102", { sequence_order: 1 } as Partial<Room>),
      room("103", { sequence_order: 2, priority: 1 } as Partial<Room>),
    ];
    const { home, myRooms } = bothLeads(rooms);
    expect(home).toBe(myRooms);
    expect(home).toBe("102");
  });

  it("ranks Rush ahead of the standard queue when no sequence is set", () => {
    const rooms = [room("101"), room("102", { priority: 1, priority_reason: "vip" } as Partial<Room>), room("103")];
    const { home, myRooms } = bothLeads(rooms);
    expect(home).toBe("102");
    expect(myRooms).toBe("102");
  });

  it("never names a Do Not Disturb room, even if it is first in the sequence", () => {
    const rooms = [{ ...dnd("201"), sequence_order: 1 } as Room, room("202", { sequence_order: 2 } as Partial<Room>)];
    const { home, myRooms } = bothLeads(rooms);
    expect(home).toBe("202");
    expect(myRooms).toBe("202");
  });

  it("leads with the room already being cleaned, on both screens", () => {
    const rooms = [room("101"), room("102", { status: "IN_PROGRESS" })];
    const { home, myRooms } = bothLeads(rooms, { "102": session("102") });
    expect(home).toBe("102");
    expect(myRooms).toBe("102");
  });

  it("has nothing to recommend when every room is restricted or none is assigned", () => {
    expect(bothLeads([dnd("201")])).toEqual({ home: null, myRooms: null });
    expect(bothLeads([])).toEqual({ home: null, myRooms: null });
  });

  it("explains the same room on both screens, with the same reasons", () => {
    const rooms = [room("101", { sequence_order: 1 } as Partial<Room>), room("102", { sequence_order: 2 } as Partial<Room>)];
    const homeView = resolveWhyRoom(build(rooms), "101");
    const listView = resolveDashboardWhy(buildDashboard(rooms, {}, NOW), "101", { state: "fresh", updatedAt: null }, NOW);
    if (homeView.state !== "ready" || listView.state !== "ready") throw new Error("expected both ready");
    expect(listView.recommendation.room.id).toBe(homeView.recommendation.room.id);
    expect([listView.recommendation.reason, ...listView.recommendation.alsoApplies]).toEqual([
      homeView.recommendation.reason,
      ...homeView.recommendation.alsoApplies,
    ]);
  });
});

describe("explaining the room that is next while another is open", () => {
  const rooms = [room("101", { status: "IN_PROGRESS" }), room("102"), room("103")];
  const sessions = { "101": session("101") };

  it("describes the Up Next room, not the open one, when asked from the Up Next card", () => {
    const model = build(rooms, { sessions });
    const view = resolveWhyRoom(model, "102");
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.recommendation.room.id).toBe("102");
    expect(view.recommendation.kind).toBe("start");
    expect(view.changed).toBe(false);
  });

  it("matches what My Rooms offers under 'Why next?'", () => {
    const dashboard = buildDashboard(rooms, sessions, NOW);
    expect(recommendNext(dashboard, NOW)?.room.id).toBe("102");
    const view = resolveDashboardWhy(dashboard, "102", { state: "fresh", updatedAt: null }, NOW);
    expect(view.state === "ready" && view.recommendation.room.id).toBe("102");
  });

  it("follows the ranking if it moves while the drawer is open, and says so", () => {
    const moved = buildDashboard([room("101", { status: "IN_PROGRESS" }), room("103")], sessions, NOW);
    const view = resolveDashboardWhy(moved, "102", { state: "fresh", updatedAt: null }, NOW);
    expect(view).toMatchObject({ state: "ready", changed: true });
    expect(view.state === "ready" && view.recommendation.room.id).toBe("103");
  });
});

describe("how current the explanation is", () => {
  it("calls offline offline, ahead of age", () => {
    expect(freshnessView("fresh", false, "2026-10-14T14:59:00.000Z")).toEqual({ state: "offline", updatedAt: "2026-10-14T14:59:00.000Z" });
  });

  it("maps old or never-refreshed boards to stale / cached", () => {
    expect(freshnessView("stale", true, null).state).toBe("stale");
    expect(freshnessView("cached", true, null).state).toBe("cached");
    expect(freshnessView("never", true, null).state).toBe("cached");
    expect(freshnessView("fresh", true, null).state).toBe("fresh");
  });

  it("is carried on the Home explanation", () => {
    const model = build([room("101")], { online: false });
    const view = resolveWhyRoom(model, "101", false);
    expect(view.state === "ready" && view.freshness.state).toBe("offline");
  });
});

describe("estimates on the recommendation", () => {
  it("tell a hotel baseline from the app's general figure", () => {
    const baseline = room("101", { rooms: { room_types: { name: "King", code: "K", base_clean_minutes: 35 } } as Room["rooms"] });
    const withBase = leadOf(build([baseline]));
    const without = leadOf(build([room("102")]));
    expect(withBase?.timing.estimateBasis).toBe("room_type");
    expect(withBase?.timing.estimateMinutes).toBe(35);
    expect(without?.timing.estimateBasis).toBe("general");
  });
});
