import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { localeHasKey, makeTranslator } from "../helpers/i18n";

/* Engineering Tools (Phase 4): My Schedule and the SOP Library are opened from More, so they need a way back to where the
   person came from (More when there is no history), and the same screens must stay unchanged for every other role. */

let mockCanGoBack = true;
let mockRole = "engineer";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => mockCanGoBack },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/voice/speechModule", () => ({ isSpeechAvailable: () => false }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/api/sop", () => ({ listLibrary: jest.fn(), getLibraryDocument: jest.fn(), getLibraryFile: jest.fn() }));
jest.mock("@/lib/ai/AssistantProvider", () => ({ useAssistantOptional: () => null }));
jest.mock("@/stores/appStore", () => {
  const state = () => ({ isOnline: true, hotelTimezone: "America/Chicago", user: { id: "u1", role: mockRole, effective_role: mockRole, tenant_id: "h1" } });
  return { useAppStore: (selector?: (s: unknown) => unknown) => (selector ? selector(state()) : state()) };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import SchedulingScreen from "@/app/(app)/scheduling/index";
import SopLibraryScreen from "@/app/(app)/sop/index";
import { api } from "@/lib/api/client";
import { listLibrary } from "@/lib/api/sop";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const get = api.get as jest.Mock;
const tr = makeTranslator("en");
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const wrap = (node: React.ReactNode) => <ThemeProvider>{node}</ThemeProvider>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockCanGoBack = true;
  mockRole = "engineer";
  get.mockImplementation(async (url: string) => {
    if (url === "/schedules/me/requests") return { data: [], meta: { counts: { action_required: 0 } } };
    if (url.startsWith("/schedules/me/offers")) return { data: [] };
    if (url.startsWith("/schedules/assignments/my-schedule")) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  (listLibrary as jest.Mock).mockResolvedValue({ data: [] });
});

describe("My Schedule from More", () => {
  it.each(["engineer", "chief_engineer"])("%s gets a title, a plain subtitle and a back control that returns to the previous screen", async (role) => {
    mockRole = role;
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    expect(screen.getByText(tr("scheduling.title"))).toBeTruthy();
    expect(screen.getByTestId("my-schedule-subtitle")).toHaveTextContent("Your shifts and availability");
    fireEvent.press(screen.getByTestId("my-schedule-back"));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("falls back to More when opened with no history (deep link)", async () => {
    mockCanGoBack = false;
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    fireEvent.press(screen.getByTestId("my-schedule-back"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/more");
  });

  it("still reaches availability, time off, requests and offers", async () => {
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    for (const [id, path] of [["availability", "availability"], ["time-off", "time-off"], ["requests", "requests"], ["offers", "offers"]] as const) {
      fireEvent.press(screen.getByTestId(`schedule-action-${id}`));
      expect(router.push).toHaveBeenLastCalledWith(`/(app)/scheduling/${path}`);
    }
  });

  it("does not change the screen for other roles", async () => {
    mockRole = "housekeeper";
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    expect(screen.queryByTestId("my-schedule-back")).toBeNull();
    expect(screen.queryByTestId("my-schedule-subtitle")).toBeNull();
  });
});

describe("SOP Library from More", () => {
  it("names itself SOPs & Procedures for engineers and returns to More without history", async () => {
    mockCanGoBack = false;
    const screen = render(wrap(<SopLibraryScreen />));
    await settle();
    expect(screen.getByText("SOPs & Procedures")).toBeTruthy();
    fireEvent.press(screen.getByTestId("sop-back"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/more");
  });

  it("uses the previous screen when there is history", async () => {
    const screen = render(wrap(<SopLibraryScreen />));
    await settle();
    fireEvent.press(screen.getByTestId("sop-back"));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing heading and Home fallback for other roles", async () => {
    mockRole = "housekeeper";
    mockCanGoBack = false;
    const screen = render(wrap(<SopLibraryScreen />));
    await settle();
    expect(screen.queryByText("SOPs & Procedures")).toBeNull();
    expect(screen.getAllByText(tr("sop.kicker")).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId("sop-back"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/home");
  });
});

describe("Engineering Tools strings", () => {
  it.each(["en", "es"] as const)("%s carries every new key", (lang) => {
    for (const key of ["engRooms.title", "engRooms.subtitle", "scheduling.engineeringSubtitle", "sop.libraryTitle"]) {
      expect(localeHasKey(lang, key)).toBe(true);
    }
  });
});
