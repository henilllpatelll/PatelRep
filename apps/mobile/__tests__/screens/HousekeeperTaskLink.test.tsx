import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, waitFor } from "@testing-library/react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

// A tapped task notification: the screen re-reads the task as the signed-in person and opens it only if the
// server still shows it to them.
let mockLanguage: "en" | "es" = "en";
const mockDictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], mockDictionaries[mockLanguage]);
  const template = typeof found === "string" ? found : key;
  return values ? template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`)) : template;
}

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => mockTranslate(key, values),
    i18n: { language: mockLanguage, resolvedLanguage: mockLanguage },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let mockParams: Record<string, string | undefined> = {};
const mockSetParams = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: jest.fn(), back: jest.fn(), setParams: (...args: unknown[]) => mockSetParams(...args) },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void) => {
      useEffect(callback, [callback]);
    },
  };
});

const mockApiGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockApiGet(...args), post: jest.fn(), patch: jest.fn() } }));

let mockOnline = true;
let mockUserId = "me";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      user: { id: mockUserId, tenant_id: "hotel-1", role: "housekeeper", language_pref: mockLanguage },
      hotelTimezone: "America/Chicago",
      pendingActions: [],
      myRooms: [],
      setHotelTimezone: () => undefined,
    })),
  };
});

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import TasksRoute from "@/app/(app)/tasks";

const LINKED = "3f2b1c9e-5a7d-4e2f-9c1a-0b8d6e4f7a21";
const at = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
const linkedRow = {
  id: LINKED,
  title: "Fix the leaking tap",
  status: "open",
  task_type: "housekeeping",
  priority: "urgent",
  assigned_to: "me",
  created_at: at(-60),
  due_at: at(60),
  rooms: { room_number: "118", floor: 1 },
};

let linkedResponse: () => Promise<unknown>;
beforeEach(async () => {
  await AsyncStorage.clear();
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} });
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  mockUserId = "me";
  mockParams = { taskId: LINKED };
  linkedResponse = async () => ({ data: linkedRow });
  mockApiGet.mockImplementation(async (path: string) => {
    if (path === `/tasks/${LINKED}`) return linkedResponse();
    if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) return { data: [], meta: { has_more: false } };
    if (path.startsWith("/tasks/available")) return { data: [], meta: { has_more: false } };
    if (path.endsWith("/activity")) return { data: { task: linkedRow, events: [] }, meta: { truncated: false } };
    throw new Error(`unexpected GET ${path}`);
  });
});

const renderRoute = () =>
  render(
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>,
  );
const linkLookups = () => mockApiGet.mock.calls.filter((call) => call[0] === `/tasks/${LINKED}`).length;

describe("notification deep link to a task", () => {
  it("opens the task the server returns, even when it is not in the loaded lists, then consumes the link once", async () => {
    const screen = renderRoute();
    await waitFor(() => expect(screen.getAllByText("Fix the leaking tap").length).toBeGreaterThan(0));
    expect(linkLookups()).toBe(1);
    await waitFor(() => expect(mockSetParams).toHaveBeenCalledWith({ taskId: undefined }));
  });

  it("never looks up anything for a malformed id", async () => {
    mockParams = { taskId: "../../admin" };
    renderRoute();
    await act(async () => {});
    expect(linkLookups()).toBe(0);
    expect(mockApiGet.mock.calls.some((call) => String(call[0]).includes("admin"))).toBe(false);
  });

  it("says the task is unavailable when the server refuses it (deleted, reassigned away, another hotel)", async () => {
    linkedResponse = async () => {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    };
    const screen = renderRoute();
    await waitFor(() => expect(screen.getByText("That task isn't available to you anymore.")).toBeTruthy());
    expect(screen.queryByText("Fix the leaking tap")).toBeNull();
  });

  it("offers a retry message for a temporary failure, not a false 'unavailable'", async () => {
    linkedResponse = async () => {
      throw Object.assign(new Error("HTTP 503"), { status: 503 });
    };
    const screen = renderRoute();
    await waitFor(() => expect(screen.getByText("Couldn't open that task. Check your connection and try again.")).toBeTruthy());
  });

  it("does not open cached details offline; it asks the person to connect", async () => {
    mockOnline = false;
    const screen = renderRoute();
    await waitFor(() => expect(screen.getByText("Connect to the internet to open that task.")).toBeTruthy());
    expect(linkLookups()).toBe(0);
  });

  it("shows the Spanish message", async () => {
    mockLanguage = "es";
    linkedResponse = async () => {
      throw Object.assign(new Error("HTTP 403"), { status: 403 });
    };
    const screen = renderRoute();
    await waitFor(() => expect(screen.getByText("Esa tarea ya no está disponible para ti.")).toBeTruthy());
  });

  it("opens nothing when the account changed while the lookup was in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    linkedResponse = () => new Promise((resolve) => (release = resolve));
    const screen = renderRoute();
    await waitFor(() => expect(linkLookups()).toBe(1));
    mockUserId = "someone-else";
    await act(async () => release({ data: linkedRow }));
    expect(screen.queryByText("Fix the leaking tap")).toBeNull();
  });
});
