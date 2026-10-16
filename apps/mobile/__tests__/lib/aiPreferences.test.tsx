import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/lib/voice/speechModule", () => ({
  speechModule: {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    isRecognitionAvailable: () => true,
  },
  isSpeechAvailable: () => true,
  useSpeechRecognitionEvent: jest.fn(),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", resolvedLanguage: "en" } }) }));

import {
  DEFAULT_AI_PREFERENCES,
  aiPreferencesKey,
  currentAiPreferences,
  isVoiceEnabled,
  parseAiPreferences,
  resolveAssistantLanguage,
  resolveSpeechLocale,
  useAiPreferences,
} from "@/lib/ai/preferences";
import { useVoiceInput } from "@/lib/tasks/addTask/useVoiceInput";
import { useVoiceCapability } from "@/lib/voice/useVoiceCapability";

const mockSpeech = jest.requireMock("@/lib/voice/speechModule").speechModule as {
  start: jest.Mock;
  requestPermissionsAsync: jest.Mock;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSpeech.requestPermissionsAsync.mockResolvedValue({ granted: true });
  jest.clearAllMocks();
  useAiPreferences.getState().reset();
});

describe("parseAiPreferences", () => {
  it("falls back to the defaults for nothing, damage or wrong types", () => {
    expect(parseAiPreferences(null)).toEqual(DEFAULT_AI_PREFERENCES);
    expect(parseAiPreferences("{not json")).toEqual(DEFAULT_AI_PREFERENCES);
    expect(parseAiPreferences(JSON.stringify({ voiceInput: "yes", suggestions: 1, assistantLanguage: "fr", speechLanguage: null }))).toEqual(DEFAULT_AI_PREFERENCES);
    expect(parseAiPreferences(JSON.stringify([1, 2]))).toEqual(DEFAULT_AI_PREFERENCES);
  });

  it("keeps valid values and ignores unknown fields", () => {
    const raw = JSON.stringify({ voiceInput: false, suggestions: false, assistantLanguage: "es", speechLanguage: "en", extra: "x" });
    expect(parseAiPreferences(raw)).toEqual({ voiceInput: false, suggestions: false, assistantLanguage: "es", speechLanguage: "en" });
  });
});

describe("language resolution", () => {
  it("follows the app language unless the person chose one", () => {
    expect(resolveAssistantLanguage({ assistantLanguage: "app" }, "es-MX")).toBe("es");
    expect(resolveAssistantLanguage({ assistantLanguage: "app" }, "fr")).toBe("en");
    expect(resolveAssistantLanguage({ assistantLanguage: "en" }, "es")).toBe("en");
    expect(resolveSpeechLocale({ speechLanguage: "app" }, "es")).toBe("es-US");
    expect(resolveSpeechLocale({ speechLanguage: "es" }, "en")).toBe("es-US");
    expect(resolveSpeechLocale({ speechLanguage: "en" }, "es")).toBe("en-US");
  });

  it("offers a microphone only when the phone can listen and voice is on", () => {
    expect(isVoiceEnabled({ voiceInput: true }, true)).toBe(true);
    expect(isVoiceEnabled({ voiceInput: false }, true)).toBe(false);
    expect(isVoiceEnabled({ voiceInput: true }, false)).toBe(false);
  });
});

describe("useAiPreferences store", () => {
  it("restores a person's saved choices", async () => {
    await AsyncStorage.setItem(aiPreferencesKey("hotel-1:user-1"), JSON.stringify({ ...DEFAULT_AI_PREFERENCES, assistantLanguage: "es", suggestions: false }));
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    expect(useAiPreferences.getState()).toMatchObject({ hydrated: true, assistantLanguage: "es", suggestions: false, voiceInput: true });
  });

  it("persists a change under that person and hotel only", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    await useAiPreferences.getState().update({ voiceInput: false });
    expect(JSON.parse((await AsyncStorage.getItem(aiPreferencesKey("hotel-1:user-1"))) as string).voiceInput).toBe(false);
    expect(await AsyncStorage.getItem(aiPreferencesKey("hotel-1:user-2"))).toBeNull();
    expect(await AsyncStorage.getItem(aiPreferencesKey("hotel-2:user-1"))).toBeNull();
  });

  it("never shows one person's choices to the next person on the same phone", async () => {
    await AsyncStorage.setItem(aiPreferencesKey("hotel-1:user-1"), JSON.stringify({ ...DEFAULT_AI_PREFERENCES, voiceInput: false, speechLanguage: "es" }));
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    expect(useAiPreferences.getState().voiceInput).toBe(false);
    await useAiPreferences.getState().hydrate("hotel-1:user-2");
    expect(currentAiPreferences()).toEqual(DEFAULT_AI_PREFERENCES);
    await useAiPreferences.getState().hydrate(null);
    expect(useAiPreferences.getState()).toMatchObject({ scope: null, hydrated: false, voiceInput: true });
  });

  it("applies a choice for the session and says so when the phone could not store it", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    const spy = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    await useAiPreferences.getState().update({ suggestions: false });
    expect(useAiPreferences.getState()).toMatchObject({ suggestions: false, saveFailed: true });
    spy.mockRestore();
  });

  it("does nothing without a signed-in scope", async () => {
    await useAiPreferences.getState().update({ voiceInput: false });
    expect(useAiPreferences.getState().voiceInput).toBe(true);
  });

  it("ignores a load that finishes after the account changed", async () => {
    await AsyncStorage.setItem(aiPreferencesKey("hotel-1:user-1"), JSON.stringify({ ...DEFAULT_AI_PREFERENCES, voiceInput: false }));
    const first = useAiPreferences.getState().hydrate("hotel-1:user-1");
    await useAiPreferences.getState().hydrate("hotel-1:user-2");
    await first;
    expect(useAiPreferences.getState().scope).toBe("hotel-1:user-2");
    expect(useAiPreferences.getState().voiceInput).toBe(true);
  });
});

describe("voice entry points follow the preferences", () => {
  it("useVoiceInput offers no microphone when voice is off and keeps typing unaffected", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    const { result } = renderHook(() => useVoiceInput({ language: "en", onTranscript: jest.fn() }));
    expect(result.current.supported).toBe(true);
    await act(async () => {
      await useAiPreferences.getState().update({ voiceInput: false });
    });
    expect(result.current.supported).toBe(false);
  });

  it("listens in the chosen speech language, in task creation and reports alike", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    await useAiPreferences.getState().update({ speechLanguage: "es" });
    const { result } = renderHook(() => useVoiceInput({ language: "en", onTranscript: jest.fn() }));
    await act(async () => {
      await result.current.toggle();
    });
    expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "es-US" }));
  });

  it("follows the app language when no speech language was chosen", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    const { result } = renderHook(() => useVoiceInput({ language: "es", onTranscript: jest.fn() }));
    await act(async () => {
      await result.current.toggle();
    });
    expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "es-US" }));
  });

  it("does not ask for the microphone permission until the person starts listening", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    renderHook(() => useVoiceInput({ language: "en", onTranscript: jest.fn() }));
    renderHook(() => useVoiceCapability());
    expect(mockSpeech.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("useVoiceCapability reports why a microphone is missing", async () => {
    await useAiPreferences.getState().hydrate("hotel-1:user-1");
    await useAiPreferences.getState().update({ voiceInput: false });
    const { result } = renderHook(() => useVoiceCapability());
    expect(result.current).toMatchObject({ available: true, enabled: false, offByChoice: true, locale: "en-US" });
  });
});
