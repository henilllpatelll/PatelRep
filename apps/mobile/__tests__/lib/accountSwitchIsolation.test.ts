/* Flow O: person A signs out, person B signs in on the same phone. Nothing A had on this phone for the AI
   features — optional-feature switches, learned cleaning times, AI choices, the cached procedure list, a
   translation, the open conversation and shared briefing — may be visible to B. Real stores, no mocks of the
   modules under test; only the network and the SQLite room cache are faked. */
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/lib/offline/db", () => ({ clearRoomsCache: jest.fn().mockResolvedValue(undefined), upsertRooms: jest.fn().mockResolvedValue(undefined) }));

import { NO_CAPABILITIES, useAiCapabilities } from "@/lib/ai/capabilities";
import { DEFAULT_AI_PREFERENCES, currentAiPreferences, useAiPreferences } from "@/lib/ai/preferences";
import { lookupLearned, useEstimateTable } from "@/lib/housekeeping/estimateTable";
import { readSopCache, writeSopCache } from "@/lib/sop/offlineCache";
import { briefingCache } from "@/lib/ai/shiftBriefingSource";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const person = (id: string, tenant: string) => ({ id, tenant_id: tenant, role: "housekeeper" }) as unknown as UserProfile;
const A = "hotel-a:hk-1";
const B = "hotel-b:hk-2";

beforeEach(async () => {
  mockGet.mockReset();
  await AsyncStorage.clear();
  useAppStore.setState({ user: null, isAuthenticated: false, myRooms: [] });
  await useAiCapabilities.getState().hydrate(null);
  await useEstimateTable.getState().hydrate(null);
  useAiPreferences.getState().reset();
});

it("drops every AI-related thing A had on the phone the moment B signs in", async () => {
  useAppStore.getState().setUser(person("hk-1", "hotel-a"));

  // A's hotel has the assistant on, learned a cleaning time, and A chose Spanish answers.
  await useAiCapabilities.getState().hydrate(A);
  mockGet.mockResolvedValueOnce({ data: { unified_assistant: true, photo_analysis: true, task_translation: true } });
  await useAiCapabilities.getState().refresh(A, { now: Date.now() });
  await useEstimateTable.getState().hydrate(A);
  mockGet.mockResolvedValueOnce({ data: { estimates: [{ room_type_code: "KING", clean_type: "DEP", minutes: 22, sample_count: 40 }] } });
  await useEstimateTable.getState().refresh(A, { now: Date.now() });
  await useAiPreferences.getState().hydrate(A);
  await useAiPreferences.getState().update({ assistantLanguage: "es", voiceInput: false });
  await writeSopCache(A, [{ id: "d1", title: "Deep clean procedure" } as never]);
  await briefingCache.run("hotel-a:hk-1|2026-10-16|en", async () => ({ headline: "A's briefing" }) as never);

  // Sanity: A can see all of it.
  expect(useAiCapabilities.getState().capabilities.unifiedAssistant).toBe(true);
  expect(lookupLearned("KING", "DEP")?.minutes).toBe(22);
  expect(currentAiPreferences().assistantLanguage).toBe("es");
  expect((await readSopCache(A))?.docs).toHaveLength(1);
  expect(briefingCache.get("hotel-a:hk-1|2026-10-16|en")).not.toBeNull();

  // B signs in on the same phone (a different person at a different hotel).
  useAppStore.getState().setUser(person("hk-2", "hotel-b"));

  expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
  expect(useAiCapabilities.getState().scope).toBeNull();
  expect(lookupLearned("KING", "DEP")).toBeNull();
  expect(useEstimateTable.getState().entries).toEqual({});
  expect(currentAiPreferences()).toEqual(DEFAULT_AI_PREFERENCES);
  expect(await readSopCache(B)).toBeNull();
  expect(await readSopCache(A)).toBeNull(); // A's copy was removed, not just hidden
  expect(briefingCache.get("hotel-a:hk-1|2026-10-16|en")).toBeNull();
  expect(useAppStore.getState().myRooms).toEqual([]);
});

it("also clears on a plain sign-out", async () => {
  useAppStore.getState().setUser(person("hk-1", "hotel-a"));
  useAiCapabilities.setState({ scope: A, capabilities: { unifiedAssistant: true, photoAnalysis: true, taskTranslation: true }, fetchedAt: Date.now() });
  useAppStore.getState().setUser(null);
  expect(useAiCapabilities.getState().capabilities).toEqual(NO_CAPABILITIES);
});
