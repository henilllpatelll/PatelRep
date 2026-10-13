import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: jest.fn(), back: jest.fn() },
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
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import TasksRoute from "@/app/(app)/tasks";

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
const apiError = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { status, code });

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, status: "open", task_type: "housekeeping", priority: "normal", assigned_to: "me", created_at: at(-600), due_at: at(240), rooms: null, ...extra };
}

const MINE = [
  row("towels", { title: "Deliver 2 extra towels", due_at: at(-12), room_id: "r214", rooms: { room_number: "214", floor: 2 } }),
  row("iron", { title: "Replace iron", status: "in_progress", started_at: at(-8), rooms: { room_number: "305", floor: 3 } }),
  row("lamp", { title: "Swap lamp", due_at: at(300) }),
];
const POOL = [row("pillow", { title: "Extra pillow delivery", assigned_to: null, rooms: { room_number: "218", floor: 2 } })];

/* The fake server: one source of truth for lists, single reads, activity and the two blocker verbs. */
let blocks: Record<string, Record<string, unknown> | null> = {};
let taskOverride: Record<string, Record<string, unknown>> = {};
/** What only the single-task endpoints report (the lists keep their copy until the next refresh). */
let readOverride: Record<string, Record<string, unknown>> = {};
let events: Record<string, unknown[]> = {};
let notifyStatus = "queued";
type Row = Record<string, unknown>;
const withBlocker = (r: Row): Row => ({ ...r, blocker: blocks[String(r.id)] ?? null });
const everything = (): Row[] => [...MINE, ...POOL].map((r: Row) => withBlocker(taskOverride[String(r.id)] ?? r));
const find = (id: string): Row | undefined => readOverride[id] ?? everything().find((r) => r.id === id);
const posts = (suffix: string) => mockApiPost.mock.calls.filter((call) => String(call[0]).endsWith(suffix));

function serve() {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) {
      return { data: everything().filter((r) => r.assigned_to === "me" && ["open", "in_progress"].includes(String(r.status))), meta: { has_more: false } };
    }
    if (path.startsWith("/tasks/available")) return { data: everything().filter((r) => r.assigned_to === null && r.status === "open"), meta: { has_more: false } };
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) return { data: { task: find(activity[1]), events: events[activity[1]] ?? [] }, meta: { truncated: false } };
    const detail = /^\/tasks\/([^/]+)$/.exec(path);
    if (detail && find(detail[1])) return { data: find(detail[1]) };
    throw new Error(`unexpected GET ${path}`);
  });
  mockApiPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    const report = /^\/tasks\/([^/]+)\/blockers$/.exec(path);
    if (report) {
      const id = report[1];
      const blocker = {
        id: "b1",
        reason: body.reason,
        details: body.details ?? null,
        reported_by: "me",
        reported_by_name: "Maria Lopez",
        reported_at: new Date().toISOString(),
        status: "active",
        notification_status: notifyStatus,
      };
      blocks[id] = blocker;
      return { data: { task: find(id), blocker }, meta: { replayed: false } };
    }
    const resume = /^\/tasks\/([^/]+)\/resume$/.exec(path);
    if (resume) {
      const id = resume[1];
      blocks[id] = null;
      return { data: { task: find(id), blocker: null }, meta: { replayed: false } };
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} });
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  blocks = {};
  taskOverride = {};
  readOverride = {};
  events = {};
  notifyStatus = "queued";
  serve();
});

type Screen = Awaited<ReturnType<typeof ready>>;

