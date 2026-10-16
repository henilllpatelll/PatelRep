import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveEstimate } from "@/lib/housekeeping/cleaningEstimate";
import {
  ESTIMATE_MAX_AGE_MS,
  ESTIMATE_REFRESH_AFTER_MS,
  estimateStorageKey,
  lookupLearned,
  parseEstimates,
  useEstimateTable,
} from "@/lib/housekeeping/estimateTable";
import { buildDashboard } from "@/lib/housekeeping/myRoomsDashboard";
import { buildReadinessFacts } from "@/lib/housekeeping/roomAssist";
import { describeRecommendation } from "@/lib/housekeeping/homeText";
import { buildRecommendation } from "@/lib/housekeeping/homeRecommendation";
import type { Room } from "@/stores/appStore";
import { room } from "../helpers/homeModelFixture";

const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

const king = (id: string, minutes: number | null, extra: Partial<Room> = {}) =>
  room(id, { clean_type: "DEP", rooms: { room_types: { name: "King", code: "KING", base_clean_minutes: minutes } } as Room["rooms"], ...extra });

const payload = (minutes = 22) => ({
  data: { estimates: [{ room_type_code: "KING", clean_type: "DEP", minutes, sample_count: 40, holdout: { count: 12, baseline_mae: 8, model_mae: 3 } }] },
});

const NOW = 1_800_000_000_000;

beforeEach(async () => {
  mockGet.mockReset();
  await AsyncStorage.clear();
  await useEstimateTable.getState().hydrate(null);
});

describe("parseEstimates", () => {
  it("keeps only well-formed, plausible figures", () => {
    const parsed = parseEstimates({
      estimates: [
        { room_type_code: "king", clean_type: "DEP", minutes: 21.6, sample_count: 30 },
        { room_type_code: "KING", clean_type: "PICKUP", minutes: 20 },
        { room_type_code: "", clean_type: "DEP", minutes: 20 },
        { room_type_code: "QQ", clean_type: "DEP", minutes: 1 },
        { room_type_code: "QQ", clean_type: "DEP", minutes: 9999 },
        { room_type_code: "QQ", clean_type: "LIGHT", minutes: "12" },
        null,
        "junk",
      ],
    });
    expect(parsed).toEqual({ "KING|DEP": { minutes: 22, samples: 30 } });
    expect(parseEstimates(undefined)).toEqual({});
    expect(parseEstimates({ estimates: "no" })).toEqual({});
  });
});

describe("resolveEstimate", () => {
  it("is exactly the old baseline behaviour when nothing is learned", () => {
    expect(resolveEstimate(king("1", 30))).toEqual({ minutes: 30, basis: "room_type" });
    expect(resolveEstimate(king("1", null))).toEqual({ minutes: 30, basis: "general" });
    expect(resolveEstimate(room("1", { clean_type: "LIGHT" }))).toEqual({ minutes: 15, basis: "general" });
    expect(resolveEstimate(room("1", { status: "PICKUP", clean_type: null }))).toEqual({ minutes: 15, basis: "general" });
    expect(resolveEstimate(room("1", { clean_type: null }))).toEqual({ minutes: 25, basis: "general" });
  });

  it("uses a learned figure for the same room type and clean type only", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(22));
    await expect(useEstimateTable.getState().refresh("h1:u1", { now: NOW })).resolves.toBe(true);
    jest.spyOn(Date, "now").mockReturnValue(NOW + 1000);
    expect(resolveEstimate(king("1", 30))).toEqual({ minutes: 22, basis: "history" });
    expect(resolveEstimate(king("2", 30, { clean_type: "LIGHT" }))).toEqual({ minutes: 30, basis: "room_type" });
    expect(resolveEstimate(king("3", 30, { status: "PICKUP" }))).toEqual({ minutes: 30, basis: "room_type" });
    jest.restoreAllMocks();
  });

  it("is ignored once the table is older than a week (safe stale behaviour)", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(22));
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    expect(lookupLearned("KING", "DEP", NOW + ESTIMATE_MAX_AGE_MS - 1)).not.toBeNull();
    expect(lookupLearned("KING", "DEP", NOW + ESTIMATE_MAX_AGE_MS + 1)).toBeNull();
  });
});

