import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

// Real EN/ES resources (i18next v3 plural keys), so a missing key or a wrong Spanish label fails here.
let mockLanguage: "en" | "es" = "en";
const mockDictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const lookup = (parts: string[]): unknown =>
    parts.reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], mockDictionaries[mockLanguage]);
  const plural = typeof values?.count === "number" && values.count !== 1 ? lookup(`${key}_plural`.split(".")) : undefined;
  const found = plural ?? lookup(key.split("."));
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

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args), get: (...args: unknown[]) => mockGet(...args) },
}));
jest.mock("@/lib/voice/speechModule", () => ({ speechModule: null, useSpeechRecognitionEvent: () => undefined }));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AddTaskSheet } from "@/components/tasks/AddTaskSheet";
import { clearDraft } from "@/lib/tasks/addTask/draftMemory";
import { clearRoomDirectoryCache } from "@/lib/tasks/addTask/rooms";

const HOTEL = "Chicago";
const ROOMS = [
  { id: "r405", room_number: "405", floor: 4, building: "A" },
  { id: "r406", room_number: "406", floor: 4, building: "A" },
];
const REQUEST = "Room 405 needs two towels, and the third-floor cart needs more shampoo.";
const TOWELS = {
  title: "Deliver two towels",
  description: "",
  task_type: "housekeeping",
  priority: "normal",
  room_id: "r405",
  room_number_display: "405",
  location_text: null,
  due_at: null,
  due_unresolved: false,
  confidence: 0.9,
};
const SHAMPOO = {
  title: "Restock shampoo",
  description: "",
  task_type: "housekeeping",
  priority: "normal",
  room_id: null,
  room_number_display: null,
  location_text: "Third-floor cart",
  due_at: null,
  due_unresolved: false,
  confidence: 0.9,
};

const failure = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
let stored = 0;
const row = (body: Record<string, unknown>) => ({
  id: `t-${(stored += 1)}`,
  title: body.title,
  task_type: "housekeeping",
  status: "open",
  priority: "normal",
  assigned_to: "me",
  room_id: body.room_id ?? null,
  location_text: body.location_text ?? null,
});

interface Setup {
  tasks?: unknown[];
  create?: (body: Record<string, unknown>) => Promise<unknown>;
}
function serve({ tasks = [TOWELS, SHAMPOO], create }: Setup = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/rooms/directory") return { data: ROOMS };
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    if (path === "/ai/copilot/chat") return { data: { response_type: "task_preview", message: "", tasks } };
    if (path === "/tasks") return create ? create(body) : { data: row(body), meta: { replayed: false } };
    throw new Error(`unexpected POST ${path}`);
  });
}
const posts = (path: string) => mockPost.mock.calls.filter((call) => call[0] === path);

function renderSheet(overrides: Partial<React.ComponentProps<typeof AddTaskSheet>> = {}) {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  const onBatchCreated = jest.fn();
  const onOpenTask = jest.fn();
  const props: React.ComponentProps<typeof AddTaskSheet> = {
    visible: true,
    isOnline: true,
    zone: "America/Chicago",
    language: mockLanguage,
    viewer: { id: "me", tenantId: HOTEL, role: "housekeeper" },
    onClose,
    onCreated,
    onBatchCreated,
    onOpenTask,
    ...overrides,
  };
  const utils = render(
    <ThemeProvider>
      <AddTaskSheet {...props} />
    </ThemeProvider>,
  );
  return { ...utils, onClose, onCreated, onBatchCreated, onOpenTask };
}
type Screen = ReturnType<typeof renderSheet>;

async function toBatch(screen: Screen, text = REQUEST) {
  fireEvent.changeText(screen.getByTestId("add-task-input"), text);
  fireEvent.press(screen.getByTestId("add-task-continue"));
  await waitFor(() => expect(screen.getByTestId("batch-found")).toBeTruthy());
}
async function pressCreate(screen: Screen) {
  await act(async () => {
    fireEvent.press(screen.getByTestId("batch-create"));
  });
}
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  stored = 0;
  clearDraft();
  clearRoomDirectoryCache();
  serve();
});