async function ready() {
  const screen = render(
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
  return screen;
}
const openCard = async (screen: Screen, title: string) => {
  const later = screen.queryByLabelText("Show later tasks");
  if (later && !screen.queryByLabelText(`Show details for ${title}`)) fireEvent.press(later);
  fireEvent.press(screen.getByLabelText(`Show details for ${title}`));
  await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
};
async function openBlockerSheet(screen: Screen, title = "Deliver 2 extra towels") {
  await openCard(screen, title);
  fireEvent.press(screen.getByTestId("detail-unable"));
  await waitFor(() => expect(screen.getByTestId("blocker-sheet")).toBeTruthy());
}
const pick = (screen: Screen, reason: string) => fireEvent.press(screen.getByTestId(`blocker-reason-${reason}`));
const REASONS = ["guest_unavailable", "do_not_disturb", "missing_supplies", "access_issue", "assistance_needed", "equipment_issue", "other"];

describe("Unable to Complete? entry point", () => {
  it("is offered on assigned live tasks, below the primary action, and never on the Available pool", async () => {
    const screen = await ready();
    await openCard(screen, "Deliver 2 extra towels");
    expect(screen.getByTestId("detail-start")).toBeTruthy();
    expect(screen.getByTestId("detail-unable")).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText("Close").pop()!);

    await openCard(screen, "Replace iron");
    expect(screen.getByTestId("detail-complete")).toBeTruthy();
    expect(screen.getByTestId("detail-unable")).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText("Close").pop()!);

    fireEvent.press(screen.getByTestId("segment-available"));
    fireEvent.press(screen.getByLabelText("Show details for Extra pillow delivery"));
    await waitFor(() => expect(screen.getByTestId("detail-claim")).toBeTruthy());
    expect(screen.queryByTestId("detail-unable")).toBeNull();
  });

  it("is not offered once the task is finished, and the secondary action is not a primary button", async () => {
    readOverride.iron = { ...MINE[1], status: "completed", completed_at: at(-1), blocker: null };
    const screen = await ready();
    await openCard(screen, "Replace iron");

    await waitFor(() => expect(screen.getByTestId("detail-readonly")).toBeTruthy());
    expect(screen.queryByTestId("detail-unable")).toBeNull();
  });

  it("opens a sheet that names the task and changes nothing until Send update", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);

    expect(screen.getByTestId("blocker-identity").props.children).toBe("Room 214 — Deliver 2 extra towels");
    expect(screen.getByText("What prevented you from finishing?")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true); // nothing chosen yet

    fireEvent.press(screen.getByTestId("blocker-cancel"));
    expect(screen.getByText("Task details")).toBeTruthy(); // back where the employee was
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe("Unable to Complete? form", () => {
  it("offers every reason as a single-choice radio with plain hotel wording", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);

    const labels = ["Guest unavailable", "Do Not Disturb", "Missing supplies", "Access problem", "Need assistance", "Equipment issue", "Other"];
    labels.forEach((label) => expect(screen.getByLabelText(label)).toBeTruthy());
    expect(screen.UNSAFE_getAllByProps({ accessibilityRole: "radiogroup" }).length).toBeGreaterThan(0);

    for (const reason of REASONS) {
      pick(screen, reason);
      expect(screen.getByTestId(`blocker-reason-${reason}`).props.accessibilityState.selected).toBe(true);
      REASONS.filter((other) => other !== reason).forEach((other) =>
        expect(screen.getByTestId(`blocker-reason-${other}`).props.accessibilityState.selected).toBe(false),
      );
    }
  });

  it("lets a common reason go without typing anything", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);

    pick(screen, "do_not_disturb");

    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("blocker-details-required")).toBeNull();
  });

  it("requires a description for Other", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);

    pick(screen, "other");
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("blocker-details-required")).toBeTruthy();
    fireEvent.press(screen.getByTestId("blocker-send"));
    expect(mockApiPost).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId("blocker-details"), "   ");
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId("blocker-details"), "Cart wheel is stuck");
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(false);
  });

  it("refuses details over the limit", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "missing_supplies");

    fireEvent.changeText(screen.getByTestId("blocker-details"), "x".repeat(1001));

    expect(screen.getByText("Details can be up to 1000 characters.")).toBeTruthy();
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true);
  });
});

