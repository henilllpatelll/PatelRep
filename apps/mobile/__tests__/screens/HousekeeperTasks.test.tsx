import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, ScrollView, StyleSheet } from "react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

// Real EN/ES resources, so a missing key or a wrong Spanish label fails here.
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

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

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
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: jest.fn(),
  },
}));

let mockOnline = true;
let mockRole = "housekeeper";
let mockPending: Array<{ type: string }> = [];
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: mockOnline,
    user: { id: "me", tenant_id: "hotel-1", role: mockRole, language_pref: mockLanguage },
    hotelTimezone: "America/Chicago",
    pendingActions: mockPending,
    myRooms: [],
  }),
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TasksRoute from "@/app/(app)/tasks";

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    status: "open",
    task_type: "housekeeping",
    priority: "normal",
    assigned_to: "me",
    created_at: at(-600),
    due_at: at(240),
    rooms: null,
    ...extra,
  };
}

const MINE = [
  row("towels", {
    title: "Deliver 2 extra towels",
    task_type: "guest_request",
    due_at: at(-12),
    room_id: "r214",
    rooms: { room_number: "214", floor: 2 },
    guest_request: { id: "g1", status: "open" },
  }),
  row("iron", { title: "Replace iron", status: "in_progress", started_at: at(-8), rooms: { room_number: "305", floor: 3 }, due_at: at(60) }),
  row("crib", { title: "Bring crib", task_type: "guest_request", due_at: at(40), rooms: { room_number: "412", floor: 4 } }),
  row("cart", { title: "Restock 2nd-floor cart", due_at: at(90), location_text: "2nd floor" }),
  row("closet", { title: "Sort linen closet", due_at: at(500), priority: "low" }),
];
const POOL = [
  row("pillow", { title: "Extra pillow delivery", assigned_to: null, task_type: "guest_request", rooms: { room_number: "218", floor: 2 } }),
  row("floor3", { title: "Restock linen closet", assigned_to: null, location_text: "Floor 3" }),
];

