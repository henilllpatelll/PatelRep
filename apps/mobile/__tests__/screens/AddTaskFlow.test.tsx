import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

// Real EN/ES resources, so a missing key or a wrong Spanish label fails here.
let mockLanguage: "en" | "es" = "en";
const mockDictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const lookup = (node: unknown, parts: string[]): unknown =>
    parts.reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], node);
  const dictionary = mockDictionaries[mockLanguage];
  let found = lookup(dictionary, key.split("."));
  if (found === undefined && typeof values?.count === "number") {
    found = lookup(dictionary, [...key.split(".").slice(0, -1), `${key.split(".").pop()}_${values.count === 1 ? "one" : "other"}`]);
  }
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

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args), get: (...args: unknown[]) => mockGet(...args) },
}));

// Controllable speech recognition (the real module is native).
const mockSpeech: { module: null | Record<string, jest.Mock> } = { module: null };
const mockSpeechHandlers: Record<string, Array<(event: unknown) => void>> = {};
jest.mock("@/lib/voice/speechModule", () => ({
  get speechModule() {
    return mockSpeech.module;
  },
  useSpeechRecognitionEvent: (event: string, handler: (e: unknown) => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      (mockSpeechHandlers[event] ||= []).push(handler);
      return () => {
        mockSpeechHandlers[event] = (mockSpeechHandlers[event] || []).filter((h) => h !== handler);
      };
    }, [event, handler]);
  },
}));
const speak = (event: string, payload: unknown = {}) =>
  act(() => {
    (mockSpeechHandlers[event] || []).forEach((handler) => handler(payload));
  });

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AddTaskSheet } from "@/components/tasks/AddTaskSheet";
import { clearDraft } from "@/lib/tasks/addTask/draftMemory";
import { clearRoomDirectoryCache } from "@/lib/tasks/addTask/rooms";

const HOTEL = "Chicago";
const ROOMS = [
  { id: "r214", room_number: "214", floor: 2, building: "A" },
  { id: "r318", room_number: "318", floor: 3, building: "A" },
  { id: "r412", room_number: "412", floor: 4, building: "B" },
];
const PILLOWS = {
  title: "Deliver two extra pillows",
  description: "Two extra pillows for the guest.",
  task_type: "housekeeping",
  priority: "normal",
  room_id: "r318",
  room_number_display: "318",
  due_at: null,
  due_unresolved: false,
  confidence: 0.92,
};
const REQUEST = "Room 318 needs two extra pillows delivered before 2 PM.";

const failure = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
const stored = (over: Record<string, unknown> = {}) => ({
  id: "t-new",
  title: "Deliver two extra pillows",
  task_type: "housekeeping",
  status: "open",
  priority: "normal",
  assigned_to: "me",
  room_id: "r318",
  rooms: { room_number: "318", floor: 3 },
  ...over,
});

interface Setup {
  parse?: unknown | (() => Promise<unknown>);
  create?: (body: Record<string, unknown>) => Promise<unknown>;
  rooms?: unknown;
}
function serve({ parse, create, rooms }: Setup = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/rooms/directory") {
      if (rooms instanceof Error) throw rooms;
      return { data: rooms ?? ROOMS };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    if (path === "/ai/copilot/chat") {
      if (typeof parse === "function") return parse();
      return parse ?? { data: { response_type: "task_preview", message: "", tasks: [PILLOWS] } };
    }
    if (path === "/tasks") return create ? create(body) : { data: stored(), meta: { replayed: false } };
    throw new Error(`unexpected POST ${path}`);
  });
}

const posts = (path: string) => mockPost.mock.calls.filter((call) => call[0] === path);

function renderSheet(overrides: Partial<React.ComponentProps<typeof AddTaskSheet>> = {}) {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  const props: React.ComponentProps<typeof AddTaskSheet> = {
    visible: true,
    isOnline: true,
    zone: "America/Chicago",
    language: mockLanguage,
    viewer: { id: "me", tenantId: HOTEL, role: "housekeeper" },
    onClose,
    onCreated,
    ...overrides,
  };
  const tree = (p: typeof props) => (
    <ThemeProvider>
      <AddTaskSheet {...p} />
    </ThemeProvider>
  );
  const utils = render(tree(props));
  return { ...utils, onClose, onCreated, rerenderWith: (next: Partial<typeof props>) => utils.rerender(tree({ ...props, ...next })) };
}

const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;

