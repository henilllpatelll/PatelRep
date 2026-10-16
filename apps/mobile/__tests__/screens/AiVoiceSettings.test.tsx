import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en", resolvedLanguage: "en" } }) };
});
jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let mockSpeechAvailable = true;
const mockRequestPermission = jest.fn();
jest.mock("@/lib/voice/speechModule", () => ({
  speechModule: null,
  isSpeechAvailable: () => mockSpeechAvailable,
  useSpeechRecognitionEvent: jest.fn(),
}));

const mockApiCalls = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: { get: (...a: unknown[]) => mockApiCalls(...a), post: (...a: unknown[]) => mockApiCalls(...a), put: (...a: unknown[]) => mockApiCalls(...a) },
}));

const mockLoadHistory = jest.fn();
jest.mock("@/lib/ai/history", () => ({
  loadHistory: (...a: unknown[]) => mockLoadHistory(...a),
  clearHistory: jest.fn().mockResolvedValue(undefined),
}));

const mockClearHistory = jest.fn();
const mockStartFresh = jest.fn();
let mockProvider = true;
jest.mock("@/lib/ai/AssistantProvider", () => ({
  useAssistantOptional: () =>
    mockProvider ? { conversation: { clearHistory: (...a: unknown[]) => mockClearHistory(...a) }, startFresh: (...a: unknown[]) => mockStartFresh(...a) } : null,
}));

import AiVoiceSettingsScreen from "@/app/(app)/profile/ai-voice";
import { DEFAULT_AI_PREFERENCES, aiPreferencesKey, useAiPreferences } from "@/lib/ai/preferences";
import { useAppStore } from "@/stores/appStore";

const SCOPE = "hotel-1:user-1";

async function renderScreen(hydrate = true) {
  if (hydrate) await useAiPreferences.getState().hydrate(SCOPE);
  const screen = render(
    <ThemeProvider>
      <AiVoiceSettingsScreen />
    </ThemeProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return screen;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSpeechAvailable = true;
  mockProvider = true;
  mockLoadHistory.mockResolvedValue([]);
  mockClearHistory.mockResolvedValue(undefined);
  useAiPreferences.getState().reset();
  useAppStore.setState({ user: { id: "user-1", tenant_id: "hotel-1", role: "housekeeper" } as never });
});

describe("AI & voice settings", () => {
  it("waits for the saved choices instead of flashing defaults", async () => {
    const { queryByTestId } = await renderScreen(false);
    expect(queryByTestId("ai-voice-input")).toBeNull();
  });

  it("says plainly that AI suggests and explains and actions need approval", async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId("ai-voice-about").props.children).toMatch(/needs your approval/);
  });

  it("turns voice input off and remembers it for this person and hotel", async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId("ai-voice-input").props.accessibilityState.checked).toBe(true);
    fireEvent.press(getByTestId("ai-voice-input"));
    await waitFor(() => expect(useAiPreferences.getState().voiceInput).toBe(false));
    expect(JSON.parse((await AsyncStorage.getItem(aiPreferencesKey(SCOPE))) as string).voiceInput).toBe(false);
    expect(getByTestId("ai-voice-input").props.accessibilityState.checked).toBe(false);
  });

  it("restores the saved choices when the screen is opened again", async () => {
    await AsyncStorage.setItem(aiPreferencesKey(SCOPE), JSON.stringify({ ...DEFAULT_AI_PREFERENCES, suggestions: false, speechLanguage: "es", assistantLanguage: "en" }));
    const { getByTestId } = await renderScreen();
    expect(getByTestId("ai-suggestions").props.accessibilityState.checked).toBe(false);
    expect(getByTestId("ai-speech-es").props.accessibilityState.selected).toBe(true);
    expect(getByTestId("ai-answer-en").props.accessibilityState.selected).toBe(true);
    expect(getByTestId("ai-answer-app").props.accessibilityState.selected).toBe(false);
  });

  it("changes the speech and answer languages independently", async () => {
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("ai-speech-es"));
    fireEvent.press(getByTestId("ai-answer-en"));
    await waitFor(() => expect(useAiPreferences.getState()).toMatchObject({ speechLanguage: "es", assistantLanguage: "en" }));
  });

  it("disables voice and explains why when the phone cannot recognise speech", async () => {
    mockSpeechAvailable = false;
    const { getByTestId } = await renderScreen();
    const row = getByTestId("ai-voice-input");
    expect(row.props.accessibilityState.disabled).toBe(true);
    expect(row.props.accessibilityLabel).toMatch(/isn't available on this phone/);
  });

  it("says when a choice could not be stored", async () => {
    const { getByTestId, queryByTestId } = await renderScreen();
    expect(queryByTestId("ai-voice-save-failed")).toBeNull();
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("full"));
    fireEvent.press(getByTestId("ai-suggestions"));
    await waitFor(() => expect(getByTestId("ai-voice-save-failed")).toBeTruthy());
  });

  it("offers no proactive AI notification switch, because nothing would back it", async () => {
    const { queryByText } = await renderScreen();
    expect(queryByText(/proactive/i)).toBeNull();
  });

  it("opening it requests no permission and makes no request to the server", async () => {
    await renderScreen();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockApiCalls).not.toHaveBeenCalled();
  });
});

describe("conversation privacy", () => {
  it("shows what is really saved on this phone", async () => {
    mockLoadHistory.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId("ai-history").props.accessibilityLabel).toMatch(/3 messages saved on this phone/));
    expect(mockLoadHistory).toHaveBeenCalledWith(SCOPE);
  });

  it("reads nothing saved as nothing, not as a count of zero messages", async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId("ai-history").props.accessibilityLabel).toMatch(/Nothing saved/));
  });

  it("explains exactly what clearing does and does not remove, then clears through the assistant's own controller", async () => {
    mockLoadHistory.mockResolvedValueOnce([{ id: "1" }]).mockResolvedValue([]);
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId("ai-history").props.accessibilityLabel).toMatch(/1 message saved/));
    fireEvent.press(getByTestId("ai-history"));
    expect(getByTestId("ai-clear-not").props.children).toMatch(/usage record/);
    expect(mockClearHistory).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(getByTestId("ai-clear-confirm"));
    });
    await waitFor(() => expect(mockClearHistory).toHaveBeenCalledTimes(1));
    expect(mockStartFresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId("ai-history-cleared")).toBeTruthy());
  });

  it("clears nothing when the person cancels", async () => {
    mockLoadHistory.mockResolvedValue([{ id: "1" }]);
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId("ai-history").props.accessibilityLabel).toMatch(/1 message/));
    fireEvent.press(getByTestId("ai-history"));
    fireEvent.press(getByTestId("ai-clear-cancel"));
    expect(mockClearHistory).not.toHaveBeenCalled();
  });

  it("starting a new conversation clears the on-screen and saved copy together", async () => {
    const { getByTestId } = await renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId("ai-new-conversation"));
    });
    await waitFor(() => expect(mockClearHistory).toHaveBeenCalledTimes(1));
    expect(mockStartFresh).toHaveBeenCalledTimes(1);
  });

  it("states what the app cannot delete rather than promising it", async () => {
    const { getByTestId, getAllByText } = await renderScreen();
    fireEvent.press(getByTestId("ai-privacy"));
    expect(getAllByText(/can't delete/i).length).toBeGreaterThanOrEqual(2);
  });

  it("reads the saved copy for this person and hotel only", async () => {
    await renderScreen();
    expect(mockLoadHistory).not.toHaveBeenCalledWith("hotel-2:user-9");
    expect(mockLoadHistory.mock.calls.every(([scope]) => scope === SCOPE)).toBe(true);
  });
});
