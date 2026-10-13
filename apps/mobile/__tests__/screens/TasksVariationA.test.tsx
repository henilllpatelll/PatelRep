import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ScrollView } from "react-native";

const EN: Record<string, string> = {
  "tasks.title": "My tasks",
  "tasks.groupOverdue": "OVERDUE",
  "tasks.groupNow": "DO NOW",
  "tasks.groupToday": "TODAY",
  "tasks.openLabel": "open",
  "tasks.doneToday": "{{count}} done today",
  "tasks.aiKicker": "AI Task Briefing",
  "tasks.brief.overdue": "{{count}} task(s) overdue — start with “{{title}}”.",
  "tasks.brief.urgent": "Start with “{{title}}” — it's your highest priority.",
  "tasks.brief.next": "Next up: “{{title}}”.",
  "tasks.brief.allClear": "All caught up. No open tasks on your list.",
  "tasks.brief.guestCount": "{{count}} guest-facing task(s) — those make or break reviews.",
  "tasks.brief.roomCount": "{{count}} task(s) are tied to rooms on your route.",
  "tasks.markDone": "Mark {{title}} done",
  "tasks.confirmComplete": "Mark this task done?",
  "tasks.confirmYes": "Done",
  "tasks.claimStart": "Claim & start",
  "tasks.claimFailed": "Someone else already claimed this task",
  "tasks.completeFailed": "Couldn't mark this task done.",
  "tasks.loadFailed": "Couldn't load your tasks.",
  "tasks.refreshFailed": "Couldn't refresh — showing your last loaded tasks.",
  "tasks.listIncomplete": "This list may be incomplete.",
  "tasks.aiRejected": "That task couldn't be created.",
  "tasks.locationLabel": "Location: {{place}}",
  "tasks.roomLabel": "Room {{room}}",
  "tasks.unclaimedTag": "Up for grabs",
  "tasks.guestTag": "Guest",
  "tasks.dueAt": "Due {{time}}",
  "tasks.overdueBy": "{{minutes}}m overdue",
  "tasks.overdueByHours": "{{hours}}h {{minutes}}m overdue",
  "tasks.statusInProgress": "IN PROGRESS",
  "tasks.typeLabel.housekeeping": "Housekeeping",
  "tasks.typeLabel.engineering": "Engineering",
  "tasks.typeLabel.guest_request": "Guest request",
  "tasks.typeLabel.lost_found": "Lost & Found",
  "tasks.typeLabel.general": "General",
  "tasks.addPlaceholder": "Add a task in plain words…",
  "tasks.addWithAI": "Create task with AI",
  "tasks.aiPreviewLabel": "AI drafted this task",
  "tasks.aiCreated": "Task created ✨",
  "tasks.aiUnavailable": "AI is unavailable right now — try again in a moment.",
  "tasks.aiNoTask": "I couldn't turn that into a task.",
  "tasks.emptyTitle": "No tasks assigned",
  "tasks.emptyAiHint": "Type below to create one with AI.",
  "ai.briefing.sourceLocal": "Planned on device",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.offline": "Offline",
  "copilot.create": "Create",
  "copilot.dismiss": "Dismiss",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
    },
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

const mockApiGet = jest.fn();
const mockApiPatch = jest.fn();
const mockApiPost = jest.fn();

jest.mock("@/lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

let mockRole: string = "housekeeper";
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: true, user: { role: mockRole, language_pref: "en" } }),
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { StaffTasksScreen as TasksScreen } from "@/components/tasks/StaffTasksScreen";

function renderScreen() {
  return render(
    <ThemeProvider>
      <TasksScreen />
    </ThemeProvider>,
  );
}

const NOW = Date.now();

// Rows exactly as GET /tasks/mine and /tasks/available return them (raw backend shape).
const myWork = [
  {
    id: "task-iron",
    title: "Fix iron in 305",
    priority: "normal",
    task_type: "housekeeping",
    status: "open",
    assigned_to: "me",
    due_at: new Date(NOW - 30 * 60000).toISOString(),
    room_id: "room-305",
    rooms: { room_number: "305", floor: 3 },
  },
  {
    id: "task-cart",
    title: "Restock cart - floor 2",
    priority: "urgent",
    task_type: "housekeeping",
    status: "in_progress",
    assigned_to: "me",
  },
  {
    id: "task-towels",
    title: "Deliver 2 extra towels to 214",
    description: "Guest asked at the front desk — leave them at the door.",
    priority: "normal",
    task_type: "guest_request",
    status: "open",
    assigned_to: "me",
    is_ai_created: true,
    rooms: { room_number: "214", floor: 2 },
    guest_request: { id: "gr-1", status: "open" },
  },
];

const available = [
  {
    id: "task-fridge",
    title: "Deep-clean fridge - 122",
    priority: "low",
    task_type: "housekeeping",
    status: "open",
    assigned_to: null,
    rooms: { room_number: "122", floor: 1 },
  },
];