type Serve = { mine?: unknown; pool?: unknown; mineMeta?: Record<string, unknown>; completed?: unknown };
function serve(options: Serve = {}) {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) return { data: options.completed ?? [], meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) return { data: options.mine ?? MINE, meta: { has_more: false, ...options.mineMeta } };
    if (path.startsWith("/tasks/available")) return { data: options.pool ?? POOL, meta: { has_more: false } };
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) {
      const found = [...MINE, ...POOL].find((candidate) => candidate.id === activity[1]);
      if (!found) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return { data: { task: found, events: [] }, meta: { truncated: false } };
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const gets = (prefix: string) => mockApiGet.mock.calls.filter((call) => String(call[0]).startsWith(prefix)).length;

function renderScreen() {
  return render(
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  mockRole = "housekeeper";
  mockPending = [];
  serve();
});

async function ready() {
  const screen = renderScreen();
  await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
  return screen;
}

describe("Housekeeper Tasks — My Work", () => {
  it("shows the header, hotel-local date, server-backed summary and counts", async () => {
    const { getByText, getByLabelText, getByTestId } = await ready();

    expect(getByText("My Tasks")).toBeTruthy();
    expect(getByTestId("sync-indicator")).toBeTruthy();
    expect(getByLabelText("Remaining: 4")).toBeTruthy(); // towels, crib, cart, closet (not started)
    expect(getByLabelText("In progress: 1")).toBeTruthy();
    await waitFor(() => expect(getByLabelText("Done today: 0")).toBeTruthy());
    expect(getByLabelText("My Work, 5 tasks")).toBeTruthy();
    expect(getByLabelText("Available, 2 tasks")).toBeTruthy();
    expect(getByText("My Work (5)")).toBeTruthy();
    expect(getByText("Available (2)")).toBeTruthy();
  });

  it("lays out Next Up, In Progress, Up Next and a collapsed Later without duplicating Next Up", async () => {
    const { getByText, getAllByText, queryByText, getByLabelText } = await ready();

    expect(getByText("NEXT UP")).toBeTruthy();
    expect(getByText("IN PROGRESS · 1")).toBeTruthy();
    expect(getByText("UP NEXT · 2")).toBeTruthy();
    expect(getByText("LATER · 1")).toBeTruthy();
    expect(getAllByText("Deliver 2 extra towels")).toHaveLength(1);
    expect(getByText("ROOM 214")).toBeTruthy();
    expect(getByText("12m overdue")).toBeTruthy();
    expect(getByText("Started 8m ago")).toBeTruthy();
    // verified rooms read as rooms; a free-text place stays a place
    expect(getByText("2nd floor")).toBeTruthy();
    expect(queryByText("ROOM 2nd floor")).toBeNull();
    // Later is collapsed by default but discoverable and openable
    expect(queryByText("Sort linen closet")).toBeNull();
    fireEvent.press(getByLabelText("Show later tasks"));
    expect(getByText("Sort linen closet")).toBeTruthy();
    // no AI briefing, no permanent composer, no AI badge
    expect(queryByText("AI Task Briefing")).toBeNull();
    expect(queryByText("AI")).toBeNull();
  });

  it("never mixes the Available pool into My Work", async () => {
    const { queryByText } = await ready();

    expect(queryByText("Extra pillow delivery")).toBeNull();
    expect(queryByText("Restock linen closet")).toBeNull();
  });

  it("starts the Next Up task through the server and reconciles", async () => {
    mockApiPost.mockResolvedValue({ data: { ...MINE[0], status: "in_progress", started_at: at(0) }, meta: { replayed: false } });
    const { getByLabelText } = await ready();

    fireEvent.press(getByLabelText("Start Deliver 2 extra towels"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/towels/start", {}));
    await waitFor(() => expect(gets("/tasks/mine?")).toBeGreaterThanOrEqual(2));
  });

  it("shows a message and leaves the task alone when start fails", async () => {
    mockApiPost.mockRejectedValue(failure(500));
    const { getByLabelText, getByText } = await ready();

    fireEvent.press(getByLabelText("Start Deliver 2 extra towels"));

    await waitFor(() => expect(getByText("Couldn't start this task. Try again.")).toBeTruthy());
    expect(getByText("NEXT UP")).toBeTruthy();
    expect(getByText("Deliver 2 extra towels")).toBeTruthy();
  });

  it("sends only one start request when the button is tapped twice", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { getByLabelText } = await ready();

    const button = getByLabelText("Start Deliver 2 extra towels");
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ data: { ...MINE[0], status: "in_progress", started_at: at(0) }, meta: {} });
    });
  });

  it("requires confirmation before completing and only then calls the complete endpoint", async () => {
    mockApiPost.mockResolvedValue({ data: { ...MINE[1], status: "completed" }, meta: { replayed: false } });
    const { getByLabelText, getByText, queryByText, getByTestId } = await ready();

    fireEvent.press(getByLabelText("Complete Replace iron"));
    expect(getByText("Complete this task?")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("complete-back"));
    expect(queryByText("Complete this task?")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText("Complete Replace iron"));
    fireEvent.press(getByTestId("complete-confirm"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/iron/complete", {}));
    await waitFor(() => expect(queryByText("Complete this task?")).toBeNull());
    await waitFor(() => expect(getByTestId("tasks-success")).toBeTruthy());
  });

  it("keeps the task and reports failure when completion is rejected (never a false success)", async () => {
    mockApiPost.mockRejectedValue(failure(500));
    const { getByLabelText, getByText, getByTestId, queryByTestId } = await ready();

    fireEvent.press(getByLabelText("Complete Replace iron"));
    fireEvent.press(getByTestId("complete-confirm"));

    await waitFor(() => expect(getByText("Couldn't complete this task. It is still on your list.")).toBeTruthy());
    expect(getByText("Replace iron")).toBeTruthy();
    expect(queryByTestId("tasks-success")).toBeNull();
  });

  it("opens the Task Detail sheet from the card body without competing with the action", async () => {
    const { getByLabelText, getByText } = await ready();

    fireEvent.press(getByLabelText("Show details for Replace iron"));

    await waitFor(() => expect(getByText("Task details")).toBeTruthy());
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("shows the hotel-local due time, not the device's", async () => {
    // 17:30Z on 12 Oct is 12:30 PM in America/Chicago (CDT) whatever zone the phone is in.
    serve({ mine: [row("fixed", { title: "Fixed time task", due_at: "2026-10-12T17:30:00+00:00" })] });
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("Fixed time task")).toBeTruthy());
    expect(getByText(/12:30 PM/)).toBeTruthy();
  });
});