describe("Add Task — several suggested tasks", () => {
  it("lists every suggestion separately, keeps the original description, and has created nothing", async () => {
    const screen = renderSheet();
    await toBatch(screen);

    expect(screen.getByTestId("batch-found").props.children).toBe("Found 2 possible tasks");
    expect(screen.getByTestId("batch-title-0").props.children).toBe("Deliver two towels");
    expect(screen.getByTestId("batch-title-1").props.children).toBe("Restock shampoo");
    expect(screen.getByText("Where: Room 405")).toBeTruthy();
    expect(screen.getByText("Where: Third-floor cart")).toBeTruthy(); // a place, never promoted to a room
    expect(screen.getByTestId("batch-original").props.children).toContain("two towels");
    expect(screen.getByTestId("batch-create").props.accessibilityLabel ?? "Create 2 tasks").toContain("Create 2 tasks");
    expect(posts("/tasks")).toHaveLength(0);
    expect(posts("/ai/tasks/confirm")).toHaveLength(0);
    // One paid request for the description, however many tasks came back.
    expect(posts("/ai/copilot/chat")).toHaveLength(1);
  });

  it("creates each included task through the normal task request with its own idempotency key, then reports exactly what was stored", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    await pressCreate(screen);

    await waitFor(() => expect(screen.getByTestId("batch-created-summary")).toBeTruthy());
    const sent = posts("/tasks").map((call) => call[1] as Record<string, unknown>);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ title: "Deliver two towels", room_id: "r405", task_type: "housekeeping", assigned_to: "me", ai_suggested: true });
    expect(sent[1]).toMatchObject({ title: "Restock shampoo", location_text: "Third-floor cart" });
    expect(sent[0].client_request_id).not.toBe(sent[1].client_request_id);
    expect(screen.getByText("2 of 2 created")).toBeTruthy();
    expect(screen.getByTestId("batch-created-0").props.children).toBe("Created");
    expect(screen.getByTestId("batch-view-1")).toBeTruthy();

    // Nothing is announced to the Tasks screen until the person is done; then exactly the two stored tasks.
    expect(screen.onBatchCreated).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("batch-done"));
    expect(screen.onBatchCreated).toHaveBeenCalledTimes(1);
    expect(screen.onBatchCreated.mock.calls[0][0].map((created: { task: { id: string } }) => created.task.id)).toEqual(["t-1", "t-2"]);
    expect(screen.onClose).toHaveBeenCalled();
    expect(screen.onCreated).not.toHaveBeenCalled();
  });

  it("lets a task be left out: only the included ones are created", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    fireEvent.press(screen.getByTestId("batch-include-1"));
    expect(screen.getByTestId("batch-create").props.accessibilityLabel ?? "").toContain("Create 1 task");

    await pressCreate(screen);

    await waitFor(() => expect(posts("/tasks")).toHaveLength(1));
    expect(posts("/tasks")[0][1]).toMatchObject({ title: "Deliver two towels" });
  });

  it("opens a suggestion for editing in the ordinary task form and brings the changes back", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    fireEvent.press(screen.getByTestId("batch-edit-0"));
    await waitFor(() => expect(screen.getByTestId("review-title")).toBeTruthy());
    expect(screen.getByTestId("review-title").props.value).toBe("Deliver two towels");

    fireEvent.changeText(screen.getByTestId("review-title"), "Deliver three towels");
    fireEvent.press(screen.getByTestId("review-priority-low"));
    fireEvent.press(screen.getByTestId("batch-edit-save"));

    await waitFor(() => expect(screen.getByTestId("batch-title-0").props.children).toBe("Deliver three towels"));
    await pressCreate(screen);
    await waitFor(() => expect(posts("/tasks")).toHaveLength(2));
    expect(posts("/tasks")[0][1]).toMatchObject({ title: "Deliver three towels", priority: "low" });
    // The original description is still there for recovery.
    expect(screen.queryByTestId("batch-original")).toBeTruthy();
  });

  it("a room the hotel's directory does not contain can not be sent: it must be corrected first", async () => {
    serve({ tasks: [{ ...TOWELS, room_id: "r-elsewhere" }, SHAMPOO] });
    const screen = renderSheet();
    await toBatch(screen);

    await waitFor(() => expect(screen.getByText("Where: Room 405 (not verified)")).toBeTruthy());
    await pressCreate(screen);
    await waitFor(() => expect(screen.getByTestId("batch-problem-0")).toBeTruthy());
    expect(posts("/tasks")).toHaveLength(0);
    expect(screen.getByTestId("batch-summary")).toBeTruthy();

    // Excluding it makes the rest creatable.
    fireEvent.press(screen.getByTestId("batch-include-0"));
    await pressCreate(screen);
    await waitFor(() => expect(posts("/tasks")).toHaveLength(1));
    expect(posts("/tasks")[0][1]).toMatchObject({ title: "Restock shampoo" });
  });

  it("an urgent suggestion is not created until the person confirms the priority", async () => {
    serve({ tasks: [{ ...TOWELS, priority: "urgent" }, SHAMPOO] });
    const screen = renderSheet();
    await toBatch(screen);
    await pressCreate(screen);
    await waitFor(() => expect(screen.getByTestId("batch-problem-0")).toBeTruthy());
    expect(posts("/tasks")).toHaveLength(0);

    fireEvent.press(screen.getByTestId("batch-edit-0"));
    await waitFor(() => expect(screen.getByTestId("review-priority-urgent")).toBeTruthy());
    fireEvent.press(screen.getByTestId("review-priority-urgent"));
    fireEvent.press(screen.getByTestId("batch-edit-save"));
    await waitFor(() => expect(screen.getByTestId("batch-create")).toBeTruthy());
    await pressCreate(screen);
    await waitFor(() => expect(posts("/tasks")).toHaveLength(2));
    expect(posts("/tasks")[0][1]).toMatchObject({ priority: "urgent" });
  });

  it("when one task is refused the others are still created, nothing is called '2 created', and the retry sends only the failed one", async () => {
    let shampooAttempts = 0;
    serve({
      create: async (body) => {
        if (body.title === "Restock shampoo") {
          shampooAttempts += 1;
          if (shampooAttempts === 1) throw failure(422, "location not accepted");
        }
        return { data: row(body), meta: { replayed: false } };
      },
    });
    const screen = renderSheet();
    await toBatch(screen);
    await pressCreate(screen);

    await waitFor(() => expect(screen.getByTestId("batch-failed-1")).toBeTruthy());
    expect(screen.getByText("1 of 2 created")).toBeTruthy();
    expect(screen.queryByText("2 of 2 created")).toBeNull();
    expect(screen.getByTestId("batch-created-0")).toBeTruthy();
    expect(posts("/tasks")).toHaveLength(2);
    expect(screen.getByTestId("batch-create").props.accessibilityLabel ?? "").toContain("Retry 1 task");

    await pressCreate(screen);
    await waitFor(() => expect(screen.getByText("2 of 2 created")).toBeTruthy());
    expect(posts("/tasks")).toHaveLength(3); // the first task was NOT sent again
    expect(posts("/tasks")[2][1]).toMatchObject({ title: "Restock shampoo" });

    fireEvent.press(screen.getByTestId("batch-done"));
    expect(screen.onBatchCreated).toHaveBeenCalledTimes(1);
    expect(screen.onBatchCreated.mock.calls[0][0]).toHaveLength(2);
  });

  it("when the server stops answering, it stops, keeps the key, and the retry cannot make a duplicate", async () => {
    let calls = 0;
    serve({
      create: async (body) => {
        calls += 1;
        if (calls === 2) throw new Error("Request timed out. Please try again.");
        return { data: row(body), meta: { replayed: false } };
      },
    });
    const screen = renderSheet({ tasks: undefined } as never);
    await toBatch(screen);
    await pressCreate(screen);

    await waitFor(() => expect(screen.getByTestId("batch-halted")).toBeTruthy());
    expect(screen.getByTestId("batch-failed-1").props.children).toContain("couldn't confirm");
    const firstKey = (posts("/tasks")[1][1] as Record<string, unknown>).client_request_id;

    await pressCreate(screen);
    await waitFor(() => expect(posts("/tasks")).toHaveLength(3));
    expect((posts("/tasks")[2][1] as Record<string, unknown>).client_request_id).toBe(firstKey);
    expect(posts("/tasks")[2][1]).toMatchObject({ title: "Restock shampoo" });
  });

  it("ignores a second tap while creation is running", async () => {
    let release: (value: unknown) => void = () => undefined;
    serve({ create: (body) => new Promise((resolve) => (release = () => resolve({ data: row(body), meta: { replayed: false } }))) });
    const screen = renderSheet();
    await toBatch(screen);

    await act(async () => {
      fireEvent.press(screen.getByTestId("batch-create"));
      fireEvent.press(screen.getByTestId("batch-create"));
    });
    expect(posts("/tasks")).toHaveLength(1); // the first request is still in flight; the second tap did nothing

    await act(async () => {
      release(null);
    });
    await act(async () => {
      release(null);
    });
    await waitFor(() => expect(screen.getByText("2 of 2 created")).toBeTruthy());
    expect(posts("/tasks")).toHaveLength(2);
  });

  it("asks before throwing away unsent suggestions, and keeps already-created tasks out of that question", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    fireEvent.press(screen.getAllByLabelText("Close").slice(-1)[0]);
    await waitFor(() => expect(screen.getByTestId("discard-confirm")).toBeTruthy());
    expect(screen.getByText("Leave these tasks?")).toBeTruthy();
    expect(screen.onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("discard-keep"));
    expect(screen.getByTestId("batch-found")).toBeTruthy();
  });

  it("returns to the description without asking the (paid) parser again for the same words", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    fireEvent.press(screen.getByTestId("batch-back"));
    await waitFor(() => expect(screen.getByTestId("add-task-input")).toBeTruthy());
    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);

    fireEvent.press(screen.getByTestId("add-task-continue"));
    await waitFor(() => expect(screen.getByTestId("batch-found")).toBeTruthy());
    expect(posts("/ai/copilot/chat")).toHaveLength(1);
  });

  it("once a task exists the person can not go back and re-parse (which could create it twice)", async () => {
    let calls = 0;
    serve({
      create: async (body) => {
        calls += 1;
        if (calls === 2) throw failure(422);
        return { data: row(body), meta: { replayed: false } };
      },
    });
    const screen = renderSheet();
    await toBatch(screen);
    await pressCreate(screen);
    await waitFor(() => expect(screen.getByTestId("batch-failed-1")).toBeTruthy());

    expect(screen.queryByTestId("batch-back")).toBeNull();
    expect(screen.getByTestId("batch-finish")).toBeTruthy();
  });

  it("keeps working offline: nothing is sent, and the cards say so", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    screen.rerender(
      <ThemeProvider>
        <AddTaskSheet
          visible
          isOnline={false}
          zone="America/Chicago"
          language="en"
          viewer={{ id: "me", tenantId: HOTEL, role: "housekeeper" }}
          onClose={screen.onClose}
          onCreated={screen.onCreated}
          onBatchCreated={screen.onBatchCreated}
        />
      </ThemeProvider>,
    );
    await pressCreate(screen);
    await waitFor(() => expect(screen.getByTestId("batch-halted")).toBeTruthy());
    expect(posts("/tasks")).toHaveLength(0);
    expect(screen.getByTestId("batch-failed-0").props.children).toContain("offline");
  });

  it("View task closes the sheet and hands the stored task to the screen", async () => {
    const screen = renderSheet();
    await toBatch(screen);
    await pressCreate(screen);
    await waitFor(() => expect(screen.getByTestId("batch-view-0")).toBeTruthy());

    fireEvent.press(screen.getByTestId("batch-view-0"));

    expect(screen.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t-1" }));
    expect(screen.onClose).toHaveBeenCalled();
    expect(screen.onBatchCreated).toHaveBeenCalledTimes(1);
  });

  it("reads in Spanish", async () => {
    mockLanguage = "es";
    const screen = renderSheet();
    await toBatch(screen);
    expect(screen.getByTestId("batch-found").props.children).toBe("Se encontraron 2 posibles tareas");
    expect(screen.getByText("Tarea 1")).toBeTruthy();
    expect(screen.getByText("Tarea 2")).toBeTruthy();
    expect(screen.getAllByText("Incluir")).toHaveLength(2);
  });

  it("a single task still uses the ordinary review form, untouched", async () => {
    serve({ tasks: [TOWELS] });
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), "Room 405 needs two towels");
    fireEvent.press(screen.getByTestId("add-task-continue"));
    await waitFor(() => expect(screen.getByTestId("review-create")).toBeTruthy());
    expect(screen.queryByTestId("batch-found")).toBeNull();
    expect(isDisabled(screen.getByTestId("review-create"))).toBe(false);
  });
});
