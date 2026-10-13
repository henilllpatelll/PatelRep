import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

// Real EN/ES resources: a missing key or a wrong Spanish label fails here.
let mockLanguage: "en" | "es" = "en";
const dictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
function lookup(language: "en" | "es", key: string): string {
  const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[language]);
  if (typeof found !== "string") throw new Error(`missing ${language} key ${key}`);
  return found;
}
const fill = (template: string, values?: Record<string, unknown>) =>
  values ? template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`)) : template;
const T = (key: string, values?: Record<string, unknown>) => fill(lookup("en", key), values);
const S = (key: string, values?: Record<string, unknown>) => fill(lookup("es", key), values);

function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const find = (k: string) => k.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionaries[mockLanguage]);
  const plural = values && typeof values.count === "number" ? find(`${key}${values.count === 1 ? "" : "_plural"}`) : undefined;
  const found = typeof plural === "string" ? plural : find(key);
  return fill(typeof found === "string" ? found : key, values);
}

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => mockTranslate(key, values),
    i18n: { language: mockLanguage, resolvedLanguage: mockLanguage },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      useEffect(callback, [callback]);
    },
  };
});

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args), post: (...args: unknown[]) => mockApiPost(...args), patch: jest.fn() },
}));

let mockOnline = true;
let mockUserId = "me";
let mockTenant = "hotel-1";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      user: { id: mockUserId, tenant_id: mockTenant, role: "housekeeper", language_pref: mockLanguage },
      hotelTimezone: "America/Chicago",
      pendingActions: [],
      myRooms: [],
      setHotelTimezone: () => undefined,
    })),
  };
});

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TasksRoute from "@/app/(app)/tasks";
import { normalizeTask } from "@/lib/api/tasks";
import { TASK_CACHE_PREFIX, saveDoneToday, saveMyWork } from "@/lib/tasks/offline/taskCache";
import { OUTBOX_PREFIX, useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, status: "open", task_type: "housekeeping", priority: "normal", assigned_to: "me", created_at: at(-600), due_at: at(240), rooms: null, ...extra };
}
const IRON = row("iron", { title: "Replace iron", status: "in_progress", started_at: at(-8), rooms: { room_number: "305", floor: 3 }, due_at: at(60) });
const CRIB = row("crib", { title: "Bring crib", task_type: "guest_request", due_at: at(40), rooms: { room_number: "412", floor: 4 } });
const MINE = [IRON, CRIB];
const POOL = [row("pillow", { title: "Extra pillow delivery", assigned_to: null, rooms: { room_number: "218", floor: 2 } })];

const failure = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { status, code });
let mineRows: unknown[] = MINE;
let completedRows: unknown[] = [];
let singleTask: (id: string) => unknown = () => IRON;
function serve() {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) return { data: completedRows, meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) return { data: mineRows, meta: { has_more: false } };
    if (path.startsWith("/tasks/available")) return { data: POOL, meta: { has_more: false } };
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) return { data: { task: singleTask(activity[1]), events: [] }, meta: { truncated: false } };
    const single = /^\/tasks\/([^/]+)$/.exec(path);
    if (single) return { data: singleTask(single[1]) };
    throw new Error(`unexpected GET ${path}`);
  });
}
const networkDown = () => mockApiGet.mockRejectedValue(new Error("Network request failed"));

function ui() {
  return (
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>
  );
}
const SCOPE = "hotel-1:me";

beforeEach(async () => {
  await AsyncStorage.clear();
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {}, settledTick: 0, lastConfirmedAt: null });
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  mockUserId = "me";
  mockTenant = "hotel-1";
  mineRows = MINE;
  completedRows = [];
  singleTask = () => IRON;
  serve();
});

async function saveCache(userScope = SCOPE) {
  await saveMyWork(userScope, MINE.map((r) => normalizeTask(r as never)), false, "America/Chicago");
}

async function queueIronOffline(screen: ReturnType<typeof render>, note = "") {
  fireEvent.press(await screen.findByLabelText("Complete Replace iron"));
  if (note) fireEvent.changeText(screen.getByTestId("complete-note"), note);
  fireEvent.press(screen.getByTestId("complete-confirm"));
  await waitFor(() => expect(useTaskOutbox.getState().entries.iron).toBeDefined());
}

describe("Tasks offline — saved work", () => {
  it("shows the saved My Work after a restart with no connection, labelled with when it was last synced", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    expect(await screen.findByText("Replace iron")).toBeTruthy();
    expect(screen.getByText("Bring crib")).toBeTruthy();
    expect(screen.getByTestId("tasks-saved-copy")).toBeTruthy();
    expect(screen.getByText(/Showing saved tasks — last synced/)).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.sync.offline"))).toBeTruthy();
  });

  it("does not present a missing cache as 'all caught up' when offline", async () => {
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    await waitFor(() => expect(screen.getByText(T("tasks.hk.error.loadTitle"))).toBeTruthy());
    expect(screen.queryByText(T("tasks.hk.empty.myTitle"))).toBeNull();
  });

  it("fails safe on a corrupted cache: ignores it and shows the error, not stale or empty data", async () => {
    await AsyncStorage.setItem(`${TASK_CACHE_PREFIX}${SCOPE}`, "{garbage");
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    await waitFor(() => expect(screen.getByText(T("tasks.hk.error.loadTitle"))).toBeTruthy());
    expect(await AsyncStorage.getItem(`${TASK_CACHE_PREFIX}${SCOPE}`)).toBeNull();
  });

  it("opens a saved task's details offline with the saved-copy note", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());

    fireEvent.press(await screen.findByLabelText("Show details for Replace iron"));

    expect(await screen.findByTestId("detail-saved-copy")).toBeTruthy();
    expect(screen.getByTestId("task-detail-sheet")).toBeTruthy();
  });

  it("never shows another person's saved tasks after the account changes", async () => {
    await saveCache(SCOPE); // me
    mockUserId = "someone-else";
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    await waitFor(() => expect(screen.getByText(T("tasks.hk.error.loadTitle"))).toBeTruthy());
    expect(screen.queryByText("Replace iron")).toBeNull();
  });

  it("never shows a saved copy of the same person's other hotel", async () => {
    await saveCache(SCOPE);
    mockTenant = "hotel-2";
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    await waitFor(() => expect(screen.getByText(T("tasks.hk.error.loadTitle"))).toBeTruthy());
    expect(screen.queryByText("Replace iron")).toBeNull();
  });

  it("offline Available is not claimable: it explains and shows no claim button", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");

    fireEvent.press(screen.getByTestId("segment-available"));

    expect(await screen.findByText(T("tasks.hk.offline.availableTitle"))).toBeTruthy();
    expect(screen.queryByText("Claim & Start")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("keeps Done Today honest offline: a saved count is shown, never a local tally", async () => {
    await saveCache();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    await saveDoneToday(SCOPE, { count: 4, atLeast: false }, day);
    mockOnline = false;
    networkDown();

    const screen = render(ui());

    expect(await screen.findByLabelText("Done today: 4")).toBeTruthy();
  });
});

describe("Tasks offline — completing", () => {
  async function openOfflineWithIron() {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");
    return screen;
  }

  it("offers to save the completion for sync instead of disabling it, and says it is not done yet", async () => {
    const screen = await openOfflineWithIron();

    fireEvent.press(screen.getByLabelText("Complete Replace iron"));

    expect(await screen.findByText(T("tasks.hk.offline.complete.title"))).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.offline.complete.body"))).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.offline.complete.saveOffline"))).toBeTruthy();
    expect(screen.getByTestId("complete-confirm").props.accessibilityState?.disabled).toBeFalsy();
  });

  it("saves it durably, shows 'pending sync' (never 'Task completed') and sends nothing", async () => {
    const screen = await openOfflineWithIron();

    await queueIronOffline(screen, "Left at the door");

    expect(await screen.findByText(T("tasks.hk.offline.complete.queued"))).toBeTruthy();
    expect(screen.queryByText(T("tasks.hk.msg.completed"))).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
    const persisted = JSON.parse((await AsyncStorage.getItem(`${OUTBOX_PREFIX}${SCOPE}`)) ?? "null");
    expect(persisted.entries.iron).toMatchObject({ taskId: "iron", note: "Left at the door", state: "pending" });
  });

  it("keeps the task visible in its own Pending sync section with a distinct, worded pending state", async () => {
    const screen = await openOfflineWithIron();
    await queueIronOffline(screen);

    expect(await screen.findByText(`${T("tasks.hk.sections.pendingSync")} · 1`)).toBeTruthy();
    const card = screen.getByTestId("task-iron");
    expect(within(card).getByText(T("tasks.hk.offline.card.pendingTitle"))).toBeTruthy();
    expect(within(card).getByText(/Saved on this device at/)).toBeTruthy();
    expect(screen.getAllByText("Replace iron")).toHaveLength(1); // listed once
    expect(screen.getByText(T("tasks.hk.sync.pending"))).toBeTruthy();
  });

  it("does not count a pending completion as done, and still counts the task as unfinished", async () => {
    const screen = await openOfflineWithIron();
    await queueIronOffline(screen);

    await screen.findByText(`${T("tasks.hk.sections.pendingSync")} · 1`);
    // nothing confirmed by the server is known offline, so the stat says so; it must never become "1"
    expect(screen.getByLabelText(`Done today: ${T("tasks.hk.summary.unavailable")}`)).toBeTruthy();
    expect(screen.queryByLabelText("Done today: 1")).toBeNull();
    expect(screen.getByLabelText("In progress: 1")).toBeTruthy();
  });

  it("offers only 'View details' on a pending card, so a second completion can not be sent", async () => {
    const screen = await openOfflineWithIron();
    await queueIronOffline(screen);

    expect(screen.queryByLabelText("Complete Replace iron")).toBeNull();
    fireEvent.press(await screen.findByLabelText("View details for Replace iron"));

    expect(await screen.findByTestId("detail-queued")).toBeTruthy();
    expect(within(screen.getByTestId("detail-queued")).getByText(T("tasks.hk.offline.detail.pendingTitle"))).toBeTruthy();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
  });

  it("refuses to save a completion for a task that was never started", async () => {
    await saveMyWork(SCOPE, [normalizeTask(CRIB as never)], false, null);
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Bring crib");

    // 'Bring crib' is open (not started): its card offers Start, which is online-only.
    expect(screen.queryByLabelText("Complete Bring crib")).toBeNull();
    expect(screen.getByLabelText("Start Bring crib").props.accessibilityState?.disabled).toBe(true);
  });

  it("survives a restart: the pending card is back on the next launch", async () => {
    const first = await openOfflineWithIron();
    await queueIronOffline(first);
    first.unmount();
    useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} });

    const second = render(ui());

    expect(await second.findByText(`${T("tasks.hk.sections.pendingSync")} · 1`)).toBeTruthy();
  });
});

describe("Tasks offline — coming back online", () => {
  it("sends the saved completion through the authorised endpoint, then re-reads the server and drops the pending card", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");
    await queueIronOffline(screen, "Done, towels delivered");

    serve();
    mineRows = [CRIB];
    completedRows = [row("iron", { title: "Replace iron", status: "completed", completed_at: at(0) })];
    mockApiPost.mockResolvedValue({ data: row("iron", { status: "completed", completed_at: at(0) }), meta: { replayed: false, note_saved: true } });
    mockOnline = true;
    screen.rerender(ui());

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/iron/complete", { note: "Done, towels delivered" }));
    await waitFor(() => expect(screen.queryByTestId("task-pending-iron")).toBeNull());
    expect(screen.queryByText("Replace iron")).toBeNull();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(useTaskOutbox.getState().entries).toEqual({});
  });

  it("shows 'Needs attention' and an honest conflict when the task was reassigned, with no force-complete", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");
    await queueIronOffline(screen);

    serve();
    mineRows = [CRIB];
    singleTask = () => row("iron", { title: "Replace iron", status: "in_progress", assigned_to: "ana", rooms: { room_number: "305", floor: 3 } });
    mockApiPost.mockRejectedValue(failure(403));
    mockOnline = true;
    screen.rerender(ui());

    expect(await screen.findByText(T("tasks.hk.offline.card.conflictTitle"))).toBeTruthy();
    expect(screen.getByText(T("tasks.hk.sync.attention"))).toBeTruthy();
    expect(mockApiPost).toHaveBeenCalledTimes(1); // not retried

    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");
    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.states.conflict"))).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId("task-sync-review-iron"));

    expect(await screen.findByText(T("tasks.hk.offline.detail.conflict.reassigned"))).toBeTruthy();
    expect(screen.queryByTestId("queued-retry")).toBeNull(); // a final refusal can only be dismissed
    expect(screen.queryByText(/force/i)).toBeNull();
    expect(screen.queryByTestId("detail-complete")).toBeNull();

    fireEvent.press(screen.getByTestId("queued-dismiss"));
    await waitFor(() => expect(useTaskOutbox.getState().entries).toEqual({}));
  });

  it("keeps the completion pending when the server only times out, and does not hammer it", async () => {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");
    await queueIronOffline(screen);

    serve();
    mockApiPost.mockRejectedValue(new Error("Request timed out. Please try again."));
    mockOnline = true;
    screen.rerender(ui());

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useTaskOutbox.getState().entries.iron?.attempts).toBe(1));
    expect(useTaskOutbox.getState().entries.iron.state).toBe("pending");
    expect(screen.getByTestId("task-pending-iron")).toBeTruthy();
  });
});

describe("Sync Status sheet", () => {
  async function pendingScreen() {
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");
    await queueIronOffline(screen);
    return screen;
  }

  it("shows the real offline state, last sync time, count and the pending change", async () => {
    const screen = await pendingScreen();

    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");

    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.titleOffline"))).toBeTruthy();
    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.savedAvailable"))).toBeTruthy();
    expect(within(sheet).getByText(/Last synced:/)).toBeTruthy();
    expect(within(sheet).getByText("1 pending change")).toBeTruthy();
    expect(within(sheet).getByText(/Room 305 · Replace iron — Completion/)).toBeTruthy();
    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.states.pending"))).toBeTruthy();
    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.offlineHelp"))).toBeTruthy();
    expect(within(sheet).getByTestId("task-sync-retry").props.accessibilityState?.disabled).toBe(true);
  });

  it("never invents a last-sync time when nothing has synced on this device", async () => {
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await waitFor(() => expect(screen.getByText(T("tasks.hk.error.loadTitle"))).toBeTruthy());

    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");

    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.neverSynced"))).toBeTruthy();
    expect(within(sheet).queryByText(/Last synced:/)).toBeNull();
  });

  it("says 'All changes synced' when online with nothing waiting", async () => {
    const screen = render(ui());
    await screen.findByText("Replace iron");

    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");

    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.titleOnline"))).toBeTruthy();
    expect(within(sheet).getByText(T("tasks.hk.offline.sheet.allSynced"))).toBeTruthy();
  });

  it("Retry sync runs the same single flush and re-reads the server", async () => {
    const screen = await pendingScreen();
    serve();
    mockApiPost.mockRejectedValue(new Error("Request timed out"));
    mockOnline = true;
    screen.rerender(ui());
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");
    const gets = mockApiGet.mock.calls.length;
    await act(async () => {
      fireEvent.press(within(sheet).getByTestId("task-sync-retry"));
    });

    await waitFor(() => expect(mockApiGet.mock.calls.length).toBeGreaterThan(gets)); // lists were re-read
    expect(mockApiPost).toHaveBeenCalledTimes(1); // not yet due: no duplicate request
  });

  it("is accessible: the chip is a labelled button, rows are worded, targets are at least 44dp", async () => {
    const screen = await pendingScreen();

    const chip = screen.getByTestId("sync-indicator");
    expect(chip.props.accessibilityRole).toBe("button");
    expect(chip.props.accessibilityLabel).toBe(T("tasks.hk.sync.pending"));

    fireEvent.press(chip);
    const sheet = await screen.findByTestId("task-sync-sheet");
    const review = within(sheet).getByTestId("task-sync-review-iron");
    expect(review.props.accessibilityRole).toBe("button");
    expect(StyleSheet.flatten(review.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(within(sheet).getByLabelText(/Room 305 · Replace iron — Completion\. Pending/)).toBeTruthy();
  });
});

describe("Tasks offline — Spanish", () => {
  it("localises the offline sheet, pending card and completion dialog", async () => {
    mockLanguage = "es";
    await saveCache();
    mockOnline = false;
    networkDown();
    const screen = render(ui());
    await screen.findByText("Replace iron");

    fireEvent.press(screen.getByLabelText(S("tasks.hk.action.completeA11y", { title: "Replace iron" })));
    expect(await screen.findByText(S("tasks.hk.offline.complete.title"))).toBeTruthy();
    expect(screen.getByText(S("tasks.hk.offline.complete.saveOffline"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("complete-confirm"));
    await waitFor(() => expect(useTaskOutbox.getState().entries.iron).toBeDefined());

    expect(await screen.findByText(S("tasks.hk.offline.card.pendingTitle"))).toBeTruthy();
    expect(screen.getByText(S("tasks.hk.sections.pendingSync") + " · 1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("sync-indicator"));
    const sheet = await screen.findByTestId("task-sync-sheet");
    expect(within(sheet).getByText(S("tasks.hk.offline.sheet.titleOffline"))).toBeTruthy();
    expect(within(sheet).getByText(S("tasks.hk.offline.sheet.savedAvailable"))).toBeTruthy();
    expect(within(sheet).getByText(S("tasks.hk.offline.sheet.offlineHelp"))).toBeTruthy();
  });

  it("has every new English key in Spanish too, with the same placeholders", () => {
    const flatten = (node: unknown, prefix = ""): Record<string, string> =>
      Object.entries((node ?? {}) as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string") acc[prefix + key] = value;
        else Object.assign(acc, flatten(value, `${prefix}${key}.`));
        return acc;
      }, {});
    for (const group of ["offline", "hist"]) {
      const english = flatten((en as never as { tasks: { hk: Record<string, unknown> } }).tasks.hk[group]);
      const spanish = flatten((es as never as { tasks: { hk: Record<string, unknown> } }).tasks.hk[group]);
      expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english)) {
        const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
        expect(placeholders(spanish[key])).toEqual(placeholders(english[key]));
        expect(spanish[key].length).toBeGreaterThan(0);
      }
    }
    expect(S("tasks.hk.sync.attention")).not.toBe(T("tasks.hk.sync.attention"));
  });
});
