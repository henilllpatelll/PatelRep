import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

let mockSopId = "d0000000-0000-4000-8000-000000000001";
let mockPage: string | undefined;

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ sopId: mockSopId, page: mockPage }),
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: make } = require("../helpers/i18n");
  const t = make("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/voice/speechModule", () => ({ isSpeechAvailable: () => true }));
jest.mock("@/lib/api/sop", () => ({
  listLibrary: jest.fn(),
  getLibraryDocument: jest.fn(),
  getLibraryFile: jest.fn(),
}));
jest.mock("@/lib/sop/openOriginal", () => ({ openOriginalDocument: jest.fn() }));

const mockAssistant = {
  openAssistant: jest.fn(),
  setPendingHint: jest.fn(),
  conversation: { send: jest.fn() },
};
let mockAssistantEnabled = false;
jest.mock("@/lib/ai/AssistantProvider", () => ({
  useAssistantOptional: () => (mockAssistantEnabled ? mockAssistant : null),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ApiError } from "@/lib/api/client";
import { getLibraryDocument, listLibrary } from "@/lib/api/sop";
import { openOriginalDocument } from "@/lib/sop/openOriginal";
import { writeSopCache } from "@/lib/sop/offlineCache";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import SopLibraryScreen from "@/app/(app)/sop/index";
import SopDetailScreen from "@/app/(app)/sop/[sopId]";

const mockList = listLibrary as jest.Mock;
const mockGet = getLibraryDocument as jest.Mock;
const mockOpen = openOriginalDocument as jest.Mock;

const DND = "d0000000-0000-4000-8000-000000000001";
const CHEM = "d0000000-0000-4000-8000-000000000002";
const NEW = "d0000000-0000-4000-8000-000000000003";

const approved = (version: number) => ({ state: "approved" as const, version, effective_date: null, review_date: "2027-01-05", approved_at: "2026-10-02T12:00:00Z" });
const dnd = {
  id: DND, title: "Do Not Disturb Policy", description: "Room access rules.", category: "Housekeeping", page_count: 3,
  indexing_status: "indexed" as const, created_at: "2026-10-03T12:00:00.000Z", ai_ready: true, approval: approved(2),
};
const chem = {
  id: CHEM, title: "Chemical Handling", description: null, category: "Safety", page_count: 5,
  indexing_status: "indexed" as const, created_at: "2026-10-02T12:00:00.000Z", ai_ready: true, approval: null,
};
const fresh = {
  id: NEW, title: "Fresh Upload", description: null, category: "Safety", page_count: null,
  indexing_status: "pending" as const, created_at: "2026-10-01T12:00:00.000Z", ai_ready: false, approval: null,
};

const renderWithTheme = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
const flush = () => act(async () => {});

function signIn(role = "housekeeper") {
  useAppStore.setState({ user: { id: "u1", tenant_id: "h1", role, effective_role: role } as never, isOnline: true });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSopId = DND;
  mockPage = undefined;
  mockAssistantEnabled = false;
  signIn();
  mockList.mockResolvedValue({ data: [dnd, chem, fresh] });
  mockGet.mockResolvedValue({ data: dnd });
  mockOpen.mockResolvedValue("opened");
});

describe("SOP library", () => {
  it("lists the hotel's procedures with their real approval status, navigable to the detail route", async () => {
    const { getAllByTestId, getAllByText, getByText, queryByText } = renderWithTheme(<SopLibraryScreen />);
    await waitFor(() => expect(getByText("Do Not Disturb Policy")).toBeTruthy());
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(getAllByTestId("sop-row")).toHaveLength(3);
    expect(getByText("Housekeeping · Approved · Version 2")).toBeTruthy();
    // A document with no approval record claims nothing.
    expect(getAllByText("Safety").length).toBeGreaterThan(0);
    expect(queryByText(/Safety · Approved/)).toBeNull();

    fireEvent.press(getAllByTestId("sop-row")[0]);
    expect(router.push).toHaveBeenCalledWith(`/(app)/sop/${DND}`);
  });

  it("filters by title and category while typing, without any AI call", async () => {
    const { getByTestId, getAllByTestId, queryByText, getByText } = renderWithTheme(<SopLibraryScreen />);
    await waitFor(() => expect(getAllByTestId("sop-row")).toHaveLength(3));
    fireEvent.changeText(getByTestId("sop-ask-input"), "disturb");
    expect(getAllByTestId("sop-row")).toHaveLength(1);
    fireEvent.changeText(getByTestId("sop-ask-input"), "safety");
    expect(getAllByTestId("sop-row")).toHaveLength(2);
    expect(queryByText("Do Not Disturb Policy")).toBeNull();
    fireEvent.changeText(getByTestId("sop-ask-input"), "zzzz");
    expect(getByText('No procedures match "zzzz"')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("narrows by category", async () => {
    const { getByTestId, getAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    await waitFor(() => expect(getAllByTestId("sop-row")).toHaveLength(3));
    fireEvent.press(getByTestId("sop-category-Safety"));
    expect(getAllByTestId("sop-row")).toHaveLength(2);
    fireEvent.press(getByTestId("sop-category-all"));
    expect(getAllByTestId("sop-row")).toHaveLength(3);
  });

  it("offers questions only about procedures the assistant can answer from", async () => {
    const { findAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    const chips = await findAllByTestId("sop-suggestion");
    expect(chips).toHaveLength(2); // the pending upload is not offered
    const label = chips.map((chip) => chip.props.accessibilityLabel);
    expect(label).toContain("What are the key points of Do Not Disturb Policy?");
    expect(label.join(" ")).not.toContain("Fresh Upload");
  });

  it("offers no suggestions when the hotel has no procedure to ask about", async () => {
    mockList.mockResolvedValue({ data: [fresh] });
    const { findAllByTestId, queryAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    await findAllByTestId("sop-row");
    expect(queryAllByTestId("sop-suggestion")).toHaveLength(0);
  });

  it("hands a typed question to the full chat (other roles), as a procedure question", async () => {
    signIn("engineer");
    const { getByTestId, findAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    await findAllByTestId("sop-row");
    fireEvent.changeText(getByTestId("sop-ask-input"), "How do I handle DND?");
    fireEvent.press(getByTestId("sop-ask-send"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/copilot", params: { prefill: "How do I handle DND?", intent: "sop_query" } });
  });

  it("sends a housekeeper's question through the shared assistant with the procedure intent", async () => {
    mockAssistantEnabled = true;
    const { getByTestId, findAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    await findAllByTestId("sop-row");
    fireEvent.changeText(getByTestId("sop-ask-input"), "What is the spill procedure?");
    fireEvent.press(getByTestId("sop-ask-send"));
    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "general" });
    expect(mockAssistant.conversation.send).toHaveBeenCalledWith("What is the spill procedure?", { intentHint: "sop_query", context: {} });
  });

  it("asks about the chosen procedure when a suggestion is tapped, with a validated document id", async () => {
    mockAssistantEnabled = true;
    const { findAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    const [chip] = await findAllByTestId("sop-suggestion");
    fireEvent.press(chip);
    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "sop", entityId: DND, label: "Do Not Disturb Policy" });
    expect(mockAssistant.conversation.send).toHaveBeenCalledWith(
      "What are the key points of Do Not Disturb Policy?",
      { intentHint: "sop_query", context: { documentId: DND } },
    );
  });

  it("opens the voice panel from the microphone for housekeepers only", async () => {
    mockAssistantEnabled = true;
    const view = renderWithTheme(<SopLibraryScreen />);
    await view.findAllByTestId("sop-row");
    fireEvent.press(view.getByTestId("sop-ask-voice"));
    expect(mockAssistant.setPendingHint).toHaveBeenCalledWith("sop_query");
    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "general", voice: true });
    view.unmount();

    signIn("engineer");
    const other = renderWithTheme(<SopLibraryScreen />);
    await other.findAllByTestId("sop-row");
    expect(other.queryByTestId("sop-ask-voice")).toBeNull();
  });

  it("cannot ask while offline, but still lists the procedures saved on this phone, marked as saved", async () => {
    await writeSopCache("h1:u1", [dnd, chem], Date.now() - 3 * 3_600_000);
    useAppStore.setState({ isOnline: false });
    const { getByTestId, getAllByTestId, queryAllByTestId, getByText } = renderWithTheme(<SopLibraryScreen />);
    await waitFor(() => expect(getAllByTestId("sop-row")).toHaveLength(2));
    expect(mockList).not.toHaveBeenCalled();
    expect(getByTestId("sop-cache-banner")).toBeTruthy();
    expect(getByText(/saved on this phone 3 h ago/)).toBeTruthy();
    expect(queryAllByTestId("sop-suggestion")).toHaveLength(0);
    fireEvent.changeText(getByTestId("sop-ask-input"), "How do I handle DND?");
    fireEvent.press(getByTestId("sop-ask-send"));
    expect(router.push).not.toHaveBeenCalled();
    expect(getByTestId("sop-ask-hint").props.children).toMatch(/needs a connection/);
  });

  it("falls back to the saved list when the server cannot be reached", async () => {
    await writeSopCache("h1:u1", [chem], Date.now() - 60_000);
    mockList.mockRejectedValue(new TypeError("Network request failed"));
    const { findByTestId, getAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    expect(await findByTestId("sop-cache-banner")).toBeTruthy();
    expect(getAllByTestId("sop-row")).toHaveLength(1);
  });

  it("never shows another person's saved list", async () => {
    await writeSopCache("h2:someone-else", [chem], Date.now());
    mockList.mockRejectedValue(new TypeError("Network request failed"));
    const { findByText, queryByTestId } = renderWithTheme(<SopLibraryScreen />);
    expect(await findByText(/Procedures could not be loaded/)).toBeTruthy();
    expect(queryByTestId("sop-row")).toBeNull();
  });

  it("shows a plain empty state when the hotel has no procedures", async () => {
    mockList.mockResolvedValue({ data: [] });
    const { findByText } = renderWithTheme(<SopLibraryScreen />);
    expect(await findByText("No procedures yet")).toBeTruthy();
  });

  it("only writes the list to the phone after a successful load", async () => {
    const { findAllByTestId } = renderWithTheme(<SopLibraryScreen />);
    await findAllByTestId("sop-row");
    await flush();
    const stored = JSON.parse((await AsyncStorage.getItem("@patelrep/sop_library_cache.v1")) ?? "{}");
    expect(stored.scope).toBe("h1:u1");
    expect(stored.docs).toHaveLength(3);
  });
});

describe("SOP document detail", () => {
  it("shows status, version and dates from the document's own record", async () => {
    const { findByTestId, getByTestId } = renderWithTheme(<SopDetailScreen />);
    expect(await findByTestId("sop-detail-title")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith(DND);
    expect(getByTestId("sop-detail-status").props.children).toBe("Approved · Version 2");
    expect(getByTestId("sop-detail-dates").props.children).toMatch(/Approved Oct 2, 2026 · Review due Jan 5, 2027/);
  });

  it("claims no approval for a document that has none", async () => {
    mockGet.mockResolvedValue({ data: chem });
    const { findByTestId, queryByTestId } = renderWithTheme(<SopDetailScreen />);
    expect((await findByTestId("sop-detail-status")).props.children).toBe("Hotel document");
    expect(queryByTestId("sop-detail-dates")).toBeNull();
  });

  it("opens the original document, at the cited page when there is one", async () => {
    mockPage = "3";
    const { findByTestId } = renderWithTheme(<SopDetailScreen />);
    fireEvent.press(await findByTestId("sop-open-original"));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith(DND, 3));
  });

  it("says so when the original cannot be opened", async () => {
    mockOpen.mockResolvedValue("unavailable");
    const { findByTestId } = renderWithTheme(<SopDetailScreen />);
    fireEvent.press(await findByTestId("sop-open-original"));
    expect(await findByTestId("sop-open-unavailable")).toBeTruthy();
  });

  it("asks about THIS procedure from each question, with the document id the server will verify", async () => {
    mockAssistantEnabled = true;
    const { findByTestId } = renderWithTheme(<SopDetailScreen />);
    fireEvent.press(await findByTestId("sop-question-simply"));
    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "sop", entityId: DND, label: "Do Not Disturb Policy" });
    expect(mockAssistant.conversation.send).toHaveBeenCalledWith("Explain this procedure more simply.", { intentHint: "sop_query", context: { documentId: DND } });
  });

  it("offers a translation into the other supported language", async () => {
    mockAssistantEnabled = true;
    const { findByTestId } = renderWithTheme(<SopDetailScreen />);
    fireEvent.press(await findByTestId("sop-question-translate"));
    expect(mockAssistant.conversation.send).toHaveBeenCalledWith("Translate this procedure into Spanish.", expect.anything());
  });

  it("opens the assistant about the procedure without asking anything for 'Ask another question'", async () => {
    mockAssistantEnabled = true;
    const { findByTestId } = renderWithTheme(<SopDetailScreen />);
    fireEvent.press(await findByTestId("sop-question-another"));
    expect(mockAssistant.openAssistant).toHaveBeenCalledWith({ contextType: "sop", entityId: DND, label: "Do Not Disturb Policy" });
    expect(mockAssistant.conversation.send).not.toHaveBeenCalled();
  });

  it("explains that questions are not available yet for a document that is still being prepared", async () => {
    mockGet.mockResolvedValue({ data: fresh });
    const { findByTestId, queryByTestId } = renderWithTheme(<SopDetailScreen />);
    expect(await findByTestId("sop-ask-unavailable")).toBeTruthy();
    expect(queryByTestId("sop-question-keyPoints")).toBeNull();
    expect(queryByTestId("sop-open-original")).toBeTruthy(); // reading the original never depends on the assistant
  });

  it("shows a retired or withdrawn procedure as unavailable and never from a saved copy", async () => {
    await writeSopCache("h1:u1", [dnd], Date.now());
    mockGet.mockRejectedValue(new ApiError("SOP document not found.", 404));
    const { findByText, queryByTestId } = renderWithTheme(<SopDetailScreen />);
    expect(await findByText(/no longer available/)).toBeTruthy();
    expect(queryByTestId("sop-detail-title")).toBeNull();
  });

  it("offline: shows the saved record, marked as saved, with no questions and no original to open", async () => {
    await writeSopCache("h1:u1", [dnd], Date.now() - 2 * 3_600_000);
    useAppStore.setState({ isOnline: false });
    const { findByTestId, queryByTestId, getByTestId } = renderWithTheme(<SopDetailScreen />);
    expect(await findByTestId("sop-detail-cache")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
    expect(queryByTestId("sop-question-keyPoints")).toBeNull();
    expect(getByTestId("sop-ask-unavailable").props.children).toMatch(/need a connection/);
    expect(getByTestId("sop-open-original").props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId("sop-open-offline")).toBeTruthy();
  });

  it("uses a different person's saved record for nobody", async () => {
    await writeSopCache("h2:other", [dnd], Date.now());
    useAppStore.setState({ isOnline: false });
    const { findByText } = renderWithTheme(<SopDetailScreen />);
    expect(await findByText(/offline and no procedures are saved/)).toBeTruthy();
  });
});
