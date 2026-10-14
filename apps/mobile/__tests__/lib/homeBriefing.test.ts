import type { Room } from "@/stores/appStore";
import type { ShiftBriefing } from "@/lib/ai/briefing";
import { buildBriefingFromModel, reconcileBriefing } from "@/lib/housekeeping/homeBriefing";
import { buildHomeModel } from "@/lib/housekeeping/homeModel";
import { resolveShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";

const NOW = new Date("2026-10-14T15:00:00.000Z");
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function room(id: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    room_number: id,
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    actual_checkout_at: "2026-10-14T12:00:00.000Z",
    clean_type: "DEP",
    assignment_date: "2026-10-14",
    ...overrides,
  };
}

function model(rooms: Room[]) {
  return buildHomeModel({
    rooms,
    sessions: {},
    rankedAt: NOW,
    now: NOW,
    expectedShiftDate: "2026-10-14",
    timeZone: "America/Chicago",
    isOnline: true,
    board: {
      loading: false,
      refreshing: false,
      confirmedEmpty: false,
      freshness: "fresh",
      fetchError: null,
      usingCache: false,
      lastRefreshAt: NOW.getTime(),
      serverShiftDate: "2026-10-14",
      answeredForDate: "2026-10-14",
    },
    lifecycle: resolveShiftLifecycle({
      current: null,
      lastEnded: null,
      serverConfirmed: true,
      lastFetchFailed: false,
      pendingOp: null,
      shiftDate: "2026-10-14",
      timeZone: "America/Chicago",
      isOnline: true,
    }),
    syncRows: [],
    syncRowsComplete: true,
    supervisorNote: null,
  });
}

describe("buildBriefingFromModel", () => {
  it("starts with the room Home recommends — the supervisor's sequence, not the generic queue", () => {
    const m = model([room("101"), room("102", { sequence_order: 1 }), room("103", { sequence_order: 2 })]);
    const briefing = buildBriefingFromModel(m, t);
    expect(briefing.plan.slice(0, 3)).toEqual(["102", "103", "101"]);
    expect(briefing.headline).toContain("ai.briefing.startWith");
    expect(briefing.headline).toContain('"room":"102"');
    expect(briefing.headline).toContain(m.recommendation?.room.room_number ?? "?");
    expect(briefing.source).toBe("local");
  });

  it("keeps the room being cleaned in the plan but starts the headline with the next startable room", () => {
    const m = model([room("101", { status: "IN_PROGRESS" }), room("102")]);
    const briefing = buildBriefingFromModel(m, t);
    expect(briefing.plan).toEqual(["101", "102"]);
    expect(briefing.headline).toContain('"room":"102"');
  });

  it("leaves restricted rooms out of the plan and warns about them", () => {
    const m = model([room("101", { dnd_flag: true, dnd_attempt_count: 1 }), room("102")]);
    const briefing = buildBriefingFromModel(m, t);
    expect(briefing.plan).toEqual(["102"]);
    expect(briefing.watchouts.some((w) => w.startsWith("ai.briefing.dndWatchout"))).toBe(true);
  });

  it("says so when only restricted rooms remain, or nothing does", () => {
    expect(buildBriefingFromModel(model([room("101", { dnd_flag: true })]), t).headline).toContain("onlyAttentionLeft");
    expect(buildBriefingFromModel(model([room("101", { status: "CLEAN" })]), t).headline).toBe("ai.briefing.allClear");
  });

  it("sums the estimates of the work still to do", () => {
    const m = model([room("101"), room("102"), room("103", { status: "CLEAN" })]);
    expect(buildBriefingFromModel(m, t).estimatedMinutes).toBe(m.dashboard.upNext.reduce((s, e) => s + e.estimateMinutes, 0));
  });
});

describe("reconcileBriefing", () => {
  const authoritative: ShiftBriefing = { headline: "local", plan: ["102", "103"], watchouts: [], estimatedMinutes: 50, source: "local" };

  it("keeps the AI wording when it agrees on the first room, with Home's own plan", () => {
    const ai: ShiftBriefing = { headline: "ai says go", plan: ["102", "101", "103"], watchouts: ["x"], estimatedMinutes: 99, source: "ai" };
    expect(reconcileBriefing(ai, authoritative)).toEqual({ ...ai, plan: ["102", "103"], estimatedMinutes: 50 });
  });

  it("falls back to the deterministic briefing when the AI would start somewhere else", () => {
    const ai: ShiftBriefing = { headline: "ai says go", plan: ["101", "102"], watchouts: [], estimatedMinutes: 40, source: "ai" };
    expect(reconcileBriefing(ai, authoritative)).toBe(authoritative);
  });

  it("falls back when the AI returned no plan", () => {
    const ai: ShiftBriefing = { headline: "ai", plan: [], watchouts: [], estimatedMinutes: 0, source: "ai" };
    expect(reconcileBriefing(ai, authoritative)).toBe(authoritative);
  });

  it("passes the deterministic briefing straight through", () => {
    expect(reconcileBriefing(authoritative, authoritative)).toBe(authoritative);
  });
});
