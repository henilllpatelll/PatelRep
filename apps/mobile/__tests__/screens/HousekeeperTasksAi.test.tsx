import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

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
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
    useLocalSearchParams: () => ({}),
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

// The assistant exists on this screen only when the test says so.
const mockAssistant = { openAssistant: jest.fn(), conversation: { showLocal: jest.fn() } };
let mockAssistantAvailable = true;
jest.mock("@/lib/ai/AssistantProvider", () => ({ useAssistantOptional: () => (mockAssistantAvailable ? mockAssistant : null) }));

// Controllable speech engine for the microphone on the quick card.
const mockSpeech: { module: null | Record<string, jest.Mock>; available: boolean } = { module: null, available: false };
jest.mock("@/lib/voice/speechModule", () => ({
  get speechModule() {
    return mockSpeech.module;
  },
  isSpeechAvailable: () => mockSpeech.available,
  useSpeechRecognitionEvent: () => undefined,
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { clearDraft } from "@/lib/tasks/addTask/draftMemory";
import { clearRoomDirectoryCache } from "@/lib/tasks/addTask/rooms";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import TasksRoute from "@/app/(app)/tasks";

const NOW = Date.now();
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, status: "open", task_type: "housekeeping", priority: "normal", assigned_to: "me", created_by: "boss", created_at: at(-600), due_at: at(240), rooms: null, ...extra };
}
const MINE = [
  row("towels", {
    title: "Deliver extra towels",
    description: "Deliver two clean bath towels.",
    room_id: "r405",
    rooms: { room_number: "405", floor: 4 },
  }),
  row("bare", { title: "Bare task", due_at: null, description: null }),
];
const POOL = [row("pillow", { title: "Extra pillow delivery", assigned_to: null, created_by: "boss", rooms: { room_number: "218", floor: 2 } })];

function serve() {
  const all = [...MINE, ...POOL];
  mockApiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/tasks/mine/completed")) return { data: [], meta: { has_more: false } };
    if (path.startsWith("/tasks/mine")) return { data: MINE, meta: { has_more: false } };
    if (path.startsWith("/tasks/available")) return { data: POOL, meta: { has_more: false } };
    if (path === "/rooms/directory") return { data: [] };
    const activity = /^\/tasks\/([^/]+)\/activity$/.exec(path);
    if (activity) return { data: { task: all.find((candidate) => candidate.id === activity[1]), events: [] }, meta: { truncated: false } };
    throw new Error(`unexpected GET ${path}`);
  });
  mockApiPost.mockImplementation(async () => {
    throw new Error("nothing on this screen should post");
  });
}

async function ready() {
  const screen = render(
    <ThemeProvider>
      <TasksRoute />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByText("Deliver extra towels")).toBeTruthy());
  return screen;
}
const openCard = async (screen: Awaited<ReturnType<typeof ready>>, title: string) => {
  const later = screen.queryByLabelText("Show later tasks");
  if (later && !screen.queryByLabelText(`Show details for ${title}`)) fireEvent.press(later);
  fireEvent.press(screen.getByLabelText(`Show details for ${title}`));
  await waitFor(() => expect(screen.getByText("Task details")).toBeTruthy());
};
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;

beforeEach(async () => {
  await AsyncStorage.clear();
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} });
  clearDraft();
  clearRoomDirectoryCache();
  jest.clearAllMocks();
  mockLanguage = "en";
  mockOnline = true;
  mockAssistantAvailable = true;
  mockSpeech.module = null;
  mockSpeech.available = false;
  serve();
});

