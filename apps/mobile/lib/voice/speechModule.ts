// expo-speech-recognition is a native module — unavailable in Expo Go.
// Shared optional-load so every mic-capable surface (full chat screen, the
// copilot bubble's long-press-to-talk) degrades the same way when it's absent.
export type SpeechEvent = {
  results: Array<{ transcript: string }>;
  isFinal?: boolean;
  /** error events: e.g. "no-speech", "not-allowed", "network", "aborted" */
  error?: string;
  message?: string;
};
export type SpeechEventHandler = (e: SpeechEvent) => void;

export type SpeechPermission = { granted: boolean; canAskAgain?: boolean };

let _speechModule: {
  start: (opts: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
  requestPermissionsAsync?: () => Promise<SpeechPermission>;
  isRecognitionAvailable?: () => boolean;
} | null = null;
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

/** True when this build can listen (the native module exists and the phone's speech service is available). */
export function isSpeechAvailable(): boolean {
  if (!speechModule) return false;
  try {
    return speechModule.isRecognitionAvailable?.() ?? true;
  } catch {
    return false;
  }
}