describe("Housekeeper Tasks — Available", () => {
  async function openAvailable() {
    const screen = await ready();
    fireEvent.press(screen.getByTestId("segment-available"));
    return screen;
  }

  it("lists only the server's claimable pool with the explanation and claim actions", async () => {
    const { getByText, getAllByText, queryByText, getByTestId } = await openAvailable();

    expect(getByTestId("segment-available").props.accessibilityState.selected).toBe(true);
    expect(getByText("These tasks are not assigned yet. Claim one when you're ready to work on it.")).toBeTruthy();
    expect(getByText("AVAILABLE · 2")).toBeTruthy();
    expect(getByText("Extra pillow delivery")).toBeTruthy();
    expect(getByText("Restock linen closet")).toBeTruthy();
    expect(getAllByText("Claim & Start")).toHaveLength(2);
    expect(queryByText("Replace iron")).toBeNull();
  });

  it("switches segments instantly without reloading the other list", async () => {
    const { getByTestId, getByText } = await openAvailable();
    const before = { mine: gets("/tasks/mine?"), pool: gets("/tasks/available") };

    fireEvent.press(getByTestId("segment-mine"));
    expect(getByText("Replace iron")).toBeTruthy();
    fireEvent.press(getByTestId("segment-available"));

    expect(gets("/tasks/mine?")).toBe(before.mine);
    expect(gets("/tasks/available")).toBe(before.pool);
  });

  it("claims a task, removes it from Available and shows it in My Work In Progress", async () => {
    const claimed = { ...POOL[0], assigned_to: "me", status: "in_progress", started_at: at(0) };
    mockApiPost.mockResolvedValue({ data: claimed, meta: { replayed: false } });
    const { getByLabelText, queryByText, getByTestId, getByText } = await openAvailable();
    // the server now reports the claim
    serve({ mine: [...MINE, claimed], pool: [POOL[1]] });

    fireEvent.press(getByLabelText("Claim and start Extra pillow delivery"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/pillow/claim", {}));
    await waitFor(() => expect(queryByText("Extra pillow delivery")).toBeNull());
    fireEvent.press(getByTestId("segment-mine"));
    expect(getByText("Extra pillow delivery")).toBeTruthy();
    expect(getByText("IN PROGRESS · 2")).toBeTruthy();
  });

  it("explains a claim conflict and refreshes the queue", async () => {
    mockApiPost.mockRejectedValue(failure(409));
    const { getByLabelText, getByText } = await openAvailable();
    const before = gets("/tasks/available");
    serve({ pool: [POOL[1]] });

    fireEvent.press(getByLabelText("Claim and start Extra pillow delivery"));

    await waitFor(() => expect(getByText("That task is no longer available. Your list was refreshed.")).toBeTruthy());
    await waitFor(() => expect(gets("/tasks/available")).toBeGreaterThan(before));
  });

  it("shows the empty state, which is different from an error", async () => {
    serve({ pool: [] });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
    fireEvent.press(screen.getByTestId("segment-available"));

    expect(screen.getByText("Nothing available right now.")).toBeTruthy();
    expect(screen.getByText("New unassigned housekeeping tasks will appear here.")).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh tasks.")).toBeNull();
  });

  it("does not allow claiming while offline", async () => {
    mockOnline = false;
    const { getByLabelText, getByText } = await openAvailable();

    fireEvent.press(getByLabelText("Claim and start Extra pillow delivery"));

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(getByText("Offline")).toBeTruthy();
  });
});

describe("Housekeeper Tasks — loading, errors and refresh", () => {
  it("shows a positive empty state with a way to Available when nothing is assigned", async () => {
    serve({ mine: [] });
    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => expect(getByText("You're all caught up.")).toBeTruthy());
    expect(getByText("No assigned tasks right now. Check Available for additional work.")).toBeTruthy();
    fireEvent.press(getByText("View Available"));
    expect(getByTestId("segment-available").props.accessibilityState.selected).toBe(true);
  });

  it("shows an error with Retry — never 'caught up' — when the first load fails", async () => {
    mockApiGet.mockRejectedValue(failure(500));
    const { getByText, queryByText, getByLabelText } = renderScreen();

    await waitFor(() => expect(getByText("Couldn't refresh tasks.")).toBeTruthy());
    expect(queryByText("You're all caught up.")).toBeNull();
    expect(getByLabelText("Remaining: unavailable")).toBeTruthy();

    serve();
    fireEvent.press(getByText("Retry"));
    await waitFor(() => expect(getByText("Deliver 2 extra towels")).toBeTruthy());
  });

  it("keeps the last good list, marked stale, when a refresh fails", async () => {
    const screen = await ready();
    mockApiGet.mockRejectedValue(failure(503));

    await act(async () => {
      await screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
    });

    expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy();
    expect(screen.getByText("Couldn't refresh tasks. Showing your last loaded list.")).toBeTruthy();
    expect(screen.getByText("Not up to date")).toBeTruthy();
  });

  it("one list failing does not wipe the other", async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/tasks/available")) throw failure(500);
      if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: {} };
      return { data: MINE, meta: { has_more: false } };
    });
    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
    expect(screen.getByLabelText("My Work, 5 tasks")).toBeTruthy();
    fireEvent.press(screen.getByTestId("segment-available"));
    expect(screen.getByText("Couldn't refresh tasks.")).toBeTruthy();
  });

  it("does not fabricate Done Today when the history request fails", async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/tasks/mine/completed")) throw failure(500);
      if (path.startsWith("/tasks/available")) return { data: POOL, meta: {} };
      return { data: MINE, meta: { has_more: false } };
    });
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText("Deliver 2 extra towels")).toBeTruthy());
    expect(getByLabelText("Done today: unavailable")).toBeTruthy();
  });

  it("follows pagination cursors so no assigned task is missing", async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: {} };
      if (path.startsWith("/tasks/available")) return { data: [], meta: {} };
      return path.includes("cursor=")
        ? { data: [row("p2", { title: "Page two task", due_at: at(60) })], meta: { has_more: false } }
        : { data: [row("p1", { title: "Page one task", due_at: at(30) })], meta: { has_more: true, next_cursor: "abc" } };
    });
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("Page one task")).toBeTruthy());
    expect(getByText("Page two task")).toBeTruthy();
    expect(mockApiGet).toHaveBeenCalledWith("/tasks/mine?limit=200&cursor=abc");
  });

  it("warns when the server says the list may be incomplete", async () => {
    serve({ mineMeta: { truncated: true } });
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("This list may be incomplete. Pull down to refresh.")).toBeTruthy());
  });

  it("refreshes on screen focus, on foreground and on pull-to-refresh", async () => {
    let appStateHandler: (state: string) => void = () => undefined;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, handler: (state: string) => void) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as never);
    const screen = await ready();
    expect(gets("/tasks/mine?")).toBe(1); // focus

    await act(async () => {
      appStateHandler("active");
    });
    await waitFor(() => expect(gets("/tasks/mine?")).toBe(2)); // foreground

    await act(async () => {
      await screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
    });
    expect(gets("/tasks/mine?")).toBe(3); // pull-to-refresh
    spy.mockImplementation((() => ({ remove: jest.fn() })) as never);
  });

  it("shares one request between overlapping refreshes", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path.startsWith("/tasks/mine?")) release = () => resolve({ data: MINE, meta: {} });
          else resolve({ data: [], meta: {} });
        }),
    );
    const screen = renderScreen();
    await waitFor(() => expect(gets("/tasks/mine?")).toBe(1));

    act(() => {
      void screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
    });

    expect(gets("/tasks/mine?")).toBe(1);
    await act(async () => release(undefined));
  });
});

