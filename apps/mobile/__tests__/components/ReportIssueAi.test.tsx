import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

let mockLanguage: "en" | "es" = "en";
const mockDictionaries = { en, es } as unknown as Record<string, Record<string, unknown>>;
function mockTranslate(key: string, values?: Record<string, unknown>): string {
  const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], mockDictionaries[mockLanguage]);
  const template = typeof found === "string" ? found : key;
  return values ? template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? `{{${name}}}`)) : template;
}

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
let mockOnline = true;

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => mockTranslate(key, values),
    i18n: { language: mockLanguage, resolvedLanguage: mockLanguage },
  }),
}));
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, API_BASE: "https://api.test/v1", api: { get: jest.fn(), post: jest.fn() } };
});
jest.mock("@/lib/api/workOrders", () => ({ createWorkOrder: jest.fn(), uploadWorkOrderPhoto: jest.fn() }));
jest.mock("@/lib/offline/db", () => ({ enqueueAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn(async (uri: string) => `resized:${uri}`),
}));
jest.mock("@/lib/ai/copilotChat", () => ({
  sendCopilotMessage: jest.fn(),
  isAbort: (error: unknown) => error instanceof Error && error.name === "AbortError",
}));
jest.mock("@/lib/ai/photoAnalysis", () => ({ analyzeIssuePhoto: jest.fn() }));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ isOnline: mockOnline, user: { id: "user-1" } }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

// A controllable speech engine (the real one is native).
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

import { CopilotFailure } from "@/lib/ai/contract";
import { sendCopilotMessage } from "@/lib/ai/copilotChat";
import { analyzeIssuePhoto } from "@/lib/ai/photoAnalysis";
import { api } from "@/lib/api/client";
import { createWorkOrder, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { enqueueAction } from "@/lib/offline/db";
import { pickPhoto } from "@/lib/housekeeping/photo";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";

const mockSend = sendCopilotMessage as jest.Mock;
const mockAnalyze = analyzeIssuePhoto as jest.Mock;
const mockCreate = createWorkOrder as jest.Mock;
const mockUpload = uploadWorkOrderPhoto as jest.Mock;
const mockEnqueue = enqueueAction as jest.Mock;
const mockPick = pickPhoto as jest.Mock;

const DESCRIPTION = "The bathroom sink is leaking and water is dripping underneath.";
const WORK_ORDER_REPLY = (over: Record<string, unknown> = {}) => ({
  kind: "actions",
  message: "",
  intent: "work_order_creation",
  provenance: "ai",
  trustedContext: null,
  actions: [
    {
      kind: "work_order",
      draft: {
        title: "Bathroom sink leaking",
        description: "",
        category: "plumbing",
        priority: "normal",
        locationText: "",
        roomNumber: "999", // never taken from the model
        roomId: "other-room",
        ...over,
      },
    },
  ],
});
const SUGGESTION_PHOTO = { outcome: "suggestion", observation: "Moisture visible under sink", category: "plumbing", question: "Is water actively leaking?" };

function renderModal(onClose = jest.fn()) {
  const tree = () => (
    <ThemeProvider>
      <ReportIssueModal visible roomId="room-312" roomNumber="312" onClose={onClose} />
    </ThemeProvider>
  );
  const utils = render(tree());
  return { ...utils, onClose, again: () => utils.rerender(tree()) };
}
type Screen = ReturnType<typeof renderModal>;

const typeDescription = (screen: Screen, text = DESCRIPTION) => fireEvent.changeText(screen.getByTestId("issue-details"), text);
async function suggest(screen: Screen) {
  await act(async () => {
    fireEvent.press(screen.getByTestId("issue-ai-suggest"));
  });
}
async function attachPhoto(screen: Screen, uri = "file:///data/cache/p.jpg") {
  mockPick.mockResolvedValue({ ok: true, uri });
  fireEvent.press(screen.getByTestId("issue-photo-gallery"));
  await waitFor(() => expect(screen.getByTestId("issue-photo-preview")).toBeTruthy());
}
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockLanguage = "en";
  mockSpeech.module = null;
  Object.keys(mockSpeechHandlers).forEach((key) => delete mockSpeechHandlers[key]);
  mockCreate.mockResolvedValue("wo-new");
  mockUpload.mockResolvedValue({});
  (api.get as jest.Mock).mockResolvedValue({ data: [] });
  mockSend.mockResolvedValue(WORK_ORDER_REPLY());
  mockAnalyze.mockResolvedValue(SUGGESTION_PHOTO);
});