describe("submitting a blocker", () => {
  it("sends the reason, trimmed details and an idempotency key, then shows the saved report", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "missing_supplies");
    fireEvent.changeText(screen.getByTestId("blocker-details"), "  No clean bath towels on floor 2 ");

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(posts("/tasks/towels/blockers")).toHaveLength(1));
    const body = posts("/tasks/towels/blockers")[0][1];
    expect(body).toEqual({
      reason: "missing_supplies",
      details: "No clean bath towels on floor 2",
      client_request_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
    // back on Task Detail, showing what the SERVER stored: real reason, reporter and details
    await waitFor(() => expect(screen.getByTestId("detail-blocker")).toBeTruthy());
    expect(screen.queryByTestId("blocker-sheet")).toBeNull();
    expect(within(screen.getByTestId("detail-blocker")).getByTestId("detail-blocker-reason").props.children).toBe("Missing supplies");
    expect(screen.getByTestId("detail-blocker-reportedBy").props.children).toBe("You");
    expect(screen.getByTestId("detail-blocker-details").props.children).toBe("No clean bath towels on floor 2");
    expect(screen.getByTestId("detail-blocker-reportedAt")).toBeTruthy();
    expect(screen.getByTestId("detail-blocker-notify").props.children).toBe("Your report is saved and your supervisor has been alerted.");
    // the work is not finished: the primary action becomes Resume, Complete/Start are gone
    expect(screen.getByTestId("detail-resume")).toBeTruthy();
    expect(screen.queryByTestId("detail-start")).toBeNull();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
    expect(screen.queryByTestId("detail-unable")).toBeNull();
    expect(screen.getByText(/· Needs attention$/)).toBeTruthy();
  });

  it.each([
    ["pending", "Your report has been saved."],
    ["failed", "Your report is saved, but we couldn't alert a supervisor."],
    ["not_available", "Your report is saved. No supervisor is available to alert right now."],
  ])("only claims what the server confirmed about the supervisor alert (%s)", async (status, text) => {
    notifyStatus = status;
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "access_issue");

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByTestId("detail-blocker-notify").props.children).toBe(text));
    expect(screen.queryByText(/supervisor has been alerted/)).toBeNull();
  });

  it("sends only once however many times Send update is pressed", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "equipment_issue");

    fireEvent.press(screen.getByTestId("blocker-send"));
    fireEvent.press(screen.getByTestId("blocker-send"));
    expect(posts("/tasks/towels/blockers")).toHaveLength(1);

    // while in flight the sheet can not be dismissed
    act(() => screen.UNSAFE_getAllByType(Modal)[3].props.onRequestClose());
    expect(screen.getByTestId("blocker-sheet")).toBeTruthy();

    blocks.towels = { id: "b1", reason: "equipment_issue", details: null, reported_by: "me", reported_by_name: "Maria", reported_at: new Date().toISOString(), status: "active", notification_status: "queued" };
    await act(async () => release({ data: { task: find("towels"), blocker: blocks.towels }, meta: { replayed: false } }));
    await waitFor(() => expect(screen.getByTestId("detail-blocker")).toBeTruthy());
  });

  it("never shows success when the network fails, keeps what was typed, and resends with the SAME key", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "other");
    fireEvent.changeText(screen.getByTestId("blocker-details"), "Guest left the door chained");

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByTestId("blocker-error")).toBeTruthy());
    expect(screen.getByText("We couldn't confirm it was sent. Check your connection and send again — it won't be reported twice.")).toBeTruthy();
    expect(screen.queryByTestId("detail-blocker")).toBeNull();
    expect(screen.getByTestId("blocker-details").props.value).toBe("Guest left the door chained");
    expect(screen.getByTestId("blocker-reason-other").props.accessibilityState.selected).toBe(true);

    serve();
    fireEvent.press(screen.getByTestId("blocker-send"));
    await waitFor(() => expect(screen.getByTestId("detail-blocker")).toBeTruthy());
    const [first, second] = posts("/tasks/towels/blockers");
    expect(first[1].client_request_id).toBe(second[1].client_request_id);
  });

  it("treats a lost reply as success only when the server really has the report", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "missing_supplies");
    blocks.towels = { id: "b9", reason: "missing_supplies", details: null, reported_by: "me", reported_by_name: "Maria", reported_at: at(0), status: "active", notification_status: "queued" };

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByTestId("detail-blocker")).toBeTruthy());
    expect(screen.queryByTestId("blocker-error")).toBeNull();
  });

  it("shows a server error without success and lets the employee try again", async () => {
    mockApiPost.mockRejectedValueOnce(apiError(500));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "guest_unavailable");

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByText("Couldn't send your update. What you wrote is still here — try again.")).toBeTruthy());
    expect(screen.queryByTestId("detail-blocker")).toBeNull();
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(false);
  });

  it("explains a report that already exists and shows the task as the server has it", async () => {
    mockApiPost.mockRejectedValueOnce(apiError(409, "blocker_already_active"));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "missing_supplies");
    blocks.towels = { id: "b0", reason: "equipment_issue", details: null, reported_by: "me", reported_by_name: "Maria", reported_at: at(-5), status: "active", notification_status: "queued" };

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByText("A problem was already reported on this task.")).toBeTruthy());
    expect(screen.getByTestId("detail-blocker-reason").props.children).toBe("Equipment issue");
  });

  it("says so when the task was finished or reassigned elsewhere while the form was open", async () => {
    mockApiPost.mockRejectedValueOnce(apiError(409, "task_closed"));
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "access_issue");
    taskOverride.towels = { ...MINE[0], status: "completed", completed_at: at(-1) };

    fireEvent.press(screen.getByTestId("blocker-send"));

    await waitFor(() => expect(screen.getByText("This task is already finished, so a problem can't be reported.")).toBeTruthy());
    expect(screen.queryByTestId("blocker-sheet")).toBeNull();
    expect(screen.queryByTestId("detail-unable")).toBeNull();
  });

  it("needs a connection: keeps the draft, blocks sending and never posts", async () => {
    mockOnline = false;
    const screen = await ready();
    await openCard(screen, "Deliver 2 extra towels");
    fireEvent.press(screen.getByTestId("detail-unable"));
    await waitFor(() => expect(screen.getByTestId("blocker-sheet")).toBeTruthy());
    pick(screen, "missing_supplies");
    fireEvent.changeText(screen.getByTestId("blocker-details"), "Only 2 towels left");

    expect(screen.getByTestId("blocker-offline")).toBeTruthy();
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("blocker-send"));
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(screen.queryByTestId("detail-blocker")).toBeNull();
  });

  it("keeps an unsent draft when the sheet is closed and drops it on Cancel", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);
    pick(screen, "assistance_needed");
    fireEvent.changeText(screen.getByTestId("blocker-details"), "Mattress is too heavy");
    fireEvent.press(screen.getAllByLabelText("Close").pop()!);
    expect(screen.getByText("Task details")).toBeTruthy();

    fireEvent.press(screen.getByTestId("detail-unable"));
    await waitFor(() => expect(screen.getByTestId("blocker-sheet")).toBeTruthy());
    expect(screen.getByTestId("blocker-reason-assistance_needed").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("blocker-details").props.value).toBe("Mattress is too heavy");

    fireEvent.press(screen.getByTestId("blocker-cancel"));
    fireEvent.press(screen.getByTestId("detail-unable"));
    await waitFor(() => expect(screen.getByTestId("blocker-sheet")).toBeTruthy());
    expect(screen.getByTestId("blocker-details").props.value).toBe("");
    expect(screen.getByTestId("blocker-send").props.accessibilityState.disabled).toBe(true);
  });
});