describe("Housekeeper Tasks — entry points, roles, language, accessibility", () => {
  it("keeps Add task reachable and opens the Describe step without creating anything", async () => {
    const { getByLabelText, getByTestId, getByText, queryByText } = await ready();

    expect(queryByText("AI Task Briefing")).toBeNull();
    fireEvent.press(getByLabelText("Add task"));

    expect(getByTestId("add-task-sheet")).toBeTruthy();
    expect(getByText("What needs to be done?")).toBeTruthy();
    expect(getByTestId("add-task-input")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("creates a task through Describe, Review and Create, then refreshes and offers View task", async () => {
    const created = row("new1", { title: "Bring crib to 412", task_type: "guest_request", rooms: { room_number: "412", floor: 4 }, assigned_to: "me" });
    mockApiPost.mockImplementation(async (path: string) => {
      if (path === "/ai/copilot/chat") {
        return { data: { response_type: "task_preview", message: "", tasks: [{ title: "Bring crib to 412", task_type: "guest_request", priority: "normal", room_id: "r412", room_number_display: "412", confidence: 0.9 }] } };
      }
      if (path === "/tasks") return { data: created, meta: { replayed: false } };
      throw new Error(`unexpected POST ${path}`);
    });
    const { getByLabelText, getByTestId, getByText, findByTestId } = await ready();
    const before = gets("/tasks/mine?");

    fireEvent.press(getByLabelText("Add task"));
    fireEvent.changeText(getByTestId("add-task-input"), "crib for 412");
    fireEvent.press(getByTestId("add-task-continue"));
    await waitFor(() => expect(getByText("Review new task")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledTimes(1); // parsing only; nothing was created yet
    fireEvent.press(getByTestId("review-create"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/tasks",
        expect.objectContaining({
          title: "Bring crib to 412",
          task_type: "guest_request",
          room_id: "r412",
          assigned_to: "me",
          ai_suggested: true,
          client_request_id: expect.any(String),
        }),
      ),
    );
    await waitFor(() => expect(gets("/tasks/mine?")).toBeGreaterThan(before));
    expect(await findByTestId("tasks-success")).toBeTruthy();
    expect(getByText(/Task created\./)).toBeTruthy();
    fireEvent.press(getByTestId("tasks-success-view"));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/tasks/new1/activity"));
  });

  it("opens Completed History from the header", async () => {
    const { getByLabelText } = await ready();

    fireEvent.press(getByLabelText("Completed history"));

    expect(mockPush).toHaveBeenCalledWith("/(app)/tasks/history");
  });

  it("shows Pending changes only when task changes are really queued", async () => {
    mockPending = [{ type: "task_complete" }];
    const { getByText } = await ready();

    expect(getByText("Pending changes")).toBeTruthy();
  });

  it("keeps the existing screen (no claim/complete redesign) for other roles", async () => {
    mockRole = "inspector";
    mockApiGet.mockResolvedValue({ data: [row("t1", { title: "Inspector task", assigned_to: "me" })], meta: { has_more: false } });
    const { findByText, queryByText } = renderScreen();

    expect(await findByText("Inspector task")).toBeTruthy();
    expect(queryByText("My Work (1)")).toBeNull();
    expect(queryByText("Available")).toBeNull();
    expect(mockApiGet).not.toHaveBeenCalledWith(expect.stringContaining("/tasks/available"));
  });

  it("renders Spanish labels throughout", async () => {
    mockLanguage = "es";
    const { getByText, getByLabelText } = renderScreen();

    await waitFor(() => expect(getByText("Mis tareas")).toBeTruthy());
    await waitFor(() => expect(getByText("Mi trabajo (5)")).toBeTruthy());
    expect(getByText("Disponibles (2)")).toBeTruthy();
    expect(getByText("SIGUIENTE")).toBeTruthy();
    expect(getByText("EN CURSO · 1")).toBeTruthy();
    expect(getByLabelText("Iniciar Deliver 2 extra towels")).toBeTruthy();
    expect(getByLabelText("Agregar tarea")).toBeTruthy();
    expect(getByText("12 min de retraso")).toBeTruthy();
  });

  it("exposes labelled controls with touch targets of at least 44dp", async () => {
    const { getByTestId, getByLabelText } = await ready();

    for (const id of ["segment-mine", "segment-available"]) {
      expect(StyleSheet.flatten(getByTestId(id).props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(getByTestId("segment-mine").props.accessibilityRole).toBe("tab");
    expect(StyleSheet.flatten(getByTestId("add-task-button").props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(getByLabelText("Completed history").props.style).height).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(getByTestId("task-action-towels").props.style).minHeight).toBeGreaterThanOrEqual(44);
    // urgency is spelled out as text, not colour only
    expect(getByLabelText("Start Deliver 2 extra towels")).toBeTruthy();
  });
});
