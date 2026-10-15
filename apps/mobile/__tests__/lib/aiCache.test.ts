import { createAiCache } from "@/lib/housekeeping/aiCache";
import { buildBriefingFromModel, buildBriefingPlan, mentionsUnknownRoom, reconcileBriefing } from "@/lib/housekeeping/homeBriefing";
import { build, room, session } from "../helpers/homeModelFixture";
import { makeTranslator } from "../helpers/i18n";
import type { ShiftBriefing } from "@/lib/ai/briefing";

describe("createAiCache", () => {
  it("reuses a fresh answer instead of asking again", async () => {
    const cache = createAiCache<string>(1000, () => 0);
    const fetcher = jest.fn().mockResolvedValue("a");
    expect(await cache.run("k", fetcher)).toBe("a");
    expect(await cache.run("k", fetcher)).toBe("a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBe("a");
  });

  it("asks again after the answer expires, or when forced", async () => {
    let now = 0;
    const cache = createAiCache<number>(1000, () => now);
    let n = 0;
    const fetcher = jest.fn(async () => ++n);
    await cache.run("k", fetcher);
    now = 500;
    await cache.run("k", fetcher, { force: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = 5000;
    expect(cache.get("k")).toBeNull();
    await cache.run("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("never sends two requests for one key at once, even when forced", async () => {
    const cache = createAiCache<string>(1000);
    let resolve: (v: string) => void = () => undefined;
    const fetcher = jest.fn(() => new Promise<string>((r) => { resolve = r; }));
    const a = cache.run("k", fetcher);
    const b = cache.run("k", fetcher, { force: true });
    expect(cache.pending("k")).toBe(true);
    resolve("x");
    expect(await Promise.all([a, b])).toEqual(["x", "x"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.pending("k")).toBe(false);
  });

  it("does not store a failure, so the next ask really asks", async () => {
    const cache = createAiCache<string>(1000);
    const fetcher = jest.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("ok");
    await expect(cache.run("k", fetcher)).rejects.toThrow("down");
    expect(cache.get("k")).toBeNull();
    expect(await cache.run("k", fetcher)).toBe("ok");
  });

  it("keeps keys apart (people, hotels, days never share an answer)", async () => {
    const cache = createAiCache<string>(1000);
    await cache.run("hotel-1:user-1:2026-10-14", async () => "mine");
    expect(cache.get("hotel-1:user-2:2026-10-14")).toBeNull();
    expect(cache.get("hotel-2:user-1:2026-10-14")).toBeNull();
  });
});

describe("briefing: the plan comes from the model, the AI only phrases it", () => {
  const t = makeTranslator("en");
  const NOW = new Date("2026-10-14T15:00:00.000Z");
  const rooms = () => [room("208", { status: "IN_PROGRESS" }), room("215"), room("216", { dnd_flag: true }), room("310", { status: "DIRTY" })];
  const model = () => build(rooms(), { sessions: { "208": session("208") } });

  it("lists the open room first, never a restricted room, each with a true reason", () => {
    const plan = buildBriefingPlan(model(), NOW);
    expect(plan[0]).toMatchObject({ roomNumber: "208", reason: "active" });
    expect(plan.map((entry) => entry.roomNumber)).not.toContain("216");
    expect(plan.every((entry) => ["active", "arrival", "reclean", "rush", "queue"].includes(entry.reason))).toBe(true);
  });

  it("marks an arrival only when the guest really arrives soon", () => {
    const soon = build([room("215", { checkin_time: "2026-10-14T16:00:00.000Z" }), room("310")]);
    const plan = buildBriefingPlan(soon, NOW);
    expect(plan.find((entry) => entry.roomNumber === "215")).toMatchObject({ reason: "arrival", arrivalAt: "2026-10-14T16:00:00.000Z" });
    expect(plan.find((entry) => entry.roomNumber === "310")?.reason).toBe("queue");
  });

  const local = () => buildBriefingFromModel(model(), t);
  const ai = (overrides: Partial<ShiftBriefing> = {}): ShiftBriefing => ({
    headline: "Start with 208 and keep an eye on arrivals.",
    plan: local().plan,
    watchouts: ["One room is under DND."],
    estimatedMinutes: 90,
    source: "ai",
    ...overrides,
  });
  const known = rooms().map((r) => r.room_number);

  it("keeps the AI's wording only while it agrees with the model", () => {
    const shown = reconcileBriefing(ai(), local(), known);
    expect(shown.source).toBe("ai");
    expect(shown.headline).toBe("Start with 208 and keep an eye on arrivals.");
    expect(shown.plan).toEqual(local().plan);
  });

  it("falls back to the local plan when the AI names a room that is not on the list", () => {
    const shown = reconcileBriefing(ai({ headline: "Start with room 999 right away." }), local(), known);
    expect(shown).toEqual(local());
  });

  it("falls back when the AI's order disagrees with the model", () => {
    const shown = reconcileBriefing(ai({ plan: ["310", "208"] }), local(), known);
    expect(shown.source).toBe("local");
  });

  it("drops only the invented watch-outs", () => {
    const shown = reconcileBriefing(ai({ watchouts: ["Room 999 has a flood.", "One room is under DND."] }), local(), known);
    expect(shown.watchouts).toEqual(["One room is under DND."]);
  });

  it("never lets an AI plan through: the plan shown is the model's", () => {
    const shown = reconcileBriefing(ai({ plan: [local().plan[0], "999"] }), local(), known);
    expect(shown.plan).toEqual(local().plan);
  });

  it("recognises room-number-looking tokens but not times or counts", () => {
    expect(mentionsUnknownRoom("Go to 999.", ["208"])).toBe(true);
    expect(mentionsUnknownRoom("Go to 208 at 1:00 PM, about 30 minutes.", ["208"])).toBe(false);
  });
});