describe("a blocked task in My Work", () => {
  const blockedTowels = () => {
    blocks.towels = { id: "b1", reason: "missing_supplies", details: "No clean towels", reported_by: "me", reported_by_name: "Maria", reported_at: at(-30), status: "active", notification_status: "queued" };
  };

  it("stays visible as unfinished work in its own section, once, with reason, report time and the original due time", async () => {
    blockedTowels();
    const screen = await ready();

    expect(screen.getByText("NEEDS ATTENTION · 1")).toBeTruthy();
    const card = within(screen.getByTestId("task-towels"));
    expect(card.getByText("Missing supplies")).toBeTruthy();
    expect(card.getByText(/^Reported /)).toBeTruthy();
    expect(card.getByText(/^\d+m overdue$|^\d+h \d+m overdue$/)).toBeTruthy(); // SLA / overdue maths untouched
    expect(card.getByText(/^Due /)).toBeTruthy(); // original due time preserved
    expect(card.getByText("View details")).toBeTruthy();
    expect(screen.queryByTestId("task-action-towels")?.props.accessibilityLabel).toBe("View details for Deliver 2 extra towels");
    expect(screen.getAllByTestId("task-towels")).toHaveLength(1); // never duplicated in Next up / Later
    expect(screen.queryByText("NEXT UP")).toBeTruthy(); // other tasks keep their normal sections
  });

  it("does not count as completed and keeps the summary honest", async () => {
    blockedTowels();
    const screen = await ready();

    // 2 not started (towels blocked + lamp) and 1 in progress: status-based, nothing marked done
    expect(screen.getByLabelText("Remaining: 2")).toBeTruthy();
    expect(screen.getByLabelText("In progress: 1")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Done today: 0")).toBeTruthy());
    expect(screen.queryByTestId("tasks-success")).toBeNull();
  });

  it("opens Task Detail from the card with Resume as the primary action and no Start/Complete", async () => {
    blockedTowels();
    const screen = await ready();
    fireEvent.press(within(screen.getByTestId("task-towels")).getByText("View details"));

    await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
    expect(screen.getByTestId("detail-blocker")).toBeTruthy();
    expect(screen.getByTestId("detail-resume")).toBeTruthy();
    expect(screen.getByTestId("detail-view-activity")).toBeTruthy();
    expect(screen.queryByTestId("detail-start")).toBeNull();
    expect(screen.queryByTestId("detail-complete")).toBeNull();
  });

  it("shows the persisted blocker events in Activity", async () => {
    blockedTowels();
    events.towels = [
      { id: "created", kind: "created", at: at(-300), actor_id: "fd", actor_name: "Front Desk", text: null, reason: null, resolution: null },
      { id: "blocker-b1-reported", kind: "blocker_reported", at: at(-30), actor_id: "me", actor_name: "Maria Lopez", text: "No clean towels", reason: "missing_supplies", resolution: null },
    ];
    const screen = await ready();
    fireEvent.press(within(screen.getByTestId("task-towels")).getByText("View details"));

    await waitFor(() => expect(screen.getByText(/^Couldn't complete: Missing supplies/)).toBeTruthy());
    expect(screen.getAllByText("No clean towels").length).toBeGreaterThan(0);
  });

  it("resumes: asks the server with the report it was looking at, then the task is workable again", async () => {
    blockedTowels();
    const screen = await ready();
    fireEvent.press(within(screen.getByTestId("task-towels")).getByText("View details"));
    await waitFor(() => screen.getByTestId("detail-resume"));

    fireEvent.press(screen.getByTestId("detail-resume"));

    await waitFor(() => expect(posts("/tasks/towels/resume")).toHaveLength(1));
    expect(posts("/tasks/towels/resume")[0][1]).toEqual({ blocker_id: "b1" });
    await waitFor(() => expect(screen.getByTestId("detail-start")).toBeTruthy());
    expect(screen.queryByTestId("detail-blocker")).toBeNull();
    expect(screen.queryByTestId("detail-resume")).toBeNull();
  });

  it("explains a refused resume and shows the task as the server now has it", async () => {
    blockedTowels();
    mockApiPost.mockRejectedValueOnce(apiError(409, "blocker_changed"));
    const screen = await ready();
    fireEvent.press(within(screen.getByTestId("task-towels")).getByText("View details"));
    await waitFor(() => screen.getByTestId("detail-resume"));

    fireEvent.press(screen.getByTestId("detail-resume"));

    await waitFor(() => expect(screen.getByText("This task changed. Your list was refreshed.")).toBeTruthy());
  });

  it("learns that a supervisor already cleared the blocker when it refreshes", async () => {
    blockedTowels();
    const screen = await ready();
    expect(screen.getByText("NEEDS ATTENTION · 1")).toBeTruthy();

    blocks.towels = null; // a supervisor resolved it meanwhile
    await act(async () => {
      fireEvent.press(screen.getByTestId("segment-available"));
      fireEvent.press(screen.getByTestId("segment-mine"));
    });
    // focus / pull-to-refresh re-reads the list; simulate the refresh the app does on foreground
    const refresh = screen.UNSAFE_getByType(require("react-native").FlatList).props.refreshControl.props.onRefresh;
    await act(async () => refresh());

    await waitFor(() => expect(screen.queryByText("NEEDS ATTENTION · 1")).toBeNull());
    expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy();
  });
});

describe("Spanish and accessibility", () => {
  it("renders the whole flow in Spanish", async () => {
    mockLanguage = "es";
    const screen = render(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Deliver 2 extra towels")).toBeTruthy());
    fireEvent.press(screen.getByTestId("task-open-towels"));
    await waitFor(() => screen.getByTestId("detail-unable"));
    expect(screen.getByText("¿No puedes completarla?")).toBeTruthy();

    fireEvent.press(screen.getByTestId("detail-unable"));
    await waitFor(() => screen.getByTestId("blocker-sheet"));
    expect(screen.getByText("¿Qué te impidió terminar?")).toBeTruthy();
    ["Huésped no disponible", "No molestar", "Faltan suministros", "Problema de acceso", "Necesito ayuda", "Problema con el equipo", "Otro"].forEach((label) =>
      expect(screen.getByLabelText(label)).toBeTruthy(),
    );
    expect(screen.getByText("Enviar aviso")).toBeTruthy();
    expect(screen.getByText("Cancelar")).toBeTruthy();

    pick(screen, "missing_supplies");
    fireEvent.press(screen.getByTestId("blocker-send"));
    await waitFor(() => screen.getByTestId("detail-blocker"));
    expect(screen.getByText("Requiere atención")).toBeTruthy();
    expect(screen.getByTestId("detail-blocker-reason").props.children).toBe("Faltan suministros");
    expect(screen.getByTestId("detail-blocker-reportedBy").props.children).toBe("Tú");
    expect(screen.getByText("Reanudar tarea")).toBeTruthy();
  });

  it("exposes radio semantics, a header, large touch targets and labelled controls", async () => {
    const screen = await ready();
    await openBlockerSheet(screen);

    const radio = screen.getByTestId("blocker-reason-missing_supplies");
    expect(radio.props.accessibilityRole).toBe("radio");
    expect(screen.getByLabelText("Reason").props.accessibilityRole).toBe("radiogroup");
    expect(screen.getByText("What prevented you from finishing?").props.accessibilityRole).toBe("header");
    expect(screen.getByLabelText("Additional details")).toBeTruthy();
    const style = Object.assign({}, ...([] as unknown[]).concat(radio.props.style).flat());
    expect(style.minHeight ?? 44).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId("blocker-send").props.accessibilityRole).toBe("button");
  });
});
