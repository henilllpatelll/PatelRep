import { create } from "zustand";
import {
  DEFAULT_PREFS,
  loadAppLockPrefs,
  saveAppLockPrefs,
  type AppLockPrefs,
  type LockTimeoutMs,
} from "@/lib/security/appLockPrefs";

/**
 * Optional biometric/device-credential lock over an ALREADY signed-in session. It is not a login: the
 * Supabase session is untouched while locked, and unsynced work keeps syncing underneath.
 *
 * When it locks:
 *  - cold start of an app whose person turned the lock on (a fresh sign-in is exempt: they just proved
 *    who they are);
 *  - returning from the background after at least `timeoutMs` away ("Immediately" = any time away);
 *  - foreground idling for `timeoutMs` (checked on a light interval, foreground only).
 * Our own system prompts (biometric, photo picker, camera) are wrapped in `runWithoutAppLock` so they
 * do not count as leaving the app.
 */
interface AppLockState extends AppLockPrefs {
  userId: string | null;
  hydrated: boolean;
  locked: boolean;
  /** Cover the screen in the app switcher while the app is not active. */
  obscured: boolean;
  backgroundedAt: number | null;
  lastActivityAt: number;
  suppressDepth: number;
  skipNextColdLock: boolean;

  hydrate: (userId: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setTimeoutMs: (timeoutMs: LockTimeoutMs) => Promise<void>;
  lock: () => void;
  unlock: () => void;
  /** Call after a password / magic-link / recovery sign-in so the next hydrate does not lock. */
  markFreshSignIn: () => void;
  onInactive: () => void;
  onBackground: () => void;
  onForeground: () => void;
  touch: () => void;
  checkIdle: () => void;
  reset: () => void;
}

const initial = {
  ...DEFAULT_PREFS,
  userId: null,
  hydrated: false,
  locked: false,
  obscured: false,
  backgroundedAt: null,
  suppressDepth: 0,
  skipNextColdLock: false,
};

export const useAppLockStore = create<AppLockState>((set, get) => ({
  ...initial,
  lastActivityAt: Date.now(),

  hydrate: async (userId) => {
    if (get().userId === userId && get().hydrated) return;
    const prefs = await loadAppLockPrefs(userId);
    const lockNow = prefs.enabled && !get().skipNextColdLock;
    set({ ...prefs, userId, hydrated: true, locked: lockNow, skipNextColdLock: false, lastActivityAt: Date.now() });
  },

  setEnabled: async (enabled) => {
    const { userId, timeoutMs } = get();
    if (!userId) throw new Error("no user");
    await saveAppLockPrefs(userId, { enabled, timeoutMs });
    set({ enabled, locked: false, lastActivityAt: Date.now() });
  },

  setTimeoutMs: async (timeoutMs) => {
    const { userId, enabled } = get();
    if (!userId) throw new Error("no user");
    await saveAppLockPrefs(userId, { enabled, timeoutMs });
    set({ timeoutMs });
  },

  lock: () => {
    if (get().enabled) set({ locked: true });
  },
  unlock: () => set({ locked: false, obscured: false, backgroundedAt: null, lastActivityAt: Date.now() }),
  // Also clears a lock that a faster hydrate may already have applied for this very sign-in.
  markFreshSignIn: () => set({ skipNextColdLock: true, locked: false }),

  onInactive: () => {
    if (get().enabled && get().suppressDepth === 0) set({ obscured: true });
  },
  onBackground: () => {
    const s = get();
    if (!s.enabled || s.suppressDepth > 0) return;
    set({ obscured: true, backgroundedAt: s.backgroundedAt ?? Date.now() });
  },
  onForeground: () => {
    const s = get();
    set({ obscured: false });
    if (s.enabled && s.backgroundedAt !== null && s.suppressDepth === 0) {
      if (Date.now() - s.backgroundedAt >= s.timeoutMs) set({ locked: true });
    }
    set({ backgroundedAt: null, lastActivityAt: Date.now() });
  },

  touch: () => {
    if (!get().locked) set({ lastActivityAt: Date.now() });
  },
  checkIdle: () => {
    const s = get();
    if (!s.enabled || s.locked || s.suppressDepth > 0 || s.timeoutMs === 0) return;
    if (Date.now() - s.lastActivityAt >= s.timeoutMs) set({ locked: true });
  },

  reset: () => set({ ...initial, lastActivityAt: Date.now() }),
}));

/**
 * Run something that briefly takes the app out of the foreground by design (OS biometric prompt,
 * photo picker, camera) without it counting as leaving the app.
 */
export async function runWithoutAppLock<T>(work: () => Promise<T>): Promise<T> {
  useAppLockStore.setState((s) => ({ suppressDepth: s.suppressDepth + 1 }));
  try {
    return await work();
  } finally {
    useAppLockStore.setState((s) => ({
      suppressDepth: Math.max(0, s.suppressDepth - 1),
      backgroundedAt: null,
      obscured: false,
      lastActivityAt: Date.now(),
    }));
  }
}