type Screen = ReturnType<typeof renderSheet>;
async function describeAndContinue(screen: Screen, text = REQUEST) {
  fireEvent.changeText(screen.getByTestId("add-task-input"), text);
  fireEvent.press(screen.getByTestId("add-task-continue"));
  await waitFor(() => expect(screen.getByTestId("review-create")).toBeTruthy());
}
async function goManual(screen: Screen) {
  fireEvent.press(screen.getByTestId("add-task-manual"));
  await waitFor(() => expect(screen.getByTestId("review-create")).toBeTruthy());
}
async function pressCreate(screen: Screen) {
  await act(async () => {
    fireEvent.press(screen.getByTestId("review-create"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockSpeech.module = null;
  Object.keys(mockSpeechHandlers).forEach((key) => delete mockSpeechHandlers[key]);
  clearDraft();
  clearRoomDirectoryCache();
  serve();
});

describe("Add Task — Describe step", () => {
  it("opens as a focused sheet that has created nothing", () => {
    const { getByTestId, getByText, getByPlaceholderText } = renderSheet();

    expect(getByTestId("add-task-sheet")).toBeTruthy();
    expect(getByText("What needs to be done?")).toBeTruthy();
    expect(getByText("Describe the request in your own words.")).toBeTruthy();
    expect(getByText("Smart task creation")).toBeTruthy();
    expect(getByPlaceholderText(REQUEST)).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("starts with the words the assistant handed over, so what was typed is not lost", () => {
    const { getByTestId } = renderSheet({ initialText: "  Fix the squeaky cart wheel  " });

    expect(getByTestId("add-task-input").props.value).toBe("Fix the squeaky cart wheel");
    // Handing text over creates and sends nothing.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("continues an earlier draft rather than overwriting it with handed-over text", () => {
    const first = renderSheet();
    fireEvent.changeText(first.getByTestId("add-task-input"), "Earlier unfinished request");
    first.unmount();

    const { getByTestId } = renderSheet({ initialText: "Something from the assistant" });
    expect(getByTestId("add-task-input").props.value).toBe("Earlier unfinished request");
  });

  it("does not continue on empty or blank input", () => {
    const { getByTestId } = renderSheet();

    expect(isDisabled(getByTestId("add-task-continue"))).toBe(true);
    fireEvent.press(getByTestId("add-task-continue"));
    fireEvent.changeText(getByTestId("add-task-input"), "   \n  ");
    fireEvent.press(getByTestId("add-task-continue"));

    expect(isDisabled(getByTestId("add-task-continue"))).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("the example placeholder is never submitted, and Return never sends", () => {
    const { getByTestId } = renderSheet();
    const input = getByTestId("add-task-input");

    fireEvent(input, "submitEditing");
    fireEvent(input, "endEditing");

    expect(mockPost).not.toHaveBeenCalled();
    expect(input.props.multiline).toBe(true);
    expect(input.props.maxLength).toBe(2000);
  });

  it("keeps a multiline description exactly as typed", () => {
    const { getByTestId } = renderSheet();
    const text = "Room 318 needs pillows.\nAlso a crib in 412 — gracias.";

    fireEvent.changeText(getByTestId("add-task-input"), text);

    expect(getByTestId("add-task-input").props.value).toBe(text);
  });

  it("offline: says so and does not try the AI", () => {
    const { getByTestId } = renderSheet({ isOnline: false });

    fireEvent.changeText(getByTestId("add-task-input"), "pillows");

    expect(getByTestId("add-task-offline")).toBeTruthy();
    expect(isDisabled(getByTestId("add-task-continue"))).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe("Add Task — AI suggestions", () => {
  it("shows the suggested details for review, and creates nothing on its own", async () => {
    const screen = renderSheet();

    await describeAndContinue(screen);

    expect(screen.getByText("Review new task")).toBeTruthy();
    expect(screen.getByTestId("review-title").props.value).toBe("Deliver two extra pillows");
    expect(screen.getByLabelText(/Location: Room 318/)).toBeTruthy();
    expect(posts("/ai/copilot/chat")).toHaveLength(1);
    expect(posts("/tasks")).toHaveLength(0);
    expect(posts("/ai/tasks/confirm")).toHaveLength(0);
    expect(screen.onCreated).not.toHaveBeenCalled();
  });

  it("lets the person correct the title before creating", async () => {
    const screen = renderSheet();
    await describeAndContinue(screen);

    fireEvent.changeText(screen.getByTestId("review-title"), "Two firm pillows to 318");
    await pressCreate(screen);

    expect(posts("/tasks")[0][1]).toMatchObject({ title: "Two firm pillows to 318", room_id: "r318", ai_suggested: true });
  });

  it("a room that could not be verified must be corrected from the hotel's own list", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, room_id: null, room_number_display: "999" }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    expect(screen.getByLabelText(/Room 999 \(not verified\)/)).toBeTruthy();
    expect(screen.getByTestId("review-location-error").props.children).toMatch(/couldn't be verified/);
    await pressCreate(screen);
    expect(posts("/tasks")).toHaveLength(0); // blocked, inline — no popup, no request

    fireEvent.press(screen.getByTestId("review-location"));
    expect(screen.getByTestId("room-search").props.value).toBe("999");
    await waitFor(() => expect(screen.getByTestId("room-empty")).toBeTruthy()); // no such room in this hotel
    fireEvent.changeText(screen.getByTestId("room-search"), "318");
    fireEvent.press(screen.getByTestId("room-option-318"));
    await pressCreate(screen);

    expect(posts("/tasks")[0][1]).toMatchObject({ room_id: "r318" });
    expect(posts("/tasks")[0][1]).not.toHaveProperty("location_text");
  });

  it("only rooms from the hotel directory can be chosen", async () => {
    serve({ rooms: [{ id: "r1", room_number: "101", floor: 1, building: null }] });
    const screen = renderSheet();
    await goManual(screen);

    fireEvent.press(screen.getByTestId("review-location"));
    await waitFor(() => expect(screen.getByTestId("room-option-101")).toBeTruthy());

    expect(screen.queryByTestId("room-option-318")).toBeNull();
    expect(mockGet).toHaveBeenCalledWith("/rooms/directory");
  });

  it("a general location is sent as text, never as a room", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Wipe the pool deck tables");
    fireEvent.press(screen.getByTestId("review-type-general"));

    fireEvent.press(screen.getByTestId("review-location"));
    fireEvent.press(screen.getByTestId("location-tab-place"));
    fireEvent.changeText(screen.getByTestId("place-input"), "Pool deck");
    fireEvent.press(screen.getByTestId("place-use"));
    await pressCreate(screen);

    expect(posts("/tasks")[0][1]).toMatchObject({ location_text: "Pool deck", task_type: "general" });
    expect(posts("/tasks")[0][1]).not.toHaveProperty("room_id");
  });

  it("an urgent suggestion must be confirmed before it can be created", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, priority: "urgent" }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    await pressCreate(screen);
    expect(screen.getByTestId("review-priority-error")).toBeTruthy();
    expect(posts("/tasks")).toHaveLength(0);

    fireEvent.press(screen.getByTestId("review-priority-urgent"));
    await pressCreate(screen);
    expect(posts("/tasks")[0][1]).toMatchObject({ priority: "urgent" });
  });

  it("an ambiguous due time stays flagged until it is set or removed", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, due_at: null, due_unresolved: true }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    expect(screen.getByTestId("review-due-error")).toBeTruthy();
    await pressCreate(screen);
    expect(posts("/tasks")).toHaveLength(0);

    fireEvent.press(screen.getByTestId("review-due"));
    fireEvent.press(screen.getByTestId("due-none"));
    fireEvent.press(screen.getByTestId("due-done"));
    await pressCreate(screen);
    expect(posts("/tasks")).toHaveLength(1);
    expect(posts("/tasks")[0][1]).not.toHaveProperty("due_at");
  });

  it("an unsupported category is left for the person to choose", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, task_type: "lost_found" }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    expect(screen.getByTestId("review-type-error")).toBeTruthy();
    fireEvent.press(screen.getByTestId("review-type-housekeeping"));
    await pressCreate(screen);
    expect(posts("/tasks")[0][1]).toMatchObject({ task_type: "housekeeping" });
  });

  it("explains when more than one task was found", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [PILLOWS, { ...PILLOWS, title: "B" }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    expect(screen.getByTestId("review-extra-tasks").props.children).toMatch(/1 more task/);
  });

  it("asks for a second look when the AI was not confident", async () => {
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, confidence: 0.3 }] } } });
    const screen = renderSheet();
    await describeAndContinue(screen);

    expect(screen.getByTestId("review-low-confidence")).toBeTruthy();
  });
});