describe("Report Issue — the manual form is unchanged and needs no AI", () => {
  it("submits straight away with the plain button when nothing AI-made is in it", async () => {
    const screen = renderModal();
    typeDescription(screen, "Lamp is broken");
    fireEvent.changeText(screen.getByTestId("title-input"), "Lamp broken");
    fireEvent.press(screen.getByTestId("category-option-furniture"));
    expect(screen.getByText("Submit Work Order")).toBeTruthy();
    fireEvent.press(screen.getByTestId("issue-submit"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ room_id: "room-312", title: "Lamp broken", description: "Lamp is broken", category: "furniture" });
    expect(screen.queryByTestId("issue-edit")).toBeNull(); // no extra review step for a hand-written report
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("never calls the AI by itself: not while typing, not when a photo is attached", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await attachPhoto(screen);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(screen.getByTestId("issue-photo-analyze")).toBeTruthy();
  });

  it("shows the room as a verified fact, separate from anything suggested", () => {
    const screen = renderModal();
    expect(screen.getByText("Room 312")).toBeTruthy();
    expect(screen.getByTestId("issue-room-verified").props.children).toContain("Verified room");
  });
});

describe("Report Issue — suggestions from the description", () => {
  it("asks only when pressed, with the verified room as context, and creates nothing", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toBe(DESCRIPTION);
    expect(mockSend.mock.calls[0][1]).toMatchObject({ intentHint: "work_order_creation", context: { roomId: "room-312" } });
    await waitFor(() => expect(screen.getByTestId("issue-ai-suggestion")).toBeTruthy());
    expect(screen.getByTestId("issue-ai-row-title")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    // Showing a suggestion changes nothing in the form.
    expect(screen.getByTestId("title-input").props.value).toBe("");
  });

  it("needs enough to read, a connection, and is offered once per description", async () => {
    const screen = renderModal();
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(true);
    typeDescription(screen, "leak");
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(true);
    typeDescription(screen);
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(false);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-suggestion")).toBeTruthy());
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(true); // already suggested for these exact words
  });

  it("'Use these details' fills the form, labels the values as suggestions, and the review shows what is AI-made", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-ai-use-all"));

    expect(screen.getByTestId("title-input").props.value).toBe("Bathroom sink leaking");
    expect(screen.getByTestId("category-option-plumbing").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("issue-suggested-title")).toBeTruthy();
    expect(screen.getByTestId("issue-suggested-category")).toBeTruthy();
    // The employee's own words are not relabelled.
    expect(screen.queryByTestId("issue-suggested-details")).toBeNull();

    // The button now leads to the review, not straight to creating.
    expect(screen.getByText("Review report")).toBeTruthy();
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(screen.getByTestId("confirm-rows")).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Create Maintenance Work Order")).toBeTruthy();
    expect(screen.getByText("312 (verified)")).toBeTruthy();
    expect(screen.getByText("Bathroom sink leaking · AI suggestion")).toBeTruthy();
    expect(screen.getByText("Plumbing · AI suggestion")).toBeTruthy();
    expect(screen.getByText("No photo")).toBeTruthy();
    expect(screen.getByText("Prepared with suggestions you reviewed")).toBeTruthy();

    fireEvent.press(screen.getByTestId("issue-submit")); // Confirm & create
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ room_id: "room-312", title: "Bathroom sink leaking", category: "plumbing", priority: "normal", description: DESCRIPTION });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("use_ai");
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("assigned_to");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Work order submitted."));
  });

  it("'Edit details' goes back to the form with everything kept", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-ai-use-all"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(screen.getByTestId("issue-edit")).toBeTruthy());

    fireEvent.press(screen.getByTestId("issue-edit"));

    expect(screen.getByTestId("title-input").props.value).toBe("Bathroom sink leaking");
    expect(screen.getByTestId("issue-details").props.value).toBe(DESCRIPTION);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("editing a suggested field makes it the person's own (no longer tagged)", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-ai-use-all"));
    expect(screen.getByTestId("issue-suggested-title")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("title-input"), "Sink leak in bathroom");

    expect(screen.queryByTestId("issue-suggested-title")).toBeNull();
    expect(screen.getByTestId("issue-suggested-category")).toBeTruthy();
  });

  it("never overwrites what the person already entered, and says what it kept", async () => {
    const screen = renderModal();
    typeDescription(screen);
    fireEvent.changeText(screen.getByTestId("title-input"), "My own title");
    fireEvent.press(screen.getByTestId("category-option-furniture"));
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());

    fireEvent.press(screen.getByTestId("issue-ai-use-all"));

    expect(screen.getByTestId("title-input").props.value).toBe("My own title");
    expect(screen.getByTestId("category-option-furniture").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("issue-ai-kept").props.children).toContain("title");
    // A deliberate per-field choice does replace it.
    fireEvent.press(screen.getByTestId("issue-ai-use-title"));
    expect(screen.getByTestId("title-input").props.value).toBe("Bathroom sink leaking");
  });

  it("does not make an urgent suggestion the report's priority unless the person applies it on purpose", async () => {
    mockSend.mockResolvedValue(WORK_ORDER_REPLY({ priority: "urgent" }));
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());

    fireEvent.press(screen.getByTestId("issue-ai-use-all"));
    expect(screen.getByTestId("priority-normal").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("issue-ai-urgent")).toBeTruthy();

    fireEvent.press(screen.getByTestId("issue-ai-use-priority"));
    expect(screen.getByTestId("priority-urgent").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("issue-suggested-priority")).toBeTruthy();
  });

  it("drops a suggestion the moment the description changes, and never lets a late answer overwrite newer edits", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockSend.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);

    typeDescription(screen, `${DESCRIPTION} It started this morning.`); // edited while the answer was away
    await act(async () => {
      answer(WORK_ORDER_REPLY());
    });

    // The answer is about the OLD words: it is not shown as a suggestion for the new ones, and nothing was applied.
    expect(screen.queryByTestId("issue-ai-suggestion")).toBeNull();
    expect(screen.getByTestId("issue-ai-stale")).toBeTruthy();
    expect(screen.getByTestId("title-input").props.value).toBe("");
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(false); // can ask again for the new words
  });

  it("a description edited after a suggestion hides it and offers a fresh one", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-suggestion")).toBeTruthy());

    typeDescription(screen, `${DESCRIPTION} More.`);

    expect(screen.queryByTestId("issue-ai-suggestion")).toBeNull();
    expect(screen.getByTestId("issue-ai-stale")).toBeTruthy();
  });

  it("an ambiguous description gets 'nothing to suggest', not an invented diagnosis", async () => {
    mockSend.mockResolvedValue({ kind: "answer", message: "I can help…", intent: "general", provenance: "ai", trustedContext: null, sources: [] });
    const screen = renderModal();
    typeDescription(screen, "something is wrong in here");
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-none")).toBeTruthy());
    expect(screen.queryByTestId("issue-ai-suggestion")).toBeNull();
    expect(screen.getByTestId("title-input").props.value).toBe("");
  });

  it.each([
    ["credit_limit", /monthly limit/],
    ["rate_limited", /Too many requests/],
    ["unavailable", /aren't available right now\. You can still report/],
    ["offline", /offline/],
  ])("when the AI is %s the report is still fully usable", async (kind, message) => {
    mockSend.mockRejectedValue(new CopilotFailure(kind as never, "x"));
    const screen = renderModal();
    typeDescription(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-failed").props.children).toMatch(message));

    fireEvent.changeText(screen.getByTestId("title-input"), "Sink leaking");
    fireEvent.press(screen.getByTestId("category-option-plumbing"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  });

  it("is switched off offline, with a reason, and the report can still be saved", async () => {
    mockOnline = false;
    const screen = renderModal();
    typeDescription(screen);
    expect(isDisabled(screen.getByTestId("issue-ai-suggest"))).toBe(true);
    expect(screen.getByTestId("issue-ai-offline")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("title-input"), "Toilet clogged");
    fireEvent.press(screen.getByTestId("category-option-plumbing"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith("work_order", "create", expect.objectContaining({ title: "Toilet clogged" })));
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("Report Issue — photo and optional photo analysis", () => {
  it("shows the photo as 'not uploaded yet' until the report exists", async () => {
    const screen = renderModal();
    await attachPhoto(screen);
    expect(screen.getByTestId("issue-photo-status").props.children).toContain("not uploaded yet");
  });

  it("explains a refused camera, and an unsupported or oversized file", async () => {
    const screen = renderModal();
    mockPick.mockResolvedValue({ ok: false, reason: "permission_denied" });
    fireEvent.press(screen.getByTestId("issue-photo-camera"));
    await waitFor(() => expect(screen.getByText(/Camera access is off/)).toBeTruthy());

    mockPick.mockResolvedValue({ ok: false, reason: "unsupported" });
    fireEvent.press(screen.getByTestId("issue-photo-gallery"));
    await waitFor(() => expect(screen.getByText(/isn't a supported photo/)).toBeTruthy());

    mockPick.mockResolvedValue({ ok: false, reason: "too_large" });
    fireEvent.press(screen.getByTestId("issue-photo-gallery"));
    await waitFor(() => expect(screen.getByText(/too large/)).toBeTruthy());
    expect(screen.queryByTestId("issue-photo-preview")).toBeNull();
  });

  it("discloses what will happen first and sends nothing until 'Send photo for analysis'", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));

    expect(screen.getByTestId("issue-photo-consent")).toBeTruthy();
    expect(screen.getByText(/sent securely to PatelRep's AI service/)).toBeTruthy();
    expect(mockAnalyze).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("issue-photo-cancel"));
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(screen.queryByTestId("issue-photo-consent")).toBeNull();
  });

  it("sends the photo once, with the verified room, and shows the result as an unverified suggestion", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });

    await waitFor(() => expect(screen.getByTestId("issue-photo-suggestion")).toBeTruthy());
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][0]).toMatchObject({ uri: "file:///data/cache/p.jpg", description: DESCRIPTION, roomId: "room-312" });
    expect(screen.getByTestId("issue-photo-observation").props.children).toBe("Moisture visible under sink");
    expect(screen.getByText("From the photo only. Not checked or confirmed.")).toBeTruthy();
    expect(screen.getByTestId("issue-photo-question").props.children).toBe("Is water actively leaking?");
    // Nothing was applied or created by looking at it.
    expect(screen.getByTestId("title-input").props.value).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("'Use these details' adds the category and a clearly labelled note, never silently", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });
    await waitFor(() => expect(screen.getByTestId("issue-photo-use")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-photo-answer-yes"));
    fireEvent.press(screen.getByTestId("issue-photo-use"));

    expect(screen.getByTestId("category-option-plumbing").props.accessibilityState.selected).toBe(true);
    const details = screen.getByTestId("issue-details").props.value as string;
    expect(details.startsWith(DESCRIPTION)).toBe(true);
    expect(details).toContain("Photo note (AI, unverified): Moisture visible under sink");
    expect(details).toContain("Is water actively leaking? Yes (your answer)");
    expect(screen.getByTestId("issue-suggested-category")).toBeTruthy();
    expect(screen.getByTestId("issue-suggested-details")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();

    // Pressing again does not duplicate the note.
    fireEvent.press(screen.getByTestId("issue-photo-use"));
    expect((screen.getByTestId("issue-details").props.value as string).split("Photo note (AI, unverified)").length).toBe(2);
  });

  it("'Discard suggestions' changes nothing and the report is still plain and manual", async () => {
    const screen = renderModal();
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });
    await waitFor(() => expect(screen.getByTestId("issue-photo-discard")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-photo-discard"));

    expect(screen.queryByTestId("issue-photo-suggestion")).toBeNull();
    expect(screen.getByTestId("issue-details").props.value).toBe("");
    expect(screen.getByText("Submit Work Order")).toBeTruthy();
  });

  it("'unable to determine' is a normal answer, with nothing to apply", async () => {
    mockAnalyze.mockResolvedValue({ outcome: "unable_to_determine", observation: null, category: null, question: null });
    const screen = renderModal();
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });
    await waitFor(() => expect(screen.getByTestId("issue-photo-unable")).toBeTruthy());
    expect(screen.queryByTestId("issue-photo-use")).toBeNull();
  });

  it.each([
    ["credit_limit", /monthly limit/],
    ["invalid_request", /couldn't be analyzed/],
    ["unavailable", /isn't available right now/],
  ])("when analysis fails (%s) the photo still goes with the report", async (kind, message) => {
    mockAnalyze.mockRejectedValue(new CopilotFailure(kind as never, "x"));
    const screen = renderModal();
    await attachPhoto(screen);
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });
    await waitFor(() => expect(screen.getByTestId("issue-photo-ai-failed").props.children).toMatch(message));

    fireEvent.changeText(screen.getByTestId("title-input"), "Sink leaking");
    fireEvent.press(screen.getByTestId("category-option-plumbing"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith("wo-new", "resized:file:///data/cache/p.jpg"));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("ignores an analysis that comes back after the photo was replaced or removed", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockAnalyze.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const screen = renderModal();
    await attachPhoto(screen, "file:///data/cache/first.jpg");
    fireEvent.press(screen.getByTestId("issue-photo-analyze"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-photo-send"));
    });

    // Replace the photo while the first is still being looked at.
    await attachPhoto(screen, "file:///data/cache/second.jpg");
    await act(async () => {
      answer(SUGGESTION_PHOTO);
    });

    expect(screen.queryByTestId("issue-photo-suggestion")).toBeNull();
    expect(screen.getByTestId("issue-photo-analyze")).toBeTruthy(); // the new photo has not been analysed
    expect(mockAnalyze).toHaveBeenCalledTimes(1);

    // Removing the photo hides any earlier result as well.
    fireEvent.press(screen.getByTestId("issue-photo-remove"));
    expect(screen.queryByTestId("issue-photo-ai")).toBeNull();
  });

  it("shows the photo in the review as not yet uploaded, then uploads it to the new work order exactly once", async () => {
    const screen = renderModal();
    typeDescription(screen);
    await attachPhoto(screen);
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-ai-use-all"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(screen.getByTestId("confirm-rows")).toBeTruthy());
    expect(screen.getByText(/not uploaded yet; it uploads after the report is created/)).toBeTruthy();

    fireEvent.press(screen.getByTestId("issue-submit"));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("wo-new", "resized:file:///data/cache/p.jpg");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockAnalyze).not.toHaveBeenCalled(); // attaching and reporting never sent it to the AI
  });

  it("offline, analysis is unavailable with a reason (and a photo blocks saving, as before)", async () => {
    const screen = renderModal();
    await attachPhoto(screen);
    mockOnline = false;
    screen.again();
    expect(isDisabled(screen.getByTestId("issue-photo-analyze"))).toBe(true);
    expect(screen.getByTestId("issue-photo-ai-offline")).toBeTruthy();
    expect(screen.getByTestId("issue-offline-photo")).toBeTruthy();
  });
});

describe("Report Issue — voice", () => {
  it("adds what was heard to the description for the person to check; it submits nothing", async () => {
    mockSpeech.module = {
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      isRecognitionAvailable: jest.fn().mockReturnValue(true),
    };
    const screen = renderModal();
    typeDescription(screen, "The sink");
    await act(async () => {
      fireEvent.press(screen.getByTestId("issue-voice"));
    });
    expect(mockSpeech.module.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "en-US", interimResults: true }));
    speak("result", { results: [{ transcript: "is leaking" }], isFinal: true });

    await waitFor(() => expect(screen.getByTestId("issue-details").props.value).toBe("The sink is leaking"));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled(); // dictation does not trigger the AI either
  });

  it("has no microphone button where speech recognition is unavailable", () => {
    const screen = renderModal();
    expect(screen.queryByTestId("issue-voice")).toBeNull();
  });
});

describe("Report Issue — Spanish", () => {
  it("reads in Spanish: form, assistance and review", async () => {
    mockLanguage = "es";
    const screen = renderModal();
    expect(screen.getByText("¿Qué pasó?")).toBeTruthy();
    expect(screen.getByText("Sugerir detalles", { exact: false })).toBeTruthy();
    typeDescription(screen, "El lavabo del baño gotea mucho debajo.");
    await suggest(screen);
    await waitFor(() => expect(screen.getByTestId("issue-ai-use-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("issue-ai-use-all"));
    fireEvent.press(screen.getByTestId("issue-submit"));
    await waitFor(() => expect(screen.getByText("Crear orden de trabajo de mantenimiento")).toBeTruthy());
    expect(screen.getByText("Confirmar y crear")).toBeTruthy();
  });
});
