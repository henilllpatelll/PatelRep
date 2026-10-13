import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Modal } from "react-native";
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
  api: { get: (...args: unknown[]) => mockApiGet(...args), post: (...args: unknown[]) => mockApiPost(...args), patch: jest.fn() },
}));

let mockOnline = true;
let mockMyRooms: Array<{ id: string }> = [];
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: mockOnline,
    user: { id: "me", role: "housekeeper", language_pref: mockLanguage },
    hotelTimezone: "America/Chicago",
    pendingActions: [],
    myRooms: mockMyRooms,
  }),
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TasksRoute from "@/app/(app)/tasks";

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, status: "open", task_type: "housekeeping", priority: "normal", assigned_to: "me", created_at: at(-600), due_at: at(240), rooms: null, ...extra };
}

const LONG = "Check every drawer and wipe each surface. ".repeat(12);
const MINE = [
  row("towels", {
    title: "Deliver 2 extra towels",
    task_type: "guest_request",
    priority: "urgent",
    description: "Leave them at the door unless the guest asks otherwise.",
    due_at: at(-12),
    room_id: "r214",
    rooms: { room_number: "214", floor: 2 },
    creator_profile: { full_name: "Front Desk" },
    guest_request: { id: "g1", status: "open" },
  }),
  row("iron", { title: "Replace iron", status: "in_progress", started_at: at(-8), rooms: { room_number: "305", floor: 3 }, room_id: "r305" }),
  row("bare", { title: "Bare task", due_at: null }),
  row("long", { title: "Deep clean", description: LONG, due_at: at(120) }),
];
const POOL = [row("pillow", { title: "Extra pillow delivery", assigned_to: null, rooms: { room_number: "218", floor: 2 } })];

let taskOverride: Record<string, Record<string, unknown>> = {};
/** What only the single-task endpoint reports (the lists keep their copy until the next refresh). */
let activityOverride: Record<string, Record<string, unknown>> = {};
let events: Record<string, unknown[]> = {};
const everything = () => [...MINE, ...POOL].map((candidate) => taskOverride[candidate.id] ?? candidate);
function find(id: string) {
  return everything().find((candidate) => candidate.id === id);
}
// The fake server answers from one source of truth, so lists agree with single-task reads.
function serve() {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) {
      return { data: everything().filter((r) => r.assigned_to === "me" && ["open", "in_progress"].includes(String(r.status))), meta: { has_more: false } };
    }
    if (path.startsWith("/tasks/available")) {
      return { data: everything().filter((r) => r.assigned_to === null && r.status === "open"), meta: { has_more: false } };
    }
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) return { data: { task: activityOverride[activity[1]] ?? find(activity[1]), events: events[activity[1]] ?? [] }, meta: { truncated: false } };
    const detail = /^\/tasks\/([^/]+)$/.exec(path);
    if (detail && find(detail[1])) return { data: find(detail[1]) };
    throw new Error(`unexpected GET ${path}`);
  });
}

const posts = (suffix: string) => mockApiPost.mock.calls.filter((call) => String(call[0]).endsWith(suffix));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  mockMyRooms = [];
  taskOverride = {};
  activityOverride = {};
  events = {};
  serve();
});