function serve(overrides: { mine?: unknown; pool?: unknown; mineMeta?: Record<string, unknown> } = {}) {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine")) return { data: overrides.mine ?? myWork, meta: { has_more: false, ...overrides.mineMeta } };
    if (path.startsWith("/tasks/available")) return { data: overrides.pool ?? available, meta: { has_more: false } };
    throw new Error(`unexpected GET ${path}`);
  });
}

const apiFailure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "housekeeper";
  serve();
  mockApiPatch.mockResolvedValue({});
});

describe("TasksScreen", () => {
  it("loads My Work and Available from the server contract and renders the smart-order buckets", async () => {
    const { getByText, getAllByLabelText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    expect(mockApiGet).toHaveBeenCalledWith("/tasks/mine?limit=200");
    expect(mockApiGet).toHaveBeenCalledWith("/tasks/available?limit=200");
    expect(mockApiGet).not.toHaveBeenCalledWith(expect.stringContaining("my_tasks"));
    expect(getByText("AI Task Briefing")).toBeTruthy();
    expect(getByText("1 task(s) overdue — start with “Fix iron in 305”.")).toBeTruthy();
    expect(getByText(/guest-facing task/)).toBeTruthy();

    expect(getByText("OVERDUE")).toBeTruthy();
    expect(getByText("DO NOW")).toBeTruthy();
    expect(getByText("TODAY")).toBeTruthy();
    expect(getByText("Fix iron in 305")).toBeTruthy();
    expect(getByText("Restock cart - floor 2")).toBeTruthy();
    expect(getByText("Deliver 2 extra towels to 214")).toBeTruthy();
    expect(getByText("Deep-clean fridge - 122")).toBeTruthy();
    expect(getByText(/30m overdue|3[01]m overdue/)).toBeTruthy();

    expect(getAllByLabelText("Housekeeping").length).toBeGreaterThanOrEqual(2);
    expect(getAllByLabelText("Guest request").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Guest asked at the front desk — leave them at the door.")).toBeTruthy();
    expect(getByText("URGENT")).toBeTruthy();
    expect(queryByText("NORMAL")).toBeNull();
    expect(queryByText("LOW")).toBeNull();
    // only the pool task is claimable
    expect(getByText("Up for grabs")).toBeTruthy();
  });

  it("does not ask non-housekeepers for the Available pool", async () => {
    mockRole = "engineer";
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("Fix iron in 305")).toBeTruthy());

    expect(mockApiGet.mock.calls.map((call) => call[0])).toEqual(["/tasks/mine?limit=200"]);
  });

  it("shows a free-text location as a location, never as a room, and only flags AI when the server did", async () => {
    serve({
      mine: [
        { id: "t-pool", title: "Check pool deck", status: "open", task_type: "general", assigned_to: "me", location_text: "Pool deck" },
      ],
      pool: [],
    });
    const { getByText, getByLabelText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Check pool deck")).toBeTruthy());

    expect(getByLabelText("Location: Pool deck")).toBeTruthy();
    expect(queryByText("AI")).toBeNull();
  });

  it("requires a confirmation, then completes through the dedicated endpoint", async () => {
    mockApiPost.mockResolvedValue({
      data: { id: "task-cart", title: "x", status: "completed" },
      meta: { replayed: false },
    });
    const { getByText, getByLabelText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Restock cart - floor 2")).toBeTruthy());

    expect(queryByText("Mark this task done?")).toBeNull();
    fireEvent.press(getByLabelText("Mark Restock cart - floor 2 done"));
    expect(getByText("Mark this task done?")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();

    fireEvent.press(getByText("Done"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/task-cart/complete", {}));
    await waitFor(() => expect(queryByText("Restock cart - floor 2")).toBeNull());
    expect(getByText("1 done today")).toBeTruthy();
    // the old generic status PATCH (manager-only on the server) is never used
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("keeps the task and says so when the server rejects the completion", async () => {
    mockApiPost.mockRejectedValue(apiFailure(500));
    const { getByText, getByLabelText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Restock cart - floor 2")).toBeTruthy());
    fireEvent.press(getByLabelText("Mark Restock cart - floor 2 done"));
    fireEvent.press(getByText("Done"));

    await waitFor(() => expect(getByText("Couldn't mark this task done.")).toBeTruthy());
    expect(getByText("Restock cart - floor 2")).toBeTruthy();
    expect(queryByText(/done today/)).toBeNull();
  });

  it("re-syncs from the server when a completion hits a state conflict", async () => {
    mockApiPost.mockRejectedValue(apiFailure(409));
    const { getByText, getByLabelText } = renderScreen();

    await waitFor(() => expect(getByText("Restock cart - floor 2")).toBeTruthy());
    const loadsBefore = mockApiGet.mock.calls.length;
    fireEvent.press(getByLabelText("Mark Restock cart - floor 2 done"));
    fireEvent.press(getByText("Done"));

    await waitFor(() => expect(mockApiGet.mock.calls.length).toBeGreaterThan(loadsBefore));
    expect(getByText("Couldn't mark this task done.")).toBeTruthy();
  });

  it("shows an error with retry instead of an empty queue when the first load fails", async () => {
    mockApiGet.mockRejectedValue(apiFailure(500));
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Couldn't load your tasks.")).toBeTruthy());
    expect(queryByText("No tasks assigned")).toBeNull();

    serve();
    fireEvent.press(getByText("Retry"));

    await waitFor(() => expect(getByText("Fix iron in 305")).toBeTruthy());
  });

  it("keeps the last loaded tasks when a refresh fails", async () => {
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Fix iron in 305")).toBeTruthy());

    mockApiGet.mockRejectedValue(apiFailure(503));
    const scroll = screen.UNSAFE_getByType(ScrollView);
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });

    expect(screen.getByText("Fix iron in 305")).toBeTruthy();
    expect(screen.getByText("Couldn't refresh — showing your last loaded tasks.")).toBeTruthy();
  });

  it("warns when the server reports the list may be incomplete", async () => {
    serve({ mineMeta: { truncated: true } });
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("This list may be incomplete.")).toBeTruthy());
  });

  it("claims a pool task and shows the server's task", async () => {
    mockApiPost.mockResolvedValue({
      data: { ...available[0], status: "in_progress", assigned_to: "me" },
      meta: { replayed: false },
    });
    const { getByText, getByLabelText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Deep-clean fridge - 122")).toBeTruthy());
    fireEvent.press(getByLabelText("Claim & start"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/tasks/task-fridge/claim", {}));
    await waitFor(() => expect(queryByText("Up for grabs")).toBeNull());
  });

  it("creates tasks from plain language: reads the real copilot shape and posts an array", async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === "/ai/copilot/chat") {
        return Promise.resolve({
          data: {
            response_type: "task_preview",
            message: "I found 1 task to create.",
            tasks: [
              { title: "Bring crib to 412", task_type: "guest_request", priority: "high", room_id: "room-412", room_number_display: "412" },
            ],
          },
        });
      }
      if (path === "/ai/tasks/confirm") {
        return Promise.resolve({ data: { created_count: 1, tasks: [] }, meta: { deduplicated: 0 } });
      }
      return Promise.resolve({});
    });

    const { getByText, getByTestId, getByPlaceholderText, getByLabelText } = renderScreen();

    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText("Add a task in plain words…"), "guest in 412 needs a crib");
    fireEvent.press(getByLabelText("Create task with AI"));

    await waitFor(() => expect(getByTestId("ai-task-preview")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledWith(
      "/ai/copilot/chat",
      expect.objectContaining({
        message: "guest in 412 needs a crib",
        context: expect.objectContaining({ intent_hint: "task_creation" }),
      }),
    );
    expect(getByText("Bring crib to 412")).toBeTruthy();
    expect(getByText("Room 412")).toBeTruthy();

    fireEvent.press(getByText("Create"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/ai/tasks/confirm", [
        {
          title: "Bring crib to 412",
          task_type: "guest_request",
          priority: "urgent",
          room_id: "room-412",
          room_number_display: "412",
        },
      ]),
    );
    await waitFor(() => expect(getByText("Task created ✨")).toBeTruthy());
  });

  it("sends the create request once even when Create is tapped twice", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockImplementation((path: string) => {
      if (path === "/ai/copilot/chat") {
        return Promise.resolve({
          data: { response_type: "task_preview", message: "", tasks: [{ title: "Extra towels", task_type: "housekeeping", priority: "normal" }] },
        });
      }
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const { getByText, getByTestId, getByPlaceholderText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText("Add a task in plain words…"), "towels");
    fireEvent.press(getByLabelText("Create task with AI"));
    await waitFor(() => expect(getByTestId("ai-task-preview")).toBeTruthy());

    const createButton = getByLabelText("Create");
    fireEvent.press(createButton);
    fireEvent.press(createButton);

    expect(mockApiPost.mock.calls.filter((call) => call[0] === "/ai/tasks/confirm")).toHaveLength(1);
    await act(async () => {
      release({ data: { created_count: 1, tasks: [] }, meta: {} });
    });
  });

  it("tells the person when the server rejects an AI task instead of claiming success", async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === "/ai/copilot/chat") {
        return Promise.resolve({
          data: { response_type: "task_preview", message: "", tasks: [{ title: "Extra towels", task_type: "housekeeping", priority: "normal" }] },
        });
      }
      return Promise.reject(apiFailure(422));
    });
    const { getByText, queryByText, getByTestId, getByPlaceholderText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText("Add a task in plain words…"), "towels");
    fireEvent.press(getByLabelText("Create task with AI"));
    await waitFor(() => expect(getByTestId("ai-task-preview")).toBeTruthy());
    fireEvent.press(getByText("Create"));

    await waitFor(() => expect(getByText("That task couldn't be created.")).toBeTruthy());
    expect(queryByText("Task created ✨")).toBeNull();
    expect(getByTestId("ai-task-preview")).toBeTruthy();
  });
});
