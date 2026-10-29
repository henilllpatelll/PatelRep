// Expo Go does not bundle expo-speech-recognition, so its JS entry throws while resolving the native module
// ("Cannot find native module 'ExpoSpeechRecognition'"). The app must treat that as "no voice" and keep running.
jest.mock("expo-speech-recognition", () => {
  throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
});

import { isSpeechAvailable, speechModule, useSpeechRecognitionEvent } from "@/lib/voice/speechModule";

describe("speechModule without the native module (Expo Go)", () => {
  it("loads without throwing and reports no speech module", () => {
    expect(speechModule).toBeNull();
  });

  it("reports speech as unavailable so microphone controls stay hidden", () => {
    expect(isSpeechAvailable()).toBe(false);
  });

  it("keeps the event hook callable as a no-op", () => {
    expect(() => useSpeechRecognitionEvent("result", () => undefined)).not.toThrow();
  });
});