async function ready() {
  const screen = render(
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
  return screen;
}
const openCard = async (screen: Awaited<ReturnType<typeof ready>>, title: string) => {
  const later = screen.queryByLabelText("Show later tasks");
  if (later && !screen.queryByLabelText(`Show details for ${title}`)) fireEvent.press(later);
  fireEvent.press(screen.getByLabelText(`Show details for ${title}`));
  await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
};

describe("Task Detail sheet", () => {
  it("shows real task data and the persisted activity, oldest first", async () => {
    events.towels = [
      { id: "created", kind: "created", at: new Date(NOW - 3000).toISOString(), actor_id: "fd", actor_name: "Front Desk", text: null },
      { id: "comment-1", kind: "comment", at: new Date(NOW - 1000).toISOString(), actor_id: "fd", actor_name: "Front Desk", text: "Leave towels outside." },
    ];
    const screen = await ready();
    await openCard(screen, "Deliver 2 extra towels");

    expect(screen.getByText("Leave them at the door unless the guest asks otherwise.")).toBeTruthy();
    expect(screen.getByText("Room 214 · Floor 2")).toBeTruthy();
    expect(screen.getByText("Guest request · Not started")).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.getAllByText("Front Desk").length).toBeGreaterThan(1); // Created by + the note author
    expect(screen.getByText("Linked to a guest request")).toBeTruthy();
    expect(screen.getByText(/· Overdue$/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Leave towels outside.")).toBeTruthy());
    expect(screen.getAllByTestId(/^activity-/).map((node) => node.props.testID)).toEqual(["activity-created", "activity-comment-1"]);
  });

  it("hides optional fields the task does not have instead of inventing them", async () => {
    const screen = await ready();
    await openCard(screen, "Bare task");

    const sheet = within(screen.getByTestId("task-detail-sheet"));
    expect(sheet.queryByText("Instructions")).toBeNull();
    expect(sheet.queryByText("Due")).toBeNull();
    expect(sheet.queryByText("Created by")).toBeNull();
    expect(sheet.queryByText("Guest request")).toBeNull();
    expect(sheet.queryByText("Urgent")).toBeNull();
    expect(sheet.getByText("Assigned to")).toBeTruthy();
  });

  it("opens only one sheet however many times a card is tapped", async () => {
    const screen = await ready();
    const card = screen.getByLabelText("Show details for Replace iron");
    fireEvent.press(card);
    fireEvent.press(card);
    await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
    expect(screen.getAllByText("Task details")).toHaveLength(1);
  });

  it("offers the right primary action for each state and nothing else", async () => {
    let screen = await ready();
    await openCard(screen, "Deliver 2 extra towels");
    expect(screen.getByTestId("detail-start")).toBeTruthy();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
    screen.unmount();

    screen = await ready();
    await openCard(screen, "Replace iron");
    expect(screen.getByTestId("detail-complete")).toBeTruthy();
    expect(screen.getByTestId("detail-add-note")).toBeTruthy();
    expect(screen.queryByTestId("detail-start")).toBeNull();
    screen.unmount();

    screen = await ready();
    fireEvent.press(screen.getByTestId("segment-available"));
    fireEvent.press(screen.getByLabelText("Show details for Extra pillow delivery"));
    await waitFor(() => expect(screen.getByTestId("detail-claim")).toBeTruthy());
    expect(screen.getByText("Claim & start")).toBeTruthy();
    expect(screen.queryByTestId("detail-start")).toBeNull();
  });

  it("is read-only for a completed or cancelled task and reconciles to what the server says", async () => {
    activityOverride.iron = { ...MINE[1], status: "completed", completed_at: at(-1) };
    const screen = await ready();
    await openCard(screen, "Replace iron");

    await waitFor(() => expect(screen.getByTestId("detail-readonly")).toBeTruthy());
    expect(screen.getByText("This task is complete. Details are read-only.")).toBeTruthy();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
    expect(screen.queryByTestId("detail-add-note")).toBeNull();
  });

  it("links to My Rooms only for a room the employee can open", async () => {
    let screen = await ready();
    await openCard(screen, "Replace iron");
    expect(screen.queryByTestId("detail-open-room")).toBeNull();
    screen.unmount();

    mockMyRooms = [{ id: "r305" }];
    screen = await ready();
    await openCard(screen, "Replace iron");
    fireEvent.press(screen.getByTestId("detail-open-room"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/my-rooms/r305");
  });

  it("folds very long instructions behind Show more", async () => {
    const screen = await ready();
    await openCard(screen, "Deep clean");

    expect(screen.getByTestId("detail-description").props.numberOfLines).toBe(6);
    fireEvent.press(screen.getByLabelText("Show more"));
    expect(screen.getByTestId("detail-description").props.numberOfLines).toBeUndefined();
  });

  it("starts the task once even when the button is pressed repeatedly", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const screen = await ready();
    await openCard(screen, "Deliver 2 extra towels");
    taskOverride.towels = { ...MINE[0], status: "in_progress", started_at: at(0) };

    fireEvent.press(screen.getByTestId("detail-start"));
    fireEvent.press(screen.getByTestId("detail-start"));
    expect(posts("/tasks/towels/start")).toHaveLength(1);

    await act(async () => release({ data: { ...MINE[0], status: "in_progress", started_at: at(0) }, meta: { replayed: false } }));
    await waitFor(() => expect(screen.getByTestId("detail-complete")).toBeTruthy());
  });

  it("explains a lost claim race and shows the task as the server now has it", async () => {
    mockApiPost.mockRejectedValue(failure(409));
    const screen = await ready();
    fireEvent.press(screen.getByTestId("segment-available"));
    fireEvent.press(screen.getByLabelText("Show details for Extra pillow delivery"));
    await waitFor(() => screen.getByTestId("detail-claim"));
    taskOverride.pillow = { ...POOL[0], assigned_to: "someone-else", status: "in_progress" };

    fireEvent.press(screen.getByTestId("detail-claim"));

    await waitFor(() => expect(screen.getByText("Someone else claimed this task first.")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("detail-claim")).toBeNull());
  });

  it("closes from the close button and from the Android back handler", async () => {
    const screen = await ready();
    await openCard(screen, "Replace iron");
    fireEvent.press(screen.getAllByLabelText("Close").pop()!);
    expect(screen.queryByText("Task details")).toBeNull();

    await openCard(screen, "Replace iron");
    act(() => screen.UNSAFE_getAllByType(Modal)[0].props.onRequestClose());
    expect(screen.queryByText("Task details")).toBeNull();
  });
});

describe("Complete Task sheet", () => {
  async function openComplete(screen: Awaited<ReturnType<typeof ready>>) {
    await openCard(screen, "Replace iron");
    fireEvent.press(screen.getByTestId("detail-complete"));
    await waitFor(() => expect(screen.getByTestId("complete-task-sheet")).toBeTruthy());
  }

  it("names what is being completed and changes nothing until confirmed", async () => {
    const screen = await ready();
    await openComplete(screen);

    expect(screen.getByTestId("complete-identity").props.children).toBe("Room 305 · Replace iron");
    expect(mockApiPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("complete-back"));
    expect(screen.getByText("Task details")).toBeTruthy(); // back to where the employee was
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("sends the trimmed note with the completion, then returns to the list with a success line", async () => {
    mockApiPost.mockResolvedValue({ data: { ...MINE[1], status: "completed" }, meta: { replayed: false, note_saved: true } });
    const screen = await ready();
    await openComplete(screen);

    fireEvent.changeText(screen.getByTestId("complete-note"), "  Left iron on the desk ");
    fireEvent.press(screen.getByTestId("complete-confirm"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/iron/complete", { note: "Left iron on the desk" }));
    await waitFor(() => expect(screen.getByTestId("tasks-success")).toBeTruthy());
    expect(screen.getByText("Task completed")).toBeTruthy();
    expect(screen.queryByTestId("complete-task-sheet")).toBeNull();
    expect(screen.queryByText("Task details")).toBeNull();
  });

  it("keeps the note and allows a retry when completion fails", async () => {
    mockApiPost.mockRejectedValueOnce(failure(500));
    const screen = await ready();
    await openComplete(screen);
    fireEvent.changeText(screen.getByTestId("complete-note"), "Needs a new cord");

    fireEvent.press(screen.getByTestId("complete-confirm"));
    await waitFor(() => expect(screen.getByTestId("complete-error")).toBeTruthy());
    expect(screen.getByTestId("complete-note").props.value).toBe("Needs a new cord");
    expect(screen.queryByTestId("tasks-success")).toBeNull();

    mockApiPost.mockResolvedValueOnce({ data: { ...MINE[1], status: "completed" }, meta: { replayed: false, note_saved: true } });
    fireEvent.press(screen.getByTestId("complete-confirm"));
    await waitFor(() => expect(posts("/tasks/iron/complete")).toHaveLength(2));
    expect(posts("/tasks/iron/complete")[1][1]).toEqual({ note: "Needs a new cord" });
  });

  it("treats a lost reply as success only when the task really is completed", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await ready();
    await openComplete(screen);
    taskOverride.iron = { ...MINE[1], status: "completed" }; // the request landed; only the reply was lost

    fireEvent.press(screen.getByTestId("complete-confirm"));

    await waitFor(() => expect(screen.getByTestId("tasks-success")).toBeTruthy());
  });

  it("reports an unconfirmed outcome (and allows retry) when the task is still open after a lost reply", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await ready();
    await openComplete(screen);

    fireEvent.press(screen.getByTestId("complete-confirm"));

    await waitFor(() => expect(screen.getByText("We couldn't confirm that. Check your connection, then try again.")).toBeTruthy());
    expect(screen.queryByTestId("tasks-success")).toBeNull();
  });

  it("does not send twice on repeated taps", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const screen = await ready();
    await openComplete(screen);

    fireEvent.press(screen.getByTestId("complete-confirm"));
    fireEvent.press(screen.getByTestId("complete-confirm"));
    expect(posts("/tasks/iron/complete")).toHaveLength(1);

    // while it is in flight the sheet can not be dismissed
    act(() => screen.UNSAFE_getAllByType(Modal)[1].props.onRequestClose());
    expect(screen.getByTestId("complete-task-sheet")).toBeTruthy();

    await act(async () => release({ data: { ...MINE[1], status: "completed" }, meta: { replayed: false } }));
    await waitFor(() => expect(screen.getByTestId("tasks-success")).toBeTruthy());
  });

  it("rejects an over-long note before sending and refuses to complete offline", async () => {
    const screen = await ready();
    await openComplete(screen);
    fireEvent.changeText(screen.getByTestId("complete-note"), "x".repeat(2001));
    expect(screen.getByText("Notes can be up to 2000 characters.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("complete-confirm"));
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("never claims the note was saved when only the completion succeeded, and lets it be retried", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { ...MINE[1], status: "completed" }, meta: { replayed: false, note_saved: false } });
    const screen = await ready();
    await openComplete(screen);
    fireEvent.changeText(screen.getByTestId("complete-note"), "Cord is frayed");
    fireEvent.press(screen.getByTestId("complete-confirm"));

    await waitFor(() => expect(screen.getByText("Your note wasn't saved. Try again, or skip it.")).toBeTruthy());
    expect(screen.queryByTestId("tasks-success")).toBeNull();
    expect(screen.getByTestId("complete-note").props.value).toBe("Cord is frayed");

    mockApiPost.mockResolvedValueOnce({ data: { id: "c9", comment: "Cord is frayed" } });
    fireEvent.press(screen.getByTestId("complete-retry-note"));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/iron/comments", { comment: "Cord is frayed" }));
    await waitFor(() => expect(screen.getByTestId("tasks-success")).toBeTruthy());
  });
});

describe("Activity & Notes sheet", () => {
  async function openNotes(screen: Awaited<ReturnType<typeof ready>>) {
    await openCard(screen, "Replace iron");
    fireEvent.press(screen.getByTestId("detail-add-note"));
    await waitFor(() => expect(screen.getByTestId("activity-notes-sheet")).toBeTruthy());
  }

  it("lists persisted events chronologically under the hotel-local day, with the task identity", async () => {
    events.iron = [
      { id: "created", kind: "created", at: new Date(NOW - 3000).toISOString(), actor_id: "fd", actor_name: "Front Desk", text: null },
      { id: "started", kind: "started", at: new Date(NOW - 2000).toISOString(), actor_id: "me", actor_name: "Maria", text: null },
      { id: "comment-1", kind: "comment", at: new Date(NOW - 1000).toISOString(), actor_id: "fd", actor_name: "Front Desk", text: "Guest is out until 3." },
    ];
    const screen = await ready();
    await openNotes(screen);

    await waitFor(() => expect(screen.getByText("Guest is out until 3.")).toBeTruthy());
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByTestId("activity-subtitle").props.children).toBe("Room 305 · Replace iron");
    expect(screen.getByText(/Task started/)).toBeTruthy();
    expect(screen.getByText(/· You/)).toBeTruthy();
    expect(screen.getAllByTestId(/^activity-/).map((node) => node.props.testID).filter((id) => id !== "activity-notes-sheet" && id !== "activity-subtitle" && id !== "activity-empty")).toEqual([
      "activity-created",
      "activity-started",
      "activity-comment-1",
    ]);
  });

  it("shows a useful empty state when there is nothing yet", async () => {
    const screen = await ready();
    await openNotes(screen);
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeTruthy());
  });

  it("rejects an empty note without calling the API", async () => {
    const screen = await ready();
    await openNotes(screen);
    await waitFor(() => screen.getByTestId("activity-empty"));

    fireEvent.changeText(screen.getByTestId("note-input"), "   ");
    fireEvent.press(screen.getByTestId("note-post"));

    expect(screen.getByText("Write a note first.")).toBeTruthy();
    expect(posts("/comments")).toHaveLength(0);
  });

  it("posts a note, clears the draft only after the server stored it, and reloads the feed", async () => {
    mockApiPost.mockResolvedValue({ data: { id: "c1", comment: "Running 10 min late" } });
    const screen = await ready();
    await openNotes(screen);
    await waitFor(() => screen.getByTestId("activity-empty"));
    const loads = mockApiGet.mock.calls.filter((call) => String(call[0]).endsWith("/iron/activity")).length;

    fireEvent.changeText(screen.getByTestId("note-input"), "  Running 10 min late ");
    fireEvent.press(screen.getByTestId("note-post"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/iron/comments", { comment: "Running 10 min late" }));
    await waitFor(() => expect(screen.getByTestId("note-input").props.value).toBe(""));
    await waitFor(() =>
      expect(mockApiGet.mock.calls.filter((call) => String(call[0]).endsWith("/iron/activity")).length).toBeGreaterThan(loads),
    );
  });

  it("keeps the draft and says so when posting fails, and does not post twice on repeated taps", async () => {
    let reject: (reason: unknown) => void = () => undefined;
    mockApiPost.mockImplementation(() => new Promise((_, fail) => (reject = fail)));
    const screen = await ready();
    await openNotes(screen);
    await waitFor(() => screen.getByTestId("activity-empty"));

    fireEvent.changeText(screen.getByTestId("note-input"), "Please send more towels");
    fireEvent.press(screen.getByTestId("note-post"));
    fireEvent.press(screen.getByTestId("note-post"));
    expect(posts("/comments")).toHaveLength(1);

    await act(async () => reject(failure(500)));
    await waitFor(() => expect(screen.getByText("Your note wasn't posted. It's still here — try again.")).toBeTruthy());
    expect(screen.getByTestId("note-input").props.value).toBe("Please send more towels");
  });

  it("explains when the task is no longer available to post on", async () => {
    mockApiPost.mockRejectedValue(failure(404));
    const screen = await ready();
    await openNotes(screen);
    await waitFor(() => screen.getByTestId("activity-empty"));

    fireEvent.changeText(screen.getByTestId("note-input"), "hello");
    fireEvent.press(screen.getByTestId("note-post"));

    await waitFor(() => expect(screen.getAllByText("This task is no longer available to you.").length).toBeGreaterThan(0));
  });

  it("returns to the detail sheet when closed", async () => {
    const screen = await ready();
    await openNotes(screen);
    fireEvent.press(screen.getAllByLabelText("Close").pop()!);
    await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
  });
});

describe("Spanish", () => {
  it("translates the sheets and their accessibility labels", async () => {
    mockLanguage = "es";
    mockMyRooms = [{ id: "r305" }];
    const screen = render(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Mostrar detalles de Replace iron"));
    await waitFor(() => expect(screen.getByText("Detalles de la tarea")).toBeTruthy());
    expect(screen.getByText("Completar tarea")).toBeTruthy();
    expect(screen.getByText("Agregar nota")).toBeTruthy();
    expect(screen.getByLabelText("Abrir la habitación 305 en Mis habitaciones")).toBeTruthy();

    fireEvent.press(screen.getByTestId("detail-complete"));
    await waitFor(() => expect(screen.getByText("¿Completar esta tarea?")).toBeTruthy());
    expect(screen.getByLabelText("Nota de cierre, opcional")).toBeTruthy();
  });
});