describe("Tasks — quick task creation", () => {
  it("offers one clear AI-assisted way in, next to the manual Add button, and the list is untouched", async () => {
    const screen = await ready();

    expect(screen.getByText("Quick task creation")).toBeTruthy();
    expect(screen.getByTestId("quick-task-describe")).toBeTruthy();
    expect(screen.getByTestId("add-task-button")).toBeTruthy(); // manual Add Task is still there
    expect(screen.getByText("Deliver extra towels")).toBeTruthy();
    expect(screen.getByLabelText("My Work, 2 tasks")).toBeTruthy(); // same counts, same lists
    expect(mockApiPost).not.toHaveBeenCalled(); // showing it costs nothing and asks nothing
  });

  it("opens the SAME Add Task sheet on the description step (no second task form)", async () => {
    const screen = await ready();
    fireEvent.press(screen.getByTestId("quick-task-describe"));

    await waitFor(() => expect(screen.getByTestId("add-task-sheet")).toBeTruthy());
    expect(screen.getByTestId("add-task-input")).toBeTruthy();
    expect(screen.getByTestId("add-task-manual")).toBeTruthy(); // Enter manually is one tap away
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("is only on My Work, not on the Available list", async () => {
    const screen = await ready();
    fireEvent.press(screen.getByTestId("segment-available"));
    await waitFor(() => expect(screen.getByText("Extra pillow delivery")).toBeTruthy());
    expect(screen.queryByTestId("quick-task-card")).toBeNull();
  });

  it("has a microphone only where this phone can listen, and it opens the sheet already listening", async () => {
    const plain = await ready();
    expect(plain.queryByTestId("quick-task-voice")).toBeNull();
    plain.unmount();

    mockSpeech.available = true;
    mockSpeech.module = {
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      isRecognitionAvailable: jest.fn().mockReturnValue(true),
    };
    const screen = await ready();
    await act(async () => {
      fireEvent.press(screen.getByTestId("quick-task-voice"));
    });

    await waitFor(() => expect(mockSpeech.module?.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "en-US" })));
    expect(screen.getByTestId("add-task-sheet")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled(); // listening creates and sends nothing
  });

  it("says why it is unavailable offline", async () => {
    const screen = await ready();
    mockOnline = false;
    screen.rerender(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("quick-task-offline")).toBeTruthy());
    expect(isDisabled(screen.getByTestId("quick-task-describe"))).toBe(true);
  });

  it("reads in Spanish", async () => {
    mockLanguage = "es";
    const screen = render(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Creación rápida de tareas")).toBeTruthy());
    expect(screen.getByText("Describir una tarea")).toBeTruthy();
  });
});

describe("Task details — Need help?", () => {
  it("explains the task from its own stored details, with no request and nothing changed", async () => {
    const screen = await ready();
    await openCard(screen, "Deliver extra towels");
    const sheet = within(screen.getByTestId("task-detail-sheet"));
    expect(sheet.getByText("Need help?")).toBeTruthy();
    expect(sheet.queryByTestId("task-help-explanation")).toBeNull(); // nothing is generated until asked

    fireEvent.press(sheet.getByTestId("task-help-explain"));

    const explanation = within(screen.getByTestId("task-help-explanation"));
    expect(explanation.getByText("This is a Housekeeping task: Deliver extra towels.")).toBeTruthy();
    expect(explanation.getByText("It is for Room 405.")).toBeTruthy();
    expect(explanation.getByText("It is assigned to you and not started yet.")).toBeTruthy();
    expect(explanation.getByText("Instructions on the task: “Deliver two clean bath towels.”")).toBeTruthy();
    expect(explanation.getByText("Based only on this task's details. Nothing has been added or changed.")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled(); // no AI call, no status change
    expect(screen.getByTestId("detail-start")).toBeTruthy(); // the lifecycle is exactly as before
  });

  it("says plainly when the task has no instructions instead of inventing some", async () => {
    const screen = await ready();
    await openCard(screen, "Bare task");
    fireEvent.press(screen.getByTestId("task-help-explain"));
    const explanation = within(screen.getByTestId("task-help-explanation"));
    expect(explanation.getByText(/No extra instructions were written for this task/)).toBeTruthy();
    expect(explanation.getByText("No due time is set.")).toBeTruthy();
  });

  it("hides the explanation again", async () => {
    const screen = await ready();
    await openCard(screen, "Bare task");
    fireEvent.press(screen.getByTestId("task-help-explain"));
    expect(screen.getByTestId("task-help-explanation")).toBeTruthy();
    fireEvent.press(screen.getByTestId("task-help-explain"));
    expect(screen.queryByTestId("task-help-explanation")).toBeNull();
  });

  it("opens the assistant about THIS task and starts it with the same plain reading", async () => {
    const screen = await ready();
    await openCard(screen, "Deliver extra towels");

    fireEvent.press(screen.getByTestId("task-help-ask"));

    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "task", entityId: "towels", label: "Deliver extra towels" });
    expect(mockAssistant.conversation.showLocal).toHaveBeenCalledTimes(1);
    const [question, answer, card] = mockAssistant.conversation.showLocal.mock.calls[0];
    expect(question).toBe("Explain this task");
    expect(answer).toContain("It is for Room 405.");
    expect(answer).toContain("Deliver two clean bath towels.");
    expect(card).toEqual({ type: "taskAnswer", taskId: "towels" });
    // The task sheet closes so two sheets never stack.
    await waitFor(() => expect(screen.queryByText("Task details")).toBeNull());
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("does not offer 'Ask Assistant' for a task the server would not accept as context, or without an assistant", async () => {
    const pool = await ready();
    fireEvent.press(pool.getByTestId("segment-available"));
    fireEvent.press(await pool.findByLabelText("Show details for Extra pillow delivery"));
    await waitFor(() => expect(pool.getByTestId("task-help-explain")).toBeTruthy()); // Explain is still fine
    expect(pool.queryByTestId("task-help-ask")).toBeNull();
    pool.unmount();

    mockAssistantAvailable = false;
    const screen = await ready();
    await openCard(screen, "Deliver extra towels");
    expect(screen.getByTestId("task-help-explain")).toBeTruthy();
    expect(screen.queryByTestId("task-help-ask")).toBeNull();
  });

  it("offline, Explain still works and Ask Assistant says it needs a connection", async () => {
    const screen = await ready();
    await openCard(screen, "Deliver extra towels");
    mockOnline = false;
    screen.rerender(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(isDisabled(screen.getByTestId("task-help-ask"))).toBe(true));
    expect(screen.getByText("The assistant needs a connection.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("task-help-explain"));
    expect(screen.getByTestId("task-help-explanation")).toBeTruthy();
  });

  it("reads in Spanish", async () => {
    mockLanguage = "es";
    const screen = render(
      <ThemeProvider>
        <TasksRoute />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Deliver extra towels")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Mostrar detalles de Deliver extra towels"));
    await waitFor(() => expect(screen.getByTestId("task-help-explain")).toBeTruthy());
    fireEvent.press(screen.getByTestId("task-help-explain"));
    expect(screen.getByText("Es para la habitación 405.")).toBeTruthy();
  });
});
