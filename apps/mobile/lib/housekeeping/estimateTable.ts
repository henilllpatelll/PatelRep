import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api } from "@/lib/api/client";

/* ─── Learned cleaning-time table ───────────────────────────────────────────
   The API returns, per room type and clean type, a "usually about N minutes" figure learned from this
   hotel's own completed cleans — only where it beat the hotel's baseline on newer cleans (the server
   decides; nothing here ranks, rates or reorders anything). The table is hotel-level aggregates: no
   person, room or guest information.

   It lives on the phone per signed-in person and hotel, is replaced on account change, ignored once it is
   older than a week (the baseline is shown instead), and refreshed at most every few hours. A missing,
   damaged or unreachable table simply means "no learned figure": every screen falls back to the same
   baseline it showed before. Nothing in this file calls an AI model or spends credits. */

export const ESTIMATES_PATH = "/clean-sessions/estimates";
export const ESTIMATE_STORAGE_PREFIX = "patelrep.cleaning-estimates.v1.";
/** After this long a stored table is no longer trusted. */
export const ESTIMATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A usable table is not re-fetched sooner than this. */
export const ESTIMATE_REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

const CLEAN_TYPES = ["DEP", "FULL", "LIGHT"];

export interface LearnedEstimate {
  minutes: number;
  samples: number;
}

export function estimateKey(roomTypeCode: string, cleanType: string): string {
  return `${roomTypeCode.trim().toUpperCase()}|${cleanType}`;
}

export function estimateStorageKey(scope: string): string {
  return `${ESTIMATE_STORAGE_PREFIX}${scope.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** Whatever came back, reduced to entries that make sense. Anything else is dropped, never guessed at. */
export function parseEstimates(raw: unknown): Record<string, LearnedEstimate> {
  const list = (raw as { estimates?: unknown } | null | undefined)?.estimates;
  if (!Array.isArray(list)) return {};
  const out: Record<string, LearnedEstimate> = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { room_type_code, clean_type, minutes, sample_count } = item as Record<string, unknown>;
    if (typeof room_type_code !== "string" || !room_type_code.trim()) continue;
    if (typeof clean_type !== "string" || !CLEAN_TYPES.includes(clean_type)) continue;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 3 || minutes > 240) continue;
    out[estimateKey(room_type_code, clean_type)] = {
      minutes: Math.round(minutes),
      samples: typeof sample_count === "number" && sample_count > 0 ? Math.round(sample_count) : 0,
    };
  }
  return out;
}

interface Stored {
  fetchedAt: number;
  entries: Record<string, LearnedEstimate>;
}

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { fetchedAt?: unknown; entries?: unknown };
    if (typeof value.fetchedAt !== "number" || !value.entries || typeof value.entries !== "object") return null;
    // Re-validate through the same reader: a damaged value must not become an estimate.
    const entries: Record<string, LearnedEstimate> = {};
    for (const [key, entry] of Object.entries(value.entries as Record<string, unknown>)) {
      const e = entry as Partial<LearnedEstimate> | null;
      if (e && typeof e.minutes === "number" && e.minutes >= 3 && e.minutes <= 240) {
        entries[key] = { minutes: Math.round(e.minutes), samples: typeof e.samples === "number" && e.samples > 0 ? e.samples : 0 };
      }
    }
    return { fetchedAt: value.fetchedAt, entries };
  } catch {
    return null;
  }
}

interface EstimateTableState {
  scope: string | null;
  entries: Record<string, LearnedEstimate>;
  fetchedAt: number | null;
  /** Bumps whenever the usable table changes, so memoised room models recompute exactly then. */
  version: number;
  hydrate: (scope: string | null) => Promise<void>;
  refresh: (scope: string | null, options?: { force?: boolean; now?: number }) => Promise<boolean>;
}

const inflight = new Map<string, Promise<boolean>>();

export const useEstimateTable = create<EstimateTableState>((set, get) => ({
  scope: null,
  entries: {},
  fetchedAt: null,
  version: 0,

  hydrate: async (scope) => {
    if (!scope) {
      set((state) => ({ scope: null, entries: {}, fetchedAt: null, version: state.version + 1 }));
      return;
    }
    if (get().scope === scope) return;
    // Empty first: nothing from the previous person or hotel can show while this one loads.
    set((state) => ({ scope, entries: {}, fetchedAt: null, version: state.version + 1 }));
    let stored: Stored | null = null;
    try {
      stored = parseStored(await AsyncStorage.getItem(estimateStorageKey(scope)));
    } catch {
      stored = null;
    }
    if (get().scope !== scope || !stored) return;
    set((state) => ({ entries: stored.entries, fetchedAt: stored.fetchedAt, version: state.version + 1 }));
  },

  refresh: async (scope, options = {}) => {
    if (!scope || get().scope !== scope) return false;
    const now = options.now ?? Date.now();
    const { fetchedAt } = get();
    if (!options.force && fetchedAt !== null && now - fetchedAt >= 0 && now - fetchedAt < ESTIMATE_REFRESH_AFTER_MS) return false;
    const existing = inflight.get(scope);
    if (existing) return existing;
    const run = (async () => {
      try {
        const response = await api.get<{ data?: unknown }>(ESTIMATES_PATH);
        if (get().scope !== scope) return false; // the account changed while loading
        const entries = parseEstimates(response?.data);
        set((state) => ({ entries, fetchedAt: now, version: state.version + 1 }));
        try {
          await AsyncStorage.setItem(estimateStorageKey(scope), JSON.stringify({ fetchedAt: now, entries }));
        } catch {
          /* a table that cannot be saved is simply fetched again next time */
        }
        return true;
      } catch {
        return false; // offline, role, outage: keep whatever is usable; the baseline needs nothing
      } finally {
        inflight.delete(scope);
      }
    })();
    inflight.set(scope, run);
    return run;
  },
}));

/** The learned figure for a room type + clean type, or null (no table, too old, or not learned). */
export function lookupLearned(roomTypeCode: string | null | undefined, cleanType: string | null | undefined, now: number = Date.now()): LearnedEstimate | null {
  if (!roomTypeCode || !cleanType) return null;
  const { entries, fetchedAt } = useEstimateTable.getState();
  if (fetchedAt === null || now - fetchedAt > ESTIMATE_MAX_AGE_MS) return null;
  return entries[estimateKey(roomTypeCode, cleanType)] ?? null;
}

/** Subscribe a screen's memoised room model to table changes. */
export function useEstimateVersion(): number {
  return useEstimateTable((state) => state.version);
}