describe("table lifecycle", () => {
  it("falls back silently when the request fails and keeps what it had", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(22));
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    mockGet.mockRejectedValueOnce(new Error("offline"));
    await expect(useEstimateTable.getState().refresh("h1:u1", { now: NOW + ESTIMATE_REFRESH_AFTER_MS + 1 })).resolves.toBe(false);
    expect(useEstimateTable.getState().entries["KING|DEP"]?.minutes).toBe(22);
  });

  it("does not refetch inside the refresh window and de-duplicates concurrent refreshes", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValue(payload(22));
    const [a, b] = await Promise.all([
      useEstimateTable.getState().refresh("h1:u1", { now: NOW }),
      useEstimateTable.getState().refresh("h1:u1", { now: NOW }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true); // joined the same request
    expect(mockGet).toHaveBeenCalledTimes(1);
    await expect(useEstimateTable.getState().refresh("h1:u1", { now: NOW + 1000 })).resolves.toBe(false);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("is restored from the phone for the same person and never shown to another", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(22));
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    expect(await AsyncStorage.getItem(estimateStorageKey("h1:u1"))).toContain("KING|DEP");

    await useEstimateTable.getState().hydrate("h2:u9"); // account / hotel switch
    expect(useEstimateTable.getState().entries).toEqual({});
    await useEstimateTable.getState().hydrate("h1:u1");
    expect(useEstimateTable.getState().entries["KING|DEP"]?.minutes).toBe(22);
    await useEstimateTable.getState().hydrate(null); // sign-out
    expect(useEstimateTable.getState().entries).toEqual({});
  });

  it("drops a response that arrives after the account changed", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    let release: (value: unknown) => void = () => {};
    mockGet.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const pending = useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    await useEstimateTable.getState().hydrate("h2:u2");
    release(payload(22));
    await expect(pending).resolves.toBe(false);
    expect(useEstimateTable.getState().entries).toEqual({});
  });

  it("ignores a damaged stored table", async () => {
    await AsyncStorage.setItem(estimateStorageKey("h1:u1"), "{not json");
    await useEstimateTable.getState().hydrate("h1:u1");
    expect(useEstimateTable.getState().entries).toEqual({});
  });

  it("bumps the version only when the usable table changes (memo invalidation)", async () => {
    const start = useEstimateTable.getState().version;
    await useEstimateTable.getState().hydrate("h1:u1");
    const afterHydrate = useEstimateTable.getState().version;
    expect(afterHydrate).toBeGreaterThan(start);
    mockGet.mockResolvedValueOnce(payload(22));
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    expect(useEstimateTable.getState().version).toBeGreaterThan(afterHydrate);
  });
});

describe("one contract across screens, and no effect on ordering", () => {
  it("Home why-line, My Rooms entry and Room Detail facts all show the same figure and basis", async () => {
    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(22));
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    jest.spyOn(Date, "now").mockReturnValue(NOW + 1000);

    const r = king("201", 30);
    const dash = buildDashboard([r], {}, new Date(NOW));
    const entry = [...dash.current, ...dash.upNext, ...dash.attention].find((e) => e.room.id === r.id)!;
    const facts = buildReadinessFacts(r);
    expect(entry.estimateMinutes).toBe(22);
    expect(entry.estimateBasis).toBe("history");
    expect(facts.estimate).toEqual({ minutes: 22, basis: "history" });

    const rec = buildRecommendation(dash, new Date(NOW));
    expect(rec).not.toBeNull();
    if (rec) {
      expect(rec.timing.estimateMinutes).toBe(22);
      expect(rec.timing.estimateBasis).toBe("history");
      const t = (key: string, o?: Record<string, unknown>) => `${key}|${o?.minutes ?? ""}`;
      expect(describeRecommendation(rec, t).estimate).toBe("home.why.estimateHistory|22");
    }
    jest.restoreAllMocks();
  });

  it("a faster learned time never changes the order of rooms", async () => {
    const rooms = [king("301", 30), king("302", 30), king("303", 30, { clean_type: "LIGHT" })];
    const order = (d: ReturnType<typeof buildDashboard>) => [...d.upNext, ...d.attention].map((e) => e.room.id);
    const before = order(buildDashboard(rooms, {}, new Date(NOW)));

    await useEstimateTable.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce(payload(5)); // dramatically faster
    await useEstimateTable.getState().refresh("h1:u1", { now: NOW });
    jest.spyOn(Date, "now").mockReturnValue(NOW + 1000);
    const after = order(buildDashboard(rooms, {}, new Date(NOW)));
    expect(after).toEqual(before);
    jest.restoreAllMocks();
  });
});
