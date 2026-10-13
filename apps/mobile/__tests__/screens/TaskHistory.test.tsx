import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

let mockLanguage: "en" | "es" = "en";
const dictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
const fill = (template: string, values?: Record<string, unknown>) =>
  values ? template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`)) : template;
function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const find = (k: string) => k.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[mockLanguage]);
  const plural = values && typeof values.count === "number" ? find(`${key}${values.count === 1 ? "" : "_plural"}`) : undefined;
  const found = typeof plural === "string" ? plural : find(key);
  return fill(typeof found === "string" ? found : key, values);
}
const T = (key: string, values?: Record<string, unknown>) => {
  const previous = mockLanguage;
  mockLanguage = "en";
  const text = mockTranslate(key, values);
  mockLanguage = previous;
  return text;
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => mockTranslate(key, values),
    i18n: { language: mockLanguage, resolvedLanguage: mockLanguage },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: (...args: unknown[]) => mockBack(...args) } }));

const mockApiGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockApiGet(...args), post: jest.fn(), patch: jest.fn() } }));

let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      user: { id: "me", tenant_id: "hotel-1", role: "housekeeper", language_pref: mockLanguage },
      hotelTimezone: "America/Chicago",
      pendingActions: [],
      myRooms: [],
      setHotelTimezone: () => undefined,
    })),
  };
});

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TaskHistoryScreen from "@/app/(app)/tasks/history";
import { normalizeTask } from "@/lib/api/tasks";
import { saveHistoryFirstPage } from "@/lib/tasks/offline/taskCache";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";

const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
function done(id: string, title: string, completedAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    status: "completed",
    task_type: "guest_request",
    priority: "normal",
    assigned_to: "me",
    created_at: ago(30),
    completed_at: completedAt,
    rooms: null,
    ...extra,
  };
}
const TODAY_1 = done("towels", "Deliver towels", new Date(NOW - 60_000).toISOString(), { rooms: { room_number: "210", floor: 2 } });
const TODAY_2 = done("cart", "Restock floor 2 cart", new Date(NOW - 120_000).toISOString(), { location_text: "Floor 2" });
const YESTERDAY = done("blanket", "Extra blanket delivery", ago(24), { rooms: { room_number: "218", floor: 2 } });

type Page = { data: unknown[]; meta: Record<string, unknown> };
let pages: Record<string, Page>;
function serve() {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) {
      const cursor = /cursor=([^&]+)/.exec(path)?.[1];
      return pages[cursor ? decodeURIComponent(cursor) : "first"];
    }
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) {
      const found = Object.values(pages).flatMap((p) => p.data).find((t) => (t as { id: string }).id === activity[1]);
      return { data: { task: found, events: [{ id: "c1", kind: "comment", at: ago(0.5), actor_id: "me", actor_name: "Me", text: "Left outside door" }] }, meta: { truncated: false } };
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

function ui() {
  return (
    <ThemeProvider>
      <TaskHistoryScreen />
    </ThemeProvider>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {}, settledTick: 0, lastConfirmedAt: null });
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  pages = { first: { data: [TODAY_1, TODAY_2, YESTERDAY], meta: { has_more: false } } };
  serve();
});

describe("Completed Tasks history", () => {
  it("lists the employee's completed tasks grouped by hotel day, newest first, with room or location and completion time", async () => {
    const screen = render(ui());

    expect(await screen.findByText("Room 210 — Deliver towels")).toBeTruthy();
    expect(screen.getByText("Floor 2 — Restock floor 2 cart")).toBeTruthy();
    expect(screen.getByText("Room 218 — Extra blanket delivery")).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.hist.today"))).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.hist.yesterday"))).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.hist.recent"))).toBeTruthy();
    expect(screen.getAllByText(/^Completed \d{1,2}:\d{2} (AM|PM)$/).length).toBe(3);
    const titles = screen.getAllByText(/ — /).map((node) => node.props.children as string);
    expect(titles.indexOf("Room 210 — Deliver towels")).toBeLessThan(titles.indexOf("Floor 2 — Restock floor 2 cart"));
  });

  it("headlines the server's count for today — two here — not a local counter", async () => {
    const screen = render(ui());

    await waitFor(() => expect(screen.getByTestId("history-done-today").props.children).toBe("2 completed today"));
  });

  it("never lists a completion that is only saved on the device", async () => {
    useTaskOutbox.setState({
      scope: "hotel-1:me",
      hydrated: true,
      entries: {
        pending: {
          mutationId: "m",
          op: "complete",
          taskId: "pending",
          userId: "me",
          tenantId: "hotel-1",
          task: normalizeTask(done("pending", "Saved only on this phone", ago(0)) as never),
          note: null,
          observedStatus: "in_progress",
          observedAssignee: "me",
          queuedAt: ago(0),
          attempts: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          state: "pending",
          conflict: null,
        },
      },
    });
    const screen = render(ui());

    await screen.findByText("Room 210 — Deliver towels");
    expect(screen.queryByText(/Saved only on this phone/)).toBeNull();
    expect(screen.getByTestId("history-done-today").props.children).not.toBe("3 completed today");
  });

  it("paginates with the server cursor, appends without duplicates and keeps the order", async () => {
    pages = {
      first: { data: [TODAY_1, TODAY_2], meta: { has_more: true, next_cursor: "cur-2" } },
      "cur-2": { data: [TODAY_2, YESTERDAY], meta: { has_more: false } },
    };
    const screen = render(ui());
    await screen.findByText("Room 210 — Deliver towels");

    fireEvent.press(screen.getByTestId("history-load-more"));

    expect(await screen.findByText("Room 218 — Extra blanket delivery")).toBeTruthy();
    expect(screen.getAllByText("Floor 2 — Restock floor 2 cart")).toHaveLength(1);
    expect(mockApiGet).toHaveBeenCalledWith(expect.stringContaining("cursor=cur-2"));
    expect(screen.queryByTestId("history-load-more")).toBeNull();
  });

  it("shows a useful empty state, different from an error", async () => {
    pages = { first: { data: [], meta: { has_more: false } } };

    const screen = render(ui());

    expect(await screen.findByText(T("tasks.hk.historyEmpty"))).toBeTruthy();
  });

  it("shows an error with Retry when the first load fails and nothing is saved", async () => {
    mockApiGet.mockRejectedValue(new Error("Network request failed"));

    const screen = render(ui());

    expect(await screen.findByText(T("tasks.hk.historyFailed"))).toBeTruthy();
    expect(screen.getByText(T("common.retry"))).toBeTruthy();
  });

  it("opens a read-only detail with no actions, and shows the completion note when the connection allows", async () => {
    const screen = render(ui());

    fireEvent.press(await screen.findByTestId("history-row-towels"));

    const sheet = await screen.findByTestId("task-detail-sheet");
    expect(within(sheet).getByText(T("tasks.hk.sheet.readOnly.completed"))).toBeTruthy();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
    expect(screen.queryByTestId("detail-start")).toBeNull();
    expect(await within(sheet).findByText("Left outside door")).toBeTruthy();
  });

  it("goes back from the header", async () => {
    const screen = render(ui());
    await screen.findByText("Room 210 — Deliver towels");

    fireEvent.press(screen.getByTestId("history-back"));

    expect(mockBack).toHaveBeenCalled();
  });
});

describe("Completed Tasks history — offline", () => {
  const savedPage = async () =>
    saveHistoryFirstPage("hotel-1:me", { tasks: [TODAY_1, YESTERDAY].map((r) => normalizeTask(r as never)), nextCursor: "cur-2", hasMore: true });

  it("opens the saved history with a clear 'saved' label instead of failing", async () => {
    await savedPage();
    mockOnline = false;
    mockApiGet.mockRejectedValue(new Error("Network request failed"));

    const screen = render(ui());

    expect(await screen.findByText("Room 210 — Deliver towels")).toBeTruthy();
    expect(screen.getByTestId("history-saved-copy")).toBeTruthy();
    expect(screen.getByText(/Showing saved history — last synced/)).toBeTruthy();
    expect(screen.getByTestId("history-done-today").props.children).toBe(T("tasks.hk.hist.completedTodayUnknown"));
  });

  it("explains that older tasks need a connection instead of silently failing", async () => {
    await savedPage();
    mockOnline = false;
    mockApiGet.mockRejectedValue(new Error("Network request failed"));
    const screen = render(ui());
    await screen.findByText("Room 210 — Deliver towels");

    fireEvent.press(screen.getByTestId("history-load-more"));

    expect(await screen.findByText(T("tasks.hk.hist.offlineMore"))).toBeTruthy();
  });

  it("never presents 'nothing saved' as an empty history", async () => {
    mockOnline = false;
    mockApiGet.mockRejectedValue(new Error("Network request failed"));

    const screen = render(ui());

    expect(await screen.findByText(T("tasks.hk.hist.offlineEmpty"))).toBeTruthy();
    expect(screen.queryByText(T("tasks.hk.historyEmpty"))).toBeNull();
  });

  it("opens a saved task's detail without trying to fetch activity", async () => {
    await savedPage();
    mockOnline = false;
    mockApiGet.mockRejectedValue(new Error("Network request failed"));
    const screen = render(ui());

    fireEvent.press(await screen.findByTestId("history-row-towels"));
    await screen.findByTestId("task-detail-sheet");

    expect(screen.getByTestId("detail-saved-copy")).toBeTruthy();
    expect(mockApiGet.mock.calls.some(([path]) => String(path).includes("/activity"))).toBe(false);
  });
});

describe("Completed Tasks history — language and accessibility", () => {
  it("renders Spanish headings", async () => {
    mockLanguage = "es";
    const screen = render(ui());

    await waitFor(() => expect(screen.getByText("HOY")).toBeTruthy());
    expect(screen.getByText("AYER")).toBeTruthy();
    expect(screen.getByText(es.tasks.hk.hist.recent)).toBeTruthy();
    expect(screen.getByTestId("history-done-today").props.children).toBe("2 completadas hoy");
  });

  it("has a labelled back button, a header role, and rows that are buttons with spoken text and 44dp+ targets", async () => {
    const screen = render(ui());
    await screen.findByText("Room 210 — Deliver towels");

    expect(screen.getByLabelText(T("tasks.hk.hist.back")).props.accessibilityRole).toBe("button");
    expect(screen.getByText(T("tasks.hk.historyTitle")).props.accessibilityRole).toBe("header");
    const row = screen.getByTestId("history-row-towels");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toMatch(/Deliver towels\. Room 210\. Completed \d{1,2}:\d{2} (AM|PM)\./);
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByLabelText(T("tasks.hk.hist.back")).props.style).toBeDefined();
  });
});