describe("Add Task — when the AI can not help", () => {
  it.each([
    ["times out", () => Promise.reject(new Error("Request timed out. Please try again.")), /took too long/],
    ["is rate limited", () => Promise.reject(failure(429)), /Too many requests/],
    ["is unavailable", () => Promise.reject(failure(503)), /aren't available/],
    ["returns an invalid reply", () => Promise.resolve({ data: { response_type: "task_preview", tasks: "nope" } }), /couldn't make sense/],
  ])("%s: keeps the text and offers to continue manually", async (_name, parse, message) => {
    serve({ parse });
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);
    fireEvent.press(screen.getByTestId("add-task-continue"));

    await waitFor(() => expect(screen.getByTestId("add-task-failure")).toBeTruthy());
    expect(screen.getByTestId("add-task-failure").props.children).toMatch(message);
    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);
    expect(screen.getByText("Continue manually")).toBeTruthy();

    fireEvent.press(screen.getByTestId("add-task-manual"));
    await waitFor(() => expect(screen.getByTestId("review-create")).toBeTruthy());
    // The request text became the title of the manual form; the type has a sensible default.
    expect(screen.getByTestId("review-title").props.value).toBe(REQUEST);
    expect(screen.getByText("New task")).toBeTruthy();
    expect(posts("/tasks")).toHaveLength(0);
  });

  it("says when no task was found in the text, and still allows the manual form", async () => {
    serve({ parse: { data: { response_type: "text", message: "Hello!" } } });
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), "hi there");
    fireEvent.press(screen.getByTestId("add-task-continue"));

    await waitFor(() => expect(screen.getByTestId("add-task-none")).toBeTruthy());
    expect(screen.getByText("Continue manually")).toBeTruthy();
  });

  it("a long request becomes the description, not an over-long title", async () => {
    const long = "A".repeat(300);
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), long);
    await goManual(screen);

    expect(screen.getByTestId("review-title").props.value).toBe("");
    expect(screen.getByTestId("review-description").props.value).toBe(long);
  });
});

