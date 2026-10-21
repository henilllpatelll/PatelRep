import AsyncStorage from "@react-native-async-storage/async-storage";
import { render } from "@testing-library/react-native";
import { bind, NOW, settle, standardTemplate } from "./workspaceHarness";
import { readyRoom } from "./inspectionFixtures";

/* ─── The fakes behind every active-inspection screen test ──────────────────
   Import this module FIRST in a test file: its `jest.mock` calls must be registered before the screen is loaded.
   Only the network, the router, the translator, the realtime channel and the clock are replaced. The screen, hook,
   rules and components are real, and AsyncStorage is the library's in-memory mock, so drafts really are written and
   read back. */

// The first render loads the whole screen graph; on a busy machine that can pass the default 5 s.
jest.setTimeout(30000);

export const mockState = {
  params: {} as Record<string, string | undefined>,
  language: "en" as "en" | "es",
  scheme: "light" as "light" | "dark",
};

jest.mock("expo-router", () => {
  const react = require("react");
  return {
    router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), setParams: jest.fn() },
    useLocalSearchParams: () => mockState.params,
    useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]),
  };
});
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("./i18n");
  const english = translator("en");
  const spanish = translator("es");
  const i18n = { get language() { return mockState.language; } };
  return { useTranslation: () => ({ t: mockState.language === "es" ? spanish : english, i18n }) };
});
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockState.scheme }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
export const mockSubscribe = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
export const mockQueue = jest.fn();
jest.mock("@/lib/api/inspections", () => ({
  listInspectionTemplates: jest.fn(),
  submitInspection: jest.fn(),
  completeInspection: jest.fn(),
  fetchReadyForInspection: (...args: unknown[]) => mockQueue(...args),
  fetchReadyForInspectionVerified: (...args: unknown[]) => mockQueue(...args),
  fetchOpenCorrections: jest.fn(),
  fetchInspectionRecords: jest.fn(),
  fetchInspectionDetail: jest.fn(),
}));
jest.mock("@/lib/api/roomPanels", () => ({
  fetchCleanSessions: jest.fn(),
  fetchRoomHistory: jest.fn(),
  fetchRoomInspections: jest.fn(),
  fetchRoomWorkOrders: jest.fn(),
  ROOM_WORK_ORDER_FETCH_LIMIT: 50,
}));
// Short pause so autosave tests do not wait most of a second; the real value is covered in useDraftWriter.test.
jest.mock("@/lib/inspections/useDraftWriter", () => {
  const actual = jest.requireActual("@/lib/inspections/useDraftWriter");
  return { ...actual, useDraftWriter: (options: object = {}) => actual.useDraftWriter({ delayMs: 15, ...options }) };
});

import { router } from "expo-router";
import * as inspectionsApi from "@/lib/api/inspections";
import * as roomPanels from "@/lib/api/roomPanels";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider, ToastViewport } from "@/lib/theme/ToastProvider";
import { useAppStore } from "@/stores/appStore";

export const mockTemplates = inspectionsApi.listInspectionTemplates as jest.Mock;
export const mockSubmitLegacy = inspectionsApi.submitInspection as jest.Mock;
export const mockComplete = inspectionsApi.completeInspection as jest.Mock;
export const mockCorrections = inspectionsApi.fetchOpenCorrections as jest.Mock;
export const mockRecords = inspectionsApi.fetchInspectionRecords as jest.Mock;
export const mockSessions = roomPanels.fetchCleanSessions as jest.Mock;
export const mockHistory = roomPanels.fetchRoomHistory as jest.Mock;
export const mockPrevious = roomPanels.fetchRoomInspections as jest.Mock;
export const mockOrders = roomPanels.fetchRoomWorkOrders as jest.Mock;
export const navigate = router.navigate as jest.Mock;
export const push = router.push as jest.Mock;

export const room205 = (over = {}) =>
  readyRoom("room-205", {
    room_number: "205", floor: 2, clean_type: "DEP", cleaned_by: "Maria S.", cleaned_at: "2026-10-20T16:42:00Z",
    room_type_id: "type-king", room_type_name: "Standard King", clean_cycle_id: "cycle-1", ...over,
  });

export const SUPERVISOR = { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" };

/** Reset every fake to the ordinary, healthy hotel: one supervisor, two rooms waiting, one default checklist. */
export async function resetWorld(): Promise<jest.SpyInstance> {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockState.params = {};
  mockState.language = "en";
  mockState.scheme = "light";
  const dateNow = jest.spyOn(Date, "now").mockReturnValue(NOW);
  mockQueue.mockReset();
  mockQueue.mockResolvedValue([room205(), readyRoom("room-305", { room_number: "305", floor: 3, room_type_id: "type-suite" })]);
  mockTemplates.mockReset();
  mockTemplates.mockResolvedValue({ data: [standardTemplate()] });
  mockCorrections.mockResolvedValue({ rows: [], truncated: false });
  mockRecords.mockResolvedValue([]);
  mockSessions.mockResolvedValue([]);
  mockHistory.mockResolvedValue([]);
  mockPrevious.mockResolvedValue([]);
  mockOrders.mockResolvedValue([]);
  mockSubscribe.mockImplementation(() => jest.fn());
  useAppStore.setState({ hotelTimezone: "America/Chicago", isOnline: true, user: SUPERVISOR as never });
  return dateNow;
}

export function renderWorkspace() {
  const Workspace = require("@/app/(app)/inspect/[roomId]").default as () => import("react").ReactElement;
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ToastViewport topOffset={0} />
        <Workspace />
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** Open the workspace for a room link and let the queue, checklists and any saved draft load. */
export async function openWorkspace(params: Record<string, string> = { roomId: "room-205", roomNumber: "205", from: "queue" }) {
  mockState.params = params;
  const screen = renderWorkspace();
  await settle();
  return { screen, ...bind(screen) };
}

/**
 * Make one AsyncStorage method fail. Returns a function that puts the real one back. (The library's mock methods are
 * jest.fn with built-in behaviour, so spyOn + restore would wipe them for every later test.)
 */
export function failStorage(method: "setItem" | "getItem" | "removeItem", times = Infinity): () => void {
  const store = AsyncStorage as unknown as Record<string, unknown>;
  const real = store[method] as (...args: unknown[]) => unknown;
  let left = times;
  store[method] = (...args: unknown[]) => (left-- > 0 ? Promise.reject(new Error(`${method} failed`)) : real(...args));
  return () => {
    store[method] = real;
  };
}
/** Count calls to an AsyncStorage method while it still does its job. */
export function watchStorage(method: "setItem" | "getItem" | "removeItem"): { calls: () => number; reset: () => void; stop: () => void } {
  const store = AsyncStorage as unknown as Record<string, unknown>;
  const real = store[method] as (...args: unknown[]) => unknown;
  let n = 0;
  store[method] = (...args: unknown[]) => {
    n += 1;
    return real(...args);
  };
  return { calls: () => n, reset: () => { n = 0; }, stop: () => { store[method] = real; } };
}

export { AsyncStorage, useAppStore };
