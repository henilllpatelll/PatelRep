import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CAPABILITIES_MAX_AGE_MS,
  CAPABILITIES_REFRESH_AFTER_MS,
  NO_CAPABILITIES,
  capabilitiesStorageKey,
  parseCapabilities,
  useAiCapabilities,
} from "@/lib/ai/capabilities";

const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

const ALL_ON = { unified_assistant: true, photo_analysis: true, task_translation: true };
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  mockGet.mockReset();
  await AsyncStorage.clear();
  await useAiCapabilities.getState().hydrate(null);
  jest.restoreAllMocks();
});

describe("parseCapabilities", () => {
  it("switches a feature on only for an explicit true", () => {
    expect(parseCapabilities({ unified_assistant: true, photo_analysis: "true", task_translation: 1 })).toEqual({
      unifiedAssistant: true,
      photoAnalysis: false,
      taskTranslation: false,
    });
    expect(parseCapabilities(null)).toEqual(NO_CAPABILITIES);
    expect(parseCapabilities("on")).toEqual(NO_CAPABILITIES);
    expect(parseCapabilities({})).toEqual(NO_CAPABILITIES);
  });
});

describe("capabilities store", () => {
  it("is off before anything is known, and when signed out", async () => {
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
    await useAiCapabilities.getState().hydrate("h1:u1");
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
  });

  it("turns features on from the server's answer and remembers it for this person", async () => {
    await useAiCapabilities.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce({ data: ALL_ON });
    await expect(useAiCapabilities.getState().refresh("h1:u1", { now: NOW })).resolves.toBe(true);
    expect(useAiCapabilities.getState().capabilities).toEqual({ unifiedAssistant: true, photoAnalysis: true, taskTranslation: true });

    await useAiCapabilities.getState().hydrate("h2:u2"); // another hotel never sees them
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
    jest.spyOn(Date, "now").mockReturnValue(NOW + 1000);
    await useAiCapabilities.getState().hydrate("h1:u1");
    expect(useAiCapabilities.getState().capabilities.unifiedAssistant).toBe(true);
  });

  it("an operator switching a feature off takes effect on the next refresh", async () => {
    await useAiCapabilities.getState().hydrate("h1:u1");
    mockGet.mockResolvedValueOnce({ data: ALL_ON });
    await useAiCapabilities.getState().refresh("h1:u1", { now: NOW });
    mockGet.mockResolvedValueOnce({ data: { ...ALL_ON, photo_analysis: false } });
    await useAiCapabilities.getState().refresh("h1:u1", { now: NOW + CAPABILITIES_REFRESH_AFTER_MS + 1 });
    expect(useAiCapabilities.getState().capabilities).toEqual({ unifiedAssistant: true, photoAnalysis: false, taskTranslation: true });
  });

  it("keeps the last answer when the service cannot be reached, and stays off if there never was one", async () => {
    await useAiCapabilities.getState().hydrate("h1:u1");
    mockGet.mockRejectedValueOnce(new Error("offline"));
    await expect(useAiCapabilities.getState().refresh("h1:u1", { now: NOW })).resolves.toBe(false);
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);

    mockGet.mockResolvedValueOnce({ data: ALL_ON });
    await useAiCapabilities.getState().refresh("h1:u1", { now: NOW });
    mockGet.mockRejectedValueOnce(new Error("offline"));
    await useAiCapabilities.getState().refresh("h1:u1", { now: NOW + CAPABILITIES_REFRESH_AFTER_MS + 1 });
    expect(useAiCapabilities.getState().capabilities.photoAnalysis).toBe(true);
  });

  it("does not ask again inside the refresh window and shares one in-flight request", async () => {
    await useAiCapabilities.getState().hydrate("h1:u1");
    mockGet.mockResolvedValue({ data: ALL_ON });
    await Promise.all([
      useAiCapabilities.getState().refresh("h1:u1", { now: NOW }),
      useAiCapabilities.getState().refresh("h1:u1", { now: NOW }),
    ]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await expect(useAiCapabilities.getState().refresh("h1:u1", { now: NOW + 1000 })).resolves.toBe(false);
    await expect(useAiCapabilities.getState().refresh("h1:u1", { now: NOW + 1000, force: true })).resolves.toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("ignores a stored answer older than a week", async () => {
    await AsyncStorage.setItem(
      capabilitiesStorageKey("h1:u1"),
      JSON.stringify({ fetchedAt: NOW - CAPABILITIES_MAX_AGE_MS - 1, capabilities: { unifiedAssistant: true, photoAnalysis: true, taskTranslation: true } }),
    );
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    await useAiCapabilities.getState().hydrate("h1:u1");
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
  });

  it("ignores a damaged stored answer and drops a reply that arrives after the account changed", async () => {
    await AsyncStorage.setItem(capabilitiesStorageKey("h1:u1"), "{broken");
    await useAiCapabilities.getState().hydrate("h1:u1");
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);

    let release: (value: unknown) => void = () => {};
    mockGet.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const pending = useAiCapabilities.getState().refresh("h1:u1", { now: NOW });
    await useAiCapabilities.getState().hydrate("h2:u2");
    release({ data: ALL_ON });
    await expect(pending).resolves.toBe(false);
    expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
  });
});
