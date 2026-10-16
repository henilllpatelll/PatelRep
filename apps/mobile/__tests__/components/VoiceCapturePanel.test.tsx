import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

type Handler = (event: Record<string, unknown>) => void;
const mockHandlers: Record<string, Handler> = {};
const mockSpeech = {
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  isRecognitionAvailable: jest.fn(() => true),
};
let mockSpeechValue: typeof mockSpeech | null = mockSpeech;
let mockLang = "en";
const mockOpenSettings = jest.fn();

jest.mock("@/lib/voice/speechModule", () => ({
  get speechModule() {
    return mockSpeechValue;
  },
  useSpeechRecognitionEvent: (name: string, handler: Handler) => {
    mockHandlers[name] = handler;
  },
  isSpeechAvailable: () => mockSpeechValue !== null,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.language ? `${key}:${options.language}` : key),
    i18n: { language: mockLang, resolvedLanguage: mockLang },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { Linking } from "react-native";
import { VoiceCapturePanel } from "@/components/voice/VoiceCapturePanel";

function renderPanel(props: Partial<React.ComponentProps<typeof VoiceCapturePanel>> = {}) {
  const onUse = jest.fn();
  const onClose = jest.fn();
  const screen = render(
    <ThemeProvider>
      <VoiceCapturePanel maxChars={500} onUse={onUse} onClose={onClose} {...props} />
    </ThemeProvider>,
  );
  return { screen, onUse, onClose };
}

const emit = (name: string, event: Record<string, unknown> = {}) => act(() => mockHandlers[name]?.(event));
const result = (transcript: string, isFinal: boolean) => emit("result", { results: [{ transcript }], isFinal });

async function startListening(screen: ReturnType<typeof renderPanel>["screen"]) {
  await act(async () => {
    fireEvent.press(screen.getByTestId("voice-toggle"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockHandlers).forEach((key) => delete mockHandlers[key]);
  mockSpeechValue = mockSpeech;
  mockLang = "en";
  mockSpeech.requestPermissionsAsync.mockResolvedValue({ granted: true });
  mockSpeech.isRecognitionAvailable.mockReturnValue(true);
  jest.spyOn(Linking, "openSettings").mockImplementation(mockOpenSettings);
});

describe("VoiceCapturePanel — permission and availability", () => {
  it("asks for the microphone before listening", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    expect(mockSpeech.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockSpeech.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-status").props.children).toBe("assistant.voice.listening");
  });

  it("explains a refusal, never starts listening, and offers the phone settings", async () => {
    mockSpeech.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const { screen } = renderPanel();
    await startListening(screen);
    expect(mockSpeech.start).not.toHaveBeenCalled();
    expect(screen.getByTestId("voice-status").props.children).toBe("assistant.voice.denied");
    fireEvent.press(screen.getByTestId("voice-open-settings"));
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  it("does not crash where the native module is missing (Expo Go): says so, and typing still works", () => {
    mockSpeechValue = null;
    const { screen, onUse } = renderPanel();
    expect(screen.getByTestId("voice-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("voice-toggle")).toBeNull();
    fireEvent.changeText(screen.getByTestId("voice-text"), "Typed instead");
    fireEvent.press(screen.getByTestId("voice-use"));
    expect(onUse).toHaveBeenCalledWith("Typed instead");
  });

  it("treats a device whose speech service is unavailable like a missing module", () => {
    mockSpeech.isRecognitionAvailable.mockReturnValue(false);
    const { screen } = renderPanel();
    expect(screen.getByTestId("voice-unavailable")).toBeTruthy();
  });
});

describe("VoiceCapturePanel — language", () => {
  it("listens in English for English", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "en-US", continuous: false }));
  });

  it("listens in Spanish for a Spanish speaker, never in English", async () => {
    mockLang = "es";
    const { screen } = renderPanel();
    await startListening(screen);
    expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "es-US" }));
  });

  it("follows an explicit language over the app default", async () => {
    const { screen } = renderPanel({ language: "es" });
    await startListening(screen);
    expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "es-US" }));
  });

  it("never asks for the audio to be recorded or kept", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    expect(mockSpeech.start.mock.calls[0][0]).not.toHaveProperty("recordingOptions");
  });

  it("starts by itself only when asked to (the person just pressed a microphone button)", async () => {
    const quiet = renderPanel();
    await act(async () => {});
    expect(mockSpeech.start).not.toHaveBeenCalled();
    quiet.screen.unmount();

    renderPanel({ autoStart: true });
    await act(async () => {});
    expect(mockSpeech.start).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceCapturePanel — start, stop and what was heard", () => {
  it("moves listening -> processing on stop, then shows the text for review without sending it", async () => {
    const { screen, onUse } = renderPanel();
    await startListening(screen);
    fireEvent.press(screen.getByTestId("voice-toggle"));
    expect(mockSpeech.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-status").props.children).toBe("assistant.voice.processing");

    result("Room 312 has a leaking sink", true);
    emit("end");
    expect(screen.getByTestId("voice-text").props.value).toBe("Room 312 has a leaking sink");
    expect(onUse).not.toHaveBeenCalled();
  });

  it("shows partial words while listening but does not treat them as a result, and blocks Use text until done", async () => {
    const { screen, onUse } = renderPanel();
    await startListening(screen);
    result("Room 31", false);
    expect(screen.getByTestId("voice-text").props.value).toBe("Room 31");
    expect(screen.getByTestId("voice-use").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("voice-use"));
    expect(onUse).not.toHaveBeenCalled();
  });

  it("adds a repeated final callback only once", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    result("Need more towels", true);
    result("Need more towels", true);
    emit("end");
    expect(screen.getByTestId("voice-text").props.value).toBe("Need more towels");
  });

  it("lets the person edit the words, and uses the edited text exactly once", async () => {
    const { screen, onUse } = renderPanel();
    await startListening(screen);
    result("Room 312 has a leaking skin", true);
    emit("end");
    fireEvent.changeText(screen.getByTestId("voice-text"), "Room 312 has a leaking sink");
    fireEvent.press(screen.getByTestId("voice-use"));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("Room 312 has a leaking sink");
  });

  it("keeps what was heard when the person speaks again, instead of replacing it", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    result("First part", true);
    emit("end");
    await startListening(screen);
    result("second part", true);
    emit("end");
    expect(screen.getByTestId("voice-text").props.value).toBe("First part second part");
  });

  it("disables Use text when there is nothing to use", () => {
    const { screen, onUse } = renderPanel();
    fireEvent.press(screen.getByTestId("voice-use"));
    expect(onUse).not.toHaveBeenCalled();
  });

  it("closes without using anything on cancel", () => {
    const { screen, onUse, onClose } = renderPanel();
    fireEvent.press(screen.getByTestId("voice-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });
});

describe("VoiceCapturePanel — errors and cleanup", () => {
  it.each([
    ["no-speech", "assistant.voice.nospeech"],
    ["speech-timeout", "assistant.voice.nospeech"],
    ["not-allowed", "assistant.voice.denied"],
    ["service-not-allowed", "assistant.voice.denied"],
    ["network", "assistant.voice.error"],
  ])("maps the %s error to a clear, recoverable state", async (code, key) => {
    const { screen } = renderPanel();
    await startListening(screen);
    emit("error", { error: code });
    expect(screen.getByTestId("voice-status").props.children).toBe(key);
    // Recoverable: the microphone button can be pressed again.
    expect(screen.getByTestId("voice-toggle").props.accessibilityState.busy).toBeFalsy();
  });

  it("returns to the start when the engine reports it was aborted", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    emit("error", { error: "aborted" });
    expect(screen.getByTestId("voice-status").props.children).toBe("assistant.voice.tapToSpeak");
  });

  it("releases the microphone when the panel goes away mid-listening", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    screen.unmount();
    expect(mockSpeech.abort).toHaveBeenCalledTimes(1);
  });

  it("ignores speech events that arrive after it stopped listening", async () => {
    const { screen } = renderPanel();
    await startListening(screen);
    emit("error", { error: "no-speech" });
    result("Late words", true);
    expect(screen.getByTestId("voice-text").props.value).toBe("");
  });
});
