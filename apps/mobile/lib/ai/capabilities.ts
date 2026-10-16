import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api } from "@/lib/api/client";
import { onAssistantSessionReset } from "@/lib/ai/session";

/* ─── Which optional AI features this hotel has switched on ─────────────────
   An operator turns each optional AI feature on or off per hotel (the existing tenant feature flags). The
   phone asks once per sign-in and again when the app returns after a while, keeps the last answer for this
   person + hotel, and treats "not known yet" as OFF — so a switched-off or unreachable feature never leaves
   a button that goes nowhere, and starting the app never waits on the AI service.

   This only decides what to SHOW. Photo analysis and task translation are also refused by the server when
   switched off, and every paid call is still subject to the hotel's AI credit cap. Manual alternatives
   (typing a task, reporting an issue yourself, reading the original instructions) never depend on any of this. */

export type AiCapability = "unifiedAssistant" | "photoAnalysis" | "taskTranslation";
export type AiCapabilities = Record<AiCapability, boolean>;

export const CAPABILITIES_PATH = "/ai/capabilities";
export const CAPABILITIES_STORAGE_PREFIX = "patelrep.ai.capabilities.v1.";
/** A stored answer older than this is no longer trusted: everything reads as off until a fresh one arrives. */
export const CAPABILITIES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Do not ask again sooner than this unless forced. */
export const CAPABILITIES_REFRESH_AFTER_MS = 10 * 60 * 1000;

export const NO_CAPABILITIES: AiCapabilities = { unifiedAssistant: false, photoAnalysis: false, taskTranslation: false };

const WIRE: Record<AiCapability, string> = {
  unifiedAssistant: "unified_assistant",
  photoAnalysis: "photo_analysis",
  taskTranslation: "task_translation",
};

export function capabilitiesStorageKey(scope: string): string {
  return `${CAPABILITIES_STORAGE_PREFIX}${scope.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** Only an explicit `true` switches a capability on; anything else (missing, wrong type) is off. */
export function parseCapabilities(raw: unknown): AiCapabilities {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    unifiedAssistant: value[WIRE.unifiedAssistant] === true,
    photoAnalysis: value[WIRE.photoAnalysis] === true,
    taskTranslation: value[WIRE.taskTranslation] === true,
  };
}

interface CapabilitiesState {
  scope: string | null;
  capabilities: AiCapabilities;
  fetchedAt: number | null;
  hydrate: (scope: string | null) => Promise<void>;
  refresh: (scope: string | null, options?: { force?: boolean; now?: number }) => Promise<boolean>;
}

const inflight = new Map<string, Promise<boolean>>();

export const useAiCapabilities = create<CapabilitiesState>((set, get) => ({
  scope: null,
  capabilities: NO_CAPABILITIES,
  fetchedAt: null,

  hydrate: async (scope) => {
    if (!scope) {
      set({ scope: null, capabilities: NO_CAPABILITIES, fetchedAt: null });
      return;
    }
    if (get().scope === scope) return;
    // Off first: nothing from the previous person or hotel can show while this one loads.
    set({ scope, capabilities: NO_CAPABILITIES, fetchedAt: null });
    let stamp: number | null = null;
    let saved: Record<string, unknown> = {};
    try {
      const raw = await AsyncStorage.getItem(capabilitiesStorageKey(scope));
      const parsed = raw ? (JSON.parse(raw) as { fetchedAt?: unknown; capabilities?: unknown }) : null;
      if (parsed && typeof parsed.fetchedAt === "number") {
        stamp = parsed.fetchedAt;
        saved = parsed.capabilities && typeof parsed.capabilities === "object" ? (parsed.capabilities as Record<string, unknown>) : {};
      }
    } catch {
      stamp = null;
    }
    if (get().scope !== scope || stamp === null) return;
    if (Date.now() - stamp > CAPABILITIES_MAX_AGE_MS) return;
    const asWire = Object.fromEntries((Object.keys(WIRE) as AiCapability[]).map((key) => [WIRE[key], saved[key] === true]));
    set({ capabilities: parseCapabilities(asWire), fetchedAt: stamp });
  },

  refresh: async (scope, options = {}) => {
    if (!scope || get().scope !== scope) return false;
    const now = options.now ?? Date.now();
    const { fetchedAt } = get();
    if (!options.force && fetchedAt !== null && now - fetchedAt >= 0 && now - fetchedAt < CAPABILITIES_REFRESH_AFTER_MS) return false;
    const existing = inflight.get(scope);
    if (existing) return existing;
    const run = (async () => {
      try {
        const response = await api.get<{ data?: unknown }>(CAPABILITIES_PATH);
        if (get().scope !== scope) return false; // the account changed while loading
        const capabilities = parseCapabilities(response?.data);
        set({ capabilities, fetchedAt: now });
        try {
          await AsyncStorage.setItem(capabilitiesStorageKey(scope), JSON.stringify({ fetchedAt: now, capabilities }));
        } catch {
          /* an answer that cannot be saved is simply asked for again */
        }
        return true;
      } catch {
        return false; // offline or the service is down: keep the last answer, or stay off
      } finally {
        inflight.delete(scope);
      }
    })();
    inflight.set(scope, run);
    return run;
  },
}));

// A sign-out or account switch drops the previous person's answers at once (not on the next render's effect).
onAssistantSessionReset(() => useAiCapabilities.setState({ scope: null, capabilities: NO_CAPABILITIES, fetchedAt: null }));

/** Whether one optional AI feature is switched on for this person's hotel. Unknown reads as off. */
export function useAiCapability(name: AiCapability): boolean {
  return useAiCapabilities((state) => state.capabilities[name]);
}
