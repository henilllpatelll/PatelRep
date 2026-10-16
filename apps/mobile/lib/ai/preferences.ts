import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { speechLocale, type SpeechLocale } from "@/lib/voice/locale";
import { onAssistantSessionReset } from "@/lib/ai/session";

/* ─── AI & voice preferences ────────────────────────────────────────────────
   Four choices, each wired to something real:

     voiceInput         off hides every microphone entry point (typing still works)
     suggestions        off hides the assistant's suggested questions and quick actions
     assistantLanguage  the language AI-written text is requested in ("app" = follow the app)
     speechLanguage     the language the microphone listens in ("app" = follow the app)

   They live on this phone, scoped to the signed-in person and hotel (`${tenant}:${user}`), so a shared
   device never shows one person's choices to another. They are conveniences, not records: nothing here
   is sent to the server, and the language of SOP documents and operational records is never changed by
   them (translations stay labelled copies). A missing or damaged value falls back to the default. */

export type LanguageChoice = "app" | "en" | "es";

export interface AiPreferences {
  voiceInput: boolean;
  suggestions: boolean;
  assistantLanguage: LanguageChoice;
  speechLanguage: LanguageChoice;
}

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  voiceInput: true,
  suggestions: true,
  assistantLanguage: "app",
  speechLanguage: "app",
};

export const AI_PREFERENCES_KEY_PREFIX = "patelrep.ai.prefs.v1.";

export function aiPreferencesKey(scope: string): string {
  return `${AI_PREFERENCES_KEY_PREFIX}${scope.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

const isChoice = (value: unknown): value is LanguageChoice => value === "app" || value === "en" || value === "es";

/** Whatever was stored, reduced to valid values. Unknown or wrongly typed fields fall back to the default. */
export function parseAiPreferences(raw: string | null | undefined): AiPreferences {
  if (!raw) return { ...DEFAULT_AI_PREFERENCES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_AI_PREFERENCES };
  }
  const value = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return {
    voiceInput: typeof value.voiceInput === "boolean" ? value.voiceInput : DEFAULT_AI_PREFERENCES.voiceInput,
    suggestions: typeof value.suggestions === "boolean" ? value.suggestions : DEFAULT_AI_PREFERENCES.suggestions,
    assistantLanguage: isChoice(value.assistantLanguage) ? value.assistantLanguage : DEFAULT_AI_PREFERENCES.assistantLanguage,
    speechLanguage: isChoice(value.speechLanguage) ? value.speechLanguage : DEFAULT_AI_PREFERENCES.speechLanguage,
  };
}

function appLanguageOf(language: string | null | undefined): "en" | "es" {
  return (language ?? "en").toLowerCase().startsWith("es") ? "es" : "en";
}

/** The language AI-written text (assistant answers, briefing and recap wording) is requested in. */
export function resolveAssistantLanguage(prefs: Pick<AiPreferences, "assistantLanguage">, appLanguage: string | null | undefined): "en" | "es" {
  return prefs.assistantLanguage === "app" ? appLanguageOf(appLanguage) : prefs.assistantLanguage;
}

/** The speech-recognition locale the microphone should use. */
export function resolveSpeechLocale(prefs: Pick<AiPreferences, "speechLanguage">, appLanguage: string | null | undefined): SpeechLocale {
  return speechLocale(prefs.speechLanguage === "app" ? appLanguage : prefs.speechLanguage);
}

/** Microphone entry points are shown only when the phone can listen AND the person has not turned voice off. */
export function isVoiceEnabled(prefs: Pick<AiPreferences, "voiceInput">, speechAvailable: boolean): boolean {
  return speechAvailable && prefs.voiceInput;
}

/* ─── Store ─────────────────────────────────────────────────────────────────── */

interface AiPreferencesState extends AiPreferences {
  scope: string | null;
  hydrated: boolean;
  /** The last save did not reach the phone's storage (the choice still applies until the app closes). */
  saveFailed: boolean;
  /** Load this person's choices; switching person or hotel drops the previous person's values first. */
  hydrate: (scope: string | null) => Promise<void>;
  update: (patch: Partial<AiPreferences>) => Promise<void>;
  /** Sign-out / account change: back to defaults, nothing carried over. */
  reset: () => void;
}

const initial = { ...DEFAULT_AI_PREFERENCES, scope: null as string | null, hydrated: false, saveFailed: false };

export const useAiPreferences = create<AiPreferencesState>((set, get) => ({
  ...initial,

  hydrate: async (scope) => {
    if (!scope) {
      set({ ...initial });
      return;
    }
    if (get().scope === scope && get().hydrated) return;
    // Defaults first: nothing from the previous person can show while this person's values load.
    set({ ...DEFAULT_AI_PREFERENCES, scope, hydrated: false, saveFailed: false });
    let stored: string | null = null;
    try {
      stored = await AsyncStorage.getItem(aiPreferencesKey(scope));
    } catch {
      stored = null;
    }
    if (get().scope !== scope) return; // the account changed while loading
    set({ ...parseAiPreferences(stored), hydrated: true });
  },

  update: async (patch) => {
    const { scope } = get();
    if (!scope) return;
    const next: AiPreferences = { ...pick(get()), ...patch };
    set({ ...next, saveFailed: false });
    try {
      await AsyncStorage.setItem(aiPreferencesKey(scope), JSON.stringify(next));
    } catch {
      if (get().scope === scope) set({ saveFailed: true });
    }
  },

  reset: () => set({ ...initial }),
}));

// A sign-out or account switch drops the previous person's choices at once, before the next person's load.
onAssistantSessionReset(() => useAiPreferences.getState().reset());

function pick(state: AiPreferences): AiPreferences {
  return {
    voiceInput: state.voiceInput,
    suggestions: state.suggestions,
    assistantLanguage: state.assistantLanguage,
    speechLanguage: state.speechLanguage,
  };
}

/** Current choices for code that is not a React component (request builders). */
export function currentAiPreferences(): AiPreferences {
  return pick(useAiPreferences.getState());
}
