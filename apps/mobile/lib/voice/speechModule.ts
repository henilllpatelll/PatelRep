// expo-speech-recognition is a native module — unavailable in Expo Go.
// Shared optional-load so every mic-capable surface (full chat screen, the
// copilot bubble's long-press-to-talk) degrades the same way when it's absent.
export type SpeechEventHandler = (e: { results: Array<{ transcript: string }> }) => void;

let _speechModule: { start: (opts: Record<string, unknown>) => void; stop: () => void } | null = null;
let _useSpeechRecognitionEvent: (
  event: string,
  handler: SpeechEventHandler | (() => void),
) => void = () => {};

try {
  const mod = require("expo-speech-recognition");
  _speechModule = mod.ExpoSpeechRecognitionModule;
  _useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch {
  // Not available in Expo Go — voice capture UI hides itself
}

export const speechModule = _speechModule;
export const useSpeechRecognitionEvent = _useSpeechRecognitionEvent;
