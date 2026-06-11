import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

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
  "tasks.guestTag": "Guest",
  "tasks.dueAt": "Due {{time}}",
  "tasks.overdueBy": "{{minutes}}m overdue",
  "tasks.addPlaceholder": "Add a task in plain words…",
  "tasks.addWithAI": "Create task with AI",
  "tasks.aiPreviewLabel": "AI drafted this task",
  "tasks.aiCreated": "Task created ✨",
  "tasks.aiUnavailable": "AI is unavailable right now — try again in a moment.",
  "tasks.aiNoTask": "I couldn't turn that into a task.",
  "tasks.newTag": "New",
  "tasks.typeLabel.housekeeping": "Housekeeping",
  "tasks.typeLabel.guest_request": "Guest request",
  "tasks.typeLabel.general": "General",
  "tasks.detailType": "Type",
  "tasks.detailCreated": "Created",
  "tasks.detailDue": "Due",
  "tasks.detailSla": "SLA",
  "tasks.statusInProgress": "IN PROGRESS",
  "tasks.statusEscalated": "ESCALATED",
  "tasks.emptyTitle": "No tasks assigned",
  "tasks.emptyAiHint": "Type below to create one with AI.",
  "ai.briefing.sourceLocal": "Planned on device",
  "common.cancel": "Cancel",
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

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: true }),
}));

import TasksScreen from "@/app/(app)/tasks";

const NOW = Date.now();

const mockTasks = [
  {
    id: "task-iron",
    title: "Fix iron in 305",
    priority: "normal",
    task_type: "housekeeping",
    due_at: new Date(NOW - 30 * 60000).toISOString(),
    rooms: { room_number: "305" },
  },
  {
    id: "task-cart",
    title: "Restock cart - floor 2",
    priority: "urgent",
    task_type: "housekeeping",
  },
  {
    id: "task-towels",
    title: "Deliver 2 extra towels to 214",
    description: "Guest called front desk, prefers bath sheets",
    priority: "normal",
    source: "guest",
    is_ai_created: true,
    rooms: { room_number: "214" },
  },
  {
    id: "task-fridge",
    title: "Deep-clean fridge - 122",
    priority: "low",
    rooms: { room_number: "122" },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({ data: mockTasks });
  mockApiPatch.mockResolvedValue({});
});

describe("TasksScreen", () => {
  it("renders the AI briefing and smart-order buckets", async () => {
    const { getByText } = render(<TasksScreen />);

    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    expect(mockApiGet).toHaveBeenCalledWith("/tasks?per_page=100");
    expect(getByText("AI Task Briefing")).toBeTruthy();
    expect(getByText("1 task(s) overdue — start with “Fix iron in 305”.")).toBeTruthy();
    expect(getByText(/guest-facing task/)).toBeTruthy();

    expect(getByText("OVERDUE")).toBeTruthy();
    expect(getByText("DO NOW")).toBeTruthy();
    expect(getByText("TODAY")).toBeTruthy();
    expect(getByText("Fix iron in 305")).toBeTruthy();
    expect(getByText("Restock cart - floor 2")).toBeTruthy();
    expect(getByText("Deliver 2 extra towels to 214")).toBeTruthy();
    expect(getByText("Guest called front desk, prefers bath sheets")).toBeTruthy();
    expect(getByText("Deep-clean fridge - 122")).toBeTruthy();
    expect(getByText(/30m overdue|3[01]m overdue/)).toBeTruthy();
  });

  it("requires a confirmation before completing a task", async () => {
    const { getByText, getByLabelText, queryByText } = render(<TasksScreen />);

    await waitFor(() => expect(getByText("Restock cart - floor 2")).toBeTruthy());

    expect(queryByText("Mark this task done?")).toBeNull();
    fireEvent.press(getByLabelText("Mark Restock cart - floor 2 done"));
    expect(getByText("Mark this task done?")).toBeTruthy();
    expect(mockApiPatch).not.toHaveBeenCalled();

    fireEvent.press(getByText("Done"));

    await waitFor(() =>
      expect(mockApiPatch).toHaveBeenCalledWith(
        "/tasks/task-cart",
        expect.objectContaining({ status: "completed" }),
      ),
    );
    await waitFor(() => expect(queryByText("Restock cart - floor 2")).toBeNull());
    expect(getByText("1 done today")).toBeTruthy();
  });

  it("creates a task from plain language through the AI composer", async () => {
    mockApiPost.mockImplementation((path: string) => {
      if (path === "/ai/copilot/chat") {
        return Promise.resolve({
          message: "Here's the task I drafted.",
          intent: "task_creation",
          task_preview: { title: "Bring crib to 412", task_type: "guest_request", priority: "high", room_number: "412" },
        });
      }
      return Promise.resolve({});
    });

    const { getByText, getByTestId, getByPlaceholderText, getByLabelText } = render(<TasksScreen />);

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

    // After creation the refreshed list contains the new task — it shows up highlighted
    mockApiGet.mockResolvedValue({
      data: [
        ...mockTasks,
        { id: "task-crib", title: "Bring crib to 412", priority: "high", task_type: "guest_request", rooms: { room_number: "412" } },
      ],
    });

    fireEvent.press(getByText("Create"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/ai/tasks/confirm",
        [expect.objectContaining({ title: "Bring crib to 412", room_number_display: "412" })],
      ),
    );
    await waitFor(() => expect(getByText("Task created ✨")).toBeTruthy());
    await waitFor(() => expect(getByText("Bring crib to 412")).toBeTruthy());
    expect(getByText("New")).toBeTruthy();
  });
});
