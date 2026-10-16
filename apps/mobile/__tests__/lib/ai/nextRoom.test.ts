import { build, room } from "../../helpers/homeModelFixture";
import { leadOf } from "@/lib/housekeeping/homeState";
import { nextRoomFromRecommendation, readNextRoom } from "@/lib/ai/nextRoom";
import { briefingCacheKey, getPublishedBriefing, publishLocalBriefing, resetSharedBriefing } from "@/lib/ai/shiftBriefingSource";

// The same keys-as-text translator the other Home text tests use: it proves WHICH sentence is chosen, not its wording.
const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);

const briefing = (nextRoom: ReturnType<typeof nextRoomFromRecommendation>) => ({
  key: briefingCacheKey("hotel-a:alice", "2026-10-14", "en"),
  local: { headline: "h", plan: ["214"], watchouts: [], estimatedMinutes: 30, source: "local" } as never,
  knownRooms: ["214"],
  restrictedRooms: [],
  nextRoom,
});

beforeEach(() => resetSharedBriefing());

describe("My next room comes from Home's own ranking", () => {
  it("turns the lead recommendation into the room the assistant shows", () => {
    const model = build([room("214"), room("216")]);
    const lead = leadOf(model);
    expect(lead).not.toBeNull();
    const next = nextRoomFromRecommendation(lead, t, {});
    expect(next).toMatchObject({ roomId: lead!.room.id, roomNumber: lead!.room.room_number, kind: lead!.kind });
    expect(next!.estimateMinutes).toBe(lead!.timing.estimateMinutes);
    expect(next!.reason).not.toBe("");
  });

  it("has nothing to show when Home has nothing to recommend, and never invents a room", () => {
    expect(nextRoomFromRecommendation(null, t, {})).toBeNull();
    const done = build([room("214", { status: "CLEAN" })]);
    expect(nextRoomFromRecommendation(leadOf(done), t, {})).toBeNull();
  });
});

describe("reading the published next room", () => {
  const next = { roomId: "r1", roomNumber: "214", kind: "start" as const, context: "Departure", reason: "Queue order", estimateMinutes: 30 };

  it("returns the room only to the person it was published for", () => {
    publishLocalBriefing(briefing(next));
    expect(readNextRoom("hotel-a:alice")).toEqual(next);
    expect(readNextRoom("hotel-a:bob")).toBeNull();
    expect(readNextRoom("hotel-b:alice")).toBeNull();
    expect(readNextRoom(null)).toBeNull();
  });

  it("is gone after sign-out or an account switch", () => {
    publishLocalBriefing(briefing(next));
    resetSharedBriefing();
    expect(readNextRoom("hotel-a:alice")).toBeNull();
  });

  it("keeps the same object while nothing changed, and replaces it when the ranking does", () => {
    publishLocalBriefing(briefing(next));
    const first = getPublishedBriefing();
    publishLocalBriefing(briefing({ ...next }));
    expect(getPublishedBriefing()).toBe(first);
    publishLocalBriefing(briefing({ ...next, roomId: "r2", roomNumber: "216" }));
    expect(readNextRoom("hotel-a:alice")?.roomNumber).toBe("216");
  });

  it("treats an older publisher without a next room as having none", () => {
    const { nextRoom: _omit, ...older } = briefing(next);
    publishLocalBriefing(older);
    expect(readNextRoom("hotel-a:alice")).toBeNull();
  });
});
