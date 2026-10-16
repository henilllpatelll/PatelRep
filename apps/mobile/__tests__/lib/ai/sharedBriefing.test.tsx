const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: jest.fn(),
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { act, renderHook } from "@testing-library/react-native";
import type { ShiftBriefing } from "@/lib/ai/briefing";
import { useCopilotBrief } from "@/lib/ai/copilotCard";
import { resetAssistantSession } from "@/lib/ai/session";
import {
  briefingCache,
  briefingCacheKey,
  getPublishedBriefing,
  notifyBriefingChange,
  publishLocalBriefing,
  resetSharedBriefing,
} from "@/lib/ai/shiftBriefingSource";
import { readSharedBriefing } from "@/lib/ai/useSharedBriefing";
import { mentionsAnyRoom, reconcileBriefing } from "@/lib/housekeeping/homeBriefing";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const SCOPE = "hotel-a:alice";
const KEY = briefingCacheKey(SCOPE, "2026-10-15", "en");

const local: ShiftBriefing = {
  headline: "ai.briefing.startWith",
  plan: ["214", "216", "218"],
  watchouts: ["ai.briefing.dndWatchout"],
  estimatedMinutes: 75,
  source: "local",
};
const aiAnswer = (overrides: Partial<ShiftBriefing> = {}): ShiftBriefing => ({
  headline: "Start with 214, it has an early arrival.",
  plan: ["214", "999"],
  watchouts: ["Room 216 is calm today."],
  estimatedMinutes: 10,
  source: "ai",
  ...overrides,
});

const publish = () =>
  publishLocalBriefing({
    key: KEY,
    local,
    knownRooms: ["214", "216", "218", "220"],
    // 220 is Do Not Disturb: it must never be recommended.
    restrictedRooms: ["220"],
  });

function signInHousekeeper() {
  act(() => {
    useAppStore.getState().setUser({ id: "alice", tenant_id: "hotel-a", role: "housekeeper", effective_role: "housekeeper" } as unknown as UserProfile);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSharedBriefing();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
});

describe("reconcileBriefing never lets AI wording recommend a restricted room", () => {
  it("falls back to the authoritative briefing when the AI headline names a restricted room", () => {
    const ai = aiAnswer({ headline: "Start with 220, then 214.", plan: ["214"] });
    expect(reconcileBriefing(ai, local, ["214", "216", "218", "220"], ["220"])).toBe(local);
  });

  it("drops watch-out lines that name a restricted room and keeps the rest", () => {
    const ai = aiAnswer({ plan: ["214"], watchouts: ["Skip 220 for now", "Two arrivals before noon"] });
    const shown = reconcileBriefing(ai, local, ["214", "216", "218", "220"], ["220"]);
    expect(shown.watchouts).toEqual(["Two arrivals before noon"]);
    expect(shown.plan).toEqual(local.plan); // the order is always Home's own
  });

  it("falls back when the AI's first room is not Home's first room", () => {
    expect(reconcileBriefing(aiAnswer({ plan: ["216"] }), local, ["214", "216"], [])).toBe(local);
  });

  it("mentionsAnyRoom matches whole room numbers only", () => {
    expect(mentionsAnyRoom("Check 220 first", ["220"])).toBe(true);
    expect(mentionsAnyRoom("2200 guests", ["220"])).toBe(false);
    expect(mentionsAnyRoom("anything", [])).toBe(false);
  });
});

describe("the one shared briefing", () => {
  it("shows Home's deterministic briefing when there is no AI answer", () => {
    publish();
    expect(readSharedBriefing(SCOPE)).toEqual({ briefing: local, provenance: "deterministic" });
  });

  it("shows the stored AI answer only as wording over Home's plan, labelled as AI", async () => {
    publish();
    await briefingCache.run(KEY, async () => aiAnswer({ plan: ["214"] }));
    const view = readSharedBriefing(SCOPE)!;
    expect(view.provenance).toBe("ai");
    expect(view.briefing.headline).toBe("Start with 214, it has an early arrival.");
    expect(view.briefing.plan).toEqual(local.plan);
  });

  it("does not show a briefing that belongs to someone else", () => {
    publish();
    expect(readSharedBriefing("hotel-a:bob")).toBeNull();
    expect(readSharedBriefing("hotel-b:alice")).toBeNull();
    expect(readSharedBriefing(null)).toBeNull();
  });

  it("is forgotten when the assistant session resets (sign-out / account switch)", async () => {
    publish();
    await briefingCache.run(KEY, async () => aiAnswer({ plan: ["214"] }));
    resetAssistantSession();
    expect(getPublishedBriefing()).toBeNull();
    expect(briefingCache.get(KEY)).toBeNull();
    expect(readSharedBriefing(SCOPE)).toBeNull();
  });

  it("ignores identical republishes so readers are not re-rendered for nothing", () => {
    publish();
    const first = getPublishedBriefing();
    publish();
    expect(getPublishedBriefing()).toBe(first);
  });
});

describe("the floating assistant never buys a briefing", () => {
  it("makes no request for a housekeeper — on mount, re-render, or tab switches", () => {
    signInHousekeeper();
    publish();
    const first = renderHook(() => useCopilotBrief());
    expect(first.result.current.brief?.brief).toBe("ai.briefing.startWith");
    expect(first.result.current.loading).toBe(false);
    first.rerender({});
    first.unmount();
    // switching tabs mounts it again
    const second = renderHook(() => useCopilotBrief());
    second.rerender({});
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("labels its source and invents no confidence score", () => {
    signInHousekeeper();
    publish();
    const { result } = renderHook(() => useCopilotBrief());
    expect(result.current.brief).toMatchObject({
      confidence: null,
      provenance: "deterministic",
      sources: [],
      primaryRoute: "/(app)/my-rooms",
      secondaryDismiss: true,
      chipsAreInfo: true,
    });
  });

  it("picks up an AI answer Home paid for, without asking for one itself", async () => {
    signInHousekeeper();
    publish();
    const { result } = renderHook(() => useCopilotBrief());
    expect(result.current.brief?.provenance).toBe("deterministic");
    await act(async () => {
      await briefingCache.run(KEY, async () => aiAnswer({ plan: ["214"] }));
      notifyBriefingChange();
    });
    expect(result.current.brief).toMatchObject({ provenance: "ai", brief: "Start with 214, it has an early arrival." });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("shows nothing until Home has published (it never guesses an order of its own)", () => {
    signInHousekeeper();
    const { result } = renderHook(() => useCopilotBrief());
    expect(result.current.brief).toBeNull();
    expect(result.current.error).toBe(false);
  });

  it("does not show one person's briefing to the next person on the device", () => {
    signInHousekeeper();
    publish();
    const { result } = renderHook(() => useCopilotBrief());
    expect(result.current.brief).not.toBeNull();
    act(() => {
      useAppStore.getState().setUser({ id: "bob", tenant_id: "hotel-a", role: "housekeeper", effective_role: "housekeeper" } as unknown as UserProfile);
    });
    expect(result.current.brief).toBeNull();
  });
});