describe("Add Task — manual creation", () => {
  it("works with no AI at all", async () => {
    const screen = renderSheet();
    await goManual(screen);

    fireEvent.changeText(screen.getByTestId("review-title"), "Restock the 3rd floor cart");
    await pressCreate(screen);

    expect(posts("/ai/copilot/chat")).toHaveLength(0);
    expect(posts("/tasks")).toHaveLength(1);
    expect(posts("/tasks")[0][1]).toMatchObject({
      title: "Restock the 3rd floor cart",
      task_type: "housekeeping",
      priority: "normal",
      assigned_to: "me",
      client_request_id: expect.any(String),
    });
    expect(posts("/tasks")[0][1]).not.toHaveProperty("ai_suggested");
    expect(screen.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ replayed: false, destination: "mine", task: expect.objectContaining({ id: "t-new" }) }),
    );
    expect(screen.onClose).toHaveBeenCalled();
  });

  it("shows validation inline when the title is missing", async () => {
    const screen = renderSheet();
    await goManual(screen);

    await pressCreate(screen);

    expect(screen.getByTestId("review-title-error").props.children).toBe("Enter a task title.");
    expect(screen.getByTestId("review-summary")).toBeTruthy();
    expect(posts("/tasks")).toHaveLength(0);
  });

  it("offers only the real task types and priorities, and sends the one chosen", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Fix the squeaky door");

    for (const type of ["housekeeping", "engineering", "guest_request", "general"]) expect(screen.getByTestId(`review-type-${type}`)).toBeTruthy();
    for (const priority of ["normal", "urgent", "low"]) expect(screen.getByTestId(`review-priority-${priority}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId("review-type-engineering"));
    fireEvent.press(screen.getByTestId("review-priority-low"));
    await pressCreate(screen);

    expect(posts("/tasks")[0][1]).toMatchObject({ task_type: "engineering", priority: "low" });
  });

  it("a guest request needs a verified room", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Crib");
    fireEvent.press(screen.getByTestId("review-type-guest_request"));

    await pressCreate(screen);
    expect(screen.getByTestId("review-location-error").props.children).toBe("Choose the guest's room.");
    expect(posts("/tasks")).toHaveLength(0);
  });

  it("sends a due time in the hotel's clock", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Turn down 318");

    fireEvent.press(screen.getByTestId("review-due"));
    fireEvent.press(screen.getByTestId("due-tomorrow"));
    expect(screen.getByTestId("due-error")).toBeTruthy(); // a day without a time is not a due time
    fireEvent.changeText(screen.getByTestId("due-time"), "9:00 AM");
    expect(screen.queryByTestId("due-error")).toBeNull();
    fireEvent.press(screen.getByTestId("due-done"));
    await pressCreate(screen);

    const dueAt = posts("/tasks")[0][1].due_at as string;
    expect(new Date(dueAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })).toBe("9:00 AM");
    expect(new Date(dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("an invalid due time is refused inline", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "x");
    fireEvent.press(screen.getByTestId("review-due"));
    fireEvent.press(screen.getByTestId("due-today"));
    fireEvent.changeText(screen.getByTestId("due-time"), "soon");
    fireEvent.press(screen.getByTestId("due-done"));

    await pressCreate(screen);

    expect(screen.getByTestId("review-due-error").props.children).toBe("Enter a time like 2:00 PM.");
    expect(posts("/tasks")).toHaveLength(0);
  });

  it("unassigned tasks are sent without an assignee; no one else can be named", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Pool towels");
    fireEvent(screen.getByTestId("review-assign"), "valueChange", false);

    await pressCreate(screen);

    expect(posts("/tasks")[0][1]).not.toHaveProperty("assigned_to");
    expect(JSON.stringify(posts("/tasks")[0][1])).not.toContain("department");
  });

  it("goes back to Describe with the typed text intact", async () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);
    await goManual(screen);

    fireEvent.press(screen.getByTestId("review-back"));

    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);
  });
});

describe("Add Task — create is safe", () => {
  it("keeps every edit when the server rejects the task, and retries with a fresh key", async () => {
    const results = [() => Promise.reject(failure(422, "title is required")), () => Promise.resolve({ data: stored(), meta: {} })];
    serve({ create: async () => results.shift()!() });
    const screen = renderSheet();
    await describeAndContinue(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "My edited title");

    await pressCreate(screen);

    expect(screen.getByTestId("review-submit-error")).toBeTruthy();
    expect(screen.getByTestId("review-title").props.value).toBe("My edited title");
    expect(screen.onCreated).not.toHaveBeenCalled();
    expect(screen.onClose).not.toHaveBeenCalled();

    await pressCreate(screen);
    expect(screen.onCreated).toHaveBeenCalledTimes(1);
    const [first, second] = posts("/tasks").map((call) => call[1]);
    expect(second.title).toBe("My edited title");
    expect(second.client_request_id).not.toBe(first.client_request_id); // nothing was created, so a new key
  });

  it("an unconfirmed attempt can be retried without creating the task twice", async () => {
    const results = [() => Promise.reject(new Error("Request timed out. Please try again.")), () => Promise.resolve({ data: stored(), meta: { replayed: true } })];
    serve({ create: async () => results.shift()!() });
    const screen = renderSheet();
    await describeAndContinue(screen);

    await pressCreate(screen);
    expect(screen.getByTestId("review-submit-error")).toBeTruthy();
    expect(screen.getByText(/won't be added twice/)).toBeTruthy();
    expect(screen.onCreated).not.toHaveBeenCalled();

    await pressCreate(screen);
    const [first, second] = posts("/tasks").map((call) => call[1]);
    expect(second.client_request_id).toBe(first.client_request_id); // same key: the server returns the first task
    expect(screen.onCreated).toHaveBeenCalledWith(expect.objectContaining({ replayed: true }));
  });

  it("two quick taps create one task", async () => {
    let release: (value: unknown) => void = () => undefined;
    serve({ create: () => new Promise((resolve) => (release = resolve)) });
    const screen = renderSheet();
    await describeAndContinue(screen);

    await act(async () => {
      fireEvent.press(screen.getByTestId("review-create"));
      fireEvent.press(screen.getByTestId("review-create"));
      fireEvent.press(screen.getByTestId("review-create"));
    });
    expect(posts("/tasks")).toHaveLength(1);
    expect(screen.onCreated).not.toHaveBeenCalled(); // no success until the server answers

    await act(async () => release({ data: stored(), meta: {} }));
    expect(screen.onCreated).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while the request is in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    serve({ create: () => new Promise((resolve) => (release = resolve)) });
    const screen = renderSheet();
    await describeAndContinue(screen);
    await act(async () => void fireEvent.press(screen.getByTestId("review-create")));

    fireEvent.press(screen.getByLabelText("Close"));
    expect(screen.onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("discard-confirm")).toBeNull();

    await act(async () => release({ data: stored(), meta: {} }));
  });

  it("a server that rejects the room (another hotel's or deleted) keeps the draft and says so", async () => {
    serve({ create: async () => Promise.reject(failure(404, "Room not found")) });
    const screen = renderSheet();
    await describeAndContinue(screen);

    await pressCreate(screen);

    expect(screen.getByTestId("review-submit-error")).toBeTruthy();
    expect(screen.getByTestId("review-title").props.value).toBe("Deliver two extra pillows");
  });

  it("a forbidden role is told, and nothing is created", async () => {
    serve({ create: async () => Promise.reject(failure(403)) });
    const screen = renderSheet();
    await describeAndContinue(screen);

    await pressCreate(screen);

    expect(screen.getByText("Your role can't create this kind of task.")).toBeTruthy();
    expect(screen.onCreated).not.toHaveBeenCalled();
  });

  it("offline: does not send and tells the person", async () => {
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "x");
    screen.rerenderWith({ isOnline: false });

    await pressCreate(screen);

    expect(screen.getByText("You're offline. Connect to create the task.")).toBeTruthy();
    expect(posts("/tasks")).toHaveLength(0);
  });

  it("reports where the new task landed, from what the server stored", async () => {
    serve({ create: async () => ({ data: stored({ assigned_to: null, task_type: "engineering" }), meta: {} }) });
    const screen = renderSheet();
    await goManual(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Door squeaks");

    await pressCreate(screen);

    expect(screen.onCreated).toHaveBeenCalledWith(expect.objectContaining({ destination: "team" }));
  });
});

describe("Add Task — drafts and discarding", () => {
  it("keeps edits when going back to Describe and forward again, without asking the AI twice", async () => {
    const screen = renderSheet();
    await describeAndContinue(screen);
    fireEvent.changeText(screen.getByTestId("review-title"), "Edited title");

    fireEvent.press(screen.getByTestId("review-back"));
    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);
    fireEvent.press(screen.getByTestId("add-task-continue"));

    await waitFor(() => expect(screen.getByTestId("review-title")).toBeTruthy());
    expect(screen.getByTestId("review-title").props.value).toBe("Edited title");
    expect(posts("/ai/copilot/chat")).toHaveLength(1);
  });

  it("asking again after the description changed replaces the suggestions", async () => {
    const screen = renderSheet();
    await describeAndContinue(screen);
    fireEvent.press(screen.getByTestId("review-back"));

    fireEvent.changeText(screen.getByTestId("add-task-input"), `${REQUEST} Thanks!`);
    fireEvent.press(screen.getByTestId("add-task-continue"));

    await waitFor(() => expect(posts("/ai/copilot/chat")).toHaveLength(2));
  });

  it("warns before throwing away typed work, and Keep editing returns to it", () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);

    fireEvent.press(screen.getByLabelText("Close"));

    expect(screen.getByText("Discard this task?")).toBeTruthy();
    expect(screen.onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("discard-keep"));
    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);
  });

  it("closes straight away when there is nothing to lose", () => {
    const screen = renderSheet();

    fireEvent.press(screen.getByLabelText("Close"));

    expect(screen.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard this task?")).toBeNull();
  });

  it("Discard clears the draft for good", () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);
    fireEvent.press(screen.getByLabelText("Close"));

    fireEvent.press(screen.getByTestId("discard-confirm"));
    expect(screen.onClose).toHaveBeenCalledTimes(1);

    screen.rerenderWith({ visible: false });
    screen.rerenderWith({ visible: true });
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
  });

  it("'Save draft for later' restores it the next time the sheet opens", () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);
    fireEvent.press(screen.getByLabelText("Close"));
    fireEvent.press(screen.getByTestId("discard-save"));
    expect(screen.onClose).toHaveBeenCalledTimes(1);

    screen.rerenderWith({ visible: false });
    screen.rerenderWith({ visible: true });

    expect(screen.getByTestId("add-task-input").props.value).toBe(REQUEST);
    expect(screen.getByTestId("add-task-restored")).toBeTruthy();
  });

  it("a different account or property never sees someone else's draft", () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), "Guest Jane Doe in 318 is allergic to feathers");
    screen.rerenderWith({ visible: false });

    screen.rerenderWith({ visible: true, viewer: { id: "someone-else", tenantId: HOTEL, role: "housekeeper" } });
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
    screen.rerenderWith({ visible: false });
    screen.rerenderWith({ visible: true, viewer: { id: "me", tenantId: "Another hotel", role: "housekeeper" } });
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
  });

  it("a created task clears the draft", async () => {
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), REQUEST);
    await goManual(screen);
    await pressCreate(screen);
    expect(screen.onCreated).toHaveBeenCalled();

    screen.rerenderWith({ visible: false });
    screen.rerenderWith({ visible: true });
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
  });
});

describe("Add Task — room list problems", () => {
  it("shows a retry when the room list can not be loaded", async () => {
    serve({ rooms: new Error("Network request failed") });
    const screen = renderSheet();
    await goManual(screen);

    fireEvent.press(screen.getByTestId("review-location"));
    await waitFor(() => expect(screen.getByTestId("room-reload")).toBeTruthy());

    serve();
    fireEvent.press(screen.getByTestId("room-reload"));
    await waitFor(() => expect(screen.getByTestId("room-option-318")).toBeTruthy());
  });
});

describe("Add Task — voice input", () => {
  function withMic(permission: { granted: boolean } = { granted: true }) {
    mockSpeech.module = {
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      requestPermissionsAsync: jest.fn().mockResolvedValue(permission),
      isRecognitionAvailable: jest.fn().mockReturnValue(true),
    };
    return mockSpeech.module;
  }

  it("has no microphone when the device or build can not do speech recognition", () => {
    mockSpeech.module = null;
    const { queryByTestId, getByTestId } = renderSheet();

    expect(queryByTestId("add-task-mic")).toBeNull();
    expect(getByTestId("add-task-input")).toBeTruthy(); // typing still works
  });

  it("hides the microphone when recognition is not available on the device", () => {
    const module = withMic();
    module.isRecognitionAvailable.mockReturnValue(false);

    expect(renderSheet().queryByTestId("add-task-mic")).toBeNull();
  });

  it("asks for permission, listens in the app's language, and puts the words in the editable box without sending anything", async () => {
    const module = withMic();
    const screen = renderSheet();

    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));
    expect(module.requestPermissionsAsync).toHaveBeenCalled();
    expect(module.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "en-US", interimResults: true, continuous: false }));
    expect(module.start.mock.calls[0][0]).not.toHaveProperty("recordingOptions"); // no audio is saved
    expect(screen.getByText("Listening… tap to stop")).toBeTruthy();

    speak("result", { results: [{ transcript: "room 318 needs pillows" }], isFinal: false });
    expect(screen.getByText("room 318 needs pillows")).toBeTruthy(); // interim only
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
    speak("result", { results: [{ transcript: "Room 318 needs pillows" }], isFinal: true });
    speak("end");

    expect(screen.getByTestId("add-task-input").props.value).toBe("Room 318 needs pillows");
    expect(screen.getByText("Added to your description. Check it before continuing.")).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled(); // nothing parsed, nothing created
    fireEvent.changeText(screen.getByTestId("add-task-input"), "Room 318 needs two pillows"); // still editable
    expect(screen.getByTestId("add-task-input").props.value).toBe("Room 318 needs two pillows");
  });

  it("appends dictation to what was already typed", async () => {
    withMic();
    const screen = renderSheet();
    fireEvent.changeText(screen.getByTestId("add-task-input"), "Room 318");

    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));
    speak("result", { results: [{ transcript: "needs pillows" }], isFinal: true });
    speak("end");

    expect(screen.getByTestId("add-task-input").props.value).toBe("Room 318 needs pillows");
  });

  it("dictates Spanish when the app is in Spanish", async () => {
    mockLanguage = "es";
    const module = withMic();
    const screen = renderSheet({ language: "es" });

    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    expect(module.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "es-US" }));
  });

  it("can be stopped, and shows processing until the engine finishes", async () => {
    const module = withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    fireEvent.press(screen.getByTestId("add-task-mic"));

    expect(module.stop).toHaveBeenCalled();
    expect(screen.getByText("Processing…")).toBeTruthy();
    speak("end");
  });

  it("explains a refused permission and lets the person type instead", async () => {
    const module = withMic({ granted: false });
    const screen = renderSheet();

    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    expect(module.start).not.toHaveBeenCalled();
    expect(screen.getByTestId("voice-status").props.children).toMatch(/Microphone or speech access is off/);
    fireEvent.changeText(screen.getByTestId("add-task-input"), "typed instead");
    expect(screen.getByTestId("add-task-input").props.value).toBe("typed instead");
  });

  it("reports when no speech was heard", async () => {
    withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    speak("error", { error: "no-speech" });

    expect(screen.getByTestId("voice-status").props.children).toMatch(/didn't hear anything/);
    expect(screen.getByTestId("add-task-input").props.value).toBe("");
  });

  it("reports when transcription fails", async () => {
    withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    speak("error", { error: "network" });

    expect(screen.getByTestId("voice-status").props.children).toMatch(/Voice input didn't work/);
  });

  it("treats an engine that ends silently as 'no speech'", async () => {
    withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    speak("end");

    expect(screen.getByTestId("voice-status").props.children).toMatch(/didn't hear anything/);
  });

  it("keeps a last result the engine never marked final", async () => {
    withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    speak("result", { results: [{ transcript: "bring a crib" }], isFinal: false });
    speak("end");

    expect(screen.getByTestId("add-task-input").props.value).toBe("bring a crib");
  });

  it("releases the microphone when the sheet goes away", async () => {
    const module = withMic();
    const screen = renderSheet();
    await act(async () => void fireEvent.press(screen.getByTestId("add-task-mic")));

    screen.unmount();

    expect(module.abort).toHaveBeenCalled();
  });

  it("is a large, labelled button", () => {
    withMic();
    const { getByTestId } = renderSheet();
    const mic = getByTestId("add-task-mic");

    expect(mic.props.accessibilityLabel).toBe("Speak your request");
    expect(mic.props.accessibilityRole).toBe("button");
    const style = StyleSheet.flatten(mic.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});

describe("Add Task — Spanish and accessibility", () => {
  it("is fully translated in Spanish across Describe, Review and the editors", async () => {
    mockLanguage = "es";
    serve({ parse: { data: { response_type: "task_preview", tasks: [{ ...PILLOWS, task_type: "lost_found", room_id: null, room_number_display: "999", priority: "urgent", due_unresolved: true }] } } });
    const screen = renderSheet({ language: "es" });

    expect(screen.getByText("¿Qué hay que hacer?")).toBeTruthy();
    expect(screen.getByText("Continuar")).toBeTruthy();
    expect(screen.getByText("Ingresar los detalles manualmente")).toBeTruthy();
    await describeAndContinue(screen);

    expect(screen.getByText("Revisar nueva tarea")).toBeTruthy();
    expect(screen.getByText("Título de la tarea")).toBeTruthy();
    expect(screen.getByText("Limpieza")).toBeTruthy();
    expect(screen.getByText("Urgente")).toBeTruthy();
    expect(screen.getByText("Crear tarea")).toBeTruthy();
    expect(screen.getByTestId("review-priority-error").props.children).toBe("La sugerencia fue Urgente. Toca una prioridad para confirmarla.");
    fireEvent.press(screen.getByTestId("review-location"));
    expect(screen.getByText("Elegir ubicación")).toBeTruthy();
    expect(screen.getByLabelText("Buscar habitaciones por número")).toBeTruthy();
    fireEvent.press(screen.getByTestId("location-back"));
    fireEvent.press(screen.getByTestId("review-due"));
    expect(screen.getByText("Hora de vencimiento")).toBeTruthy();
  });

  it("no user-facing key is left untranslated in English or Spanish", () => {
    const missing: string[] = [];
    const walk = (node: unknown, path: string, other: unknown) => {
      if (typeof node === "string") {
        if (typeof other !== "string") missing.push(path);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, `${path}.${key}`, (other as Record<string, unknown> | undefined)?.[key]);
      }
    };
    const addEn = (en as unknown as { tasks: { hk: { add: unknown } } }).tasks.hk.add;
    const addEs = (es as unknown as { tasks: { hk: { add: unknown } } }).tasks.hk.add;
    walk(addEn, "en->es", addEs);
    walk(addEs, "es->en", addEn);
    expect(missing).toEqual([]);
  });

  it("uses accessible controls: labelled input, radio chips, alert errors, 44pt targets", async () => {
    const screen = renderSheet();
    expect(screen.getByLabelText("Describe the task")).toBeTruthy();
    await goManual(screen);
    await pressCreate(screen); // reveals the title error

    expect(screen.getByTestId("review-title").props.accessibilityLabel).toBe("Task title");
    expect(screen.getByTestId("review-title-error").props.accessibilityRole).toBe("alert");
    const chip = screen.getByTestId("review-type-housekeeping");
    expect(chip.props.accessibilityRole).toBe("radio");
    expect(chip.props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("review-type-engineering").props.accessibilityState.selected).toBe(false);
    expect(StyleSheet.flatten(chip.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(screen.getByTestId("review-create").props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId("review-assign").props.accessibilityRole).toBe("switch");
    expect(screen.getByTestId("review-location").props.accessibilityLabel).toMatch(/^Location: No location/);
  });

  it("text fields scale with the system font size (no fixed caps on the inputs)", () => {
    const { getByTestId } = renderSheet();
    const style = StyleSheet.flatten(getByTestId("add-task-input").props.style);

    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(getByTestId("add-task-input").props.allowFontScaling).not.toBe(false);
  });
});
