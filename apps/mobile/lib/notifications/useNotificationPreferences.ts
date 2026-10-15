import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getNotificationPreferences,
  setNotificationPreference,
  type NotificationPreference,
} from "@/lib/api/notifications";

export type PreferencesStatus = "loading" | "ready" | "error";

export interface PreferenceItem extends NotificationPreference {
  /** A write for this switch is in flight or queued behind one. */
  saving: boolean;
  /** The last write for this switch was refused or never answered; `enabled` shows the last SAVED value. */
  failed: boolean;
}

interface Options {
  /** `${hotel}:${user}`: keeps the non-sensitive on/off cache per person. Without it nothing is cached. */
  scope: string | null;
  /** Re-read when the role the server evaluates changes (the visible categories depend on it). */
  role: string | undefined;
  online: boolean;
}

const cacheKey = (scope: string) => `@patelrep/notif_prefs/v1/${scope}`;

/**
 * The signed-in person's push preferences, kept honest:
 *  - every switch shows the SERVER'S confirmed value, except while its own write is in flight (then the
 *    value being saved) - a failed write snaps back to the confirmed value and says so;
 *  - quick repeated toggles are coalesced: at most one request per switch is in flight, and when it
 *    returns the latest intent is sent, so an older request can never overwrite a newer choice;
 *  - nothing is written on load, so a default is never saved over an explicit choice;
 *  - the last confirmed list is cached per person so the screen still renders when the server cannot be reached.
 */
export function useNotificationPreferences({ scope, role, online }: Options) {
  const [status, setStatus] = useState<PreferencesStatus>("loading");
  const [items, setItems] = useState<PreferenceItem[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const catalog = useRef<NotificationPreference[]>([]);
  const confirmed = useRef(new Map<string, boolean>());
  const desired = useRef(new Map<string, boolean>());
  const writing = useRef(new Set<string>());
  const mounted = useRef(true);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<PreferenceItem>) => {
    if (!mounted.current) return;
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }, []);

  const adopt = useCallback((list: NotificationPreference[]) => {
    catalog.current = list;
    confirmed.current = new Map(list.map((p) => [p.key, p.enabled]));
    desired.current = new Map(confirmed.current);
    if (mounted.current) setItems(list.map((p) => ({ ...p, saving: false, failed: false })));
  }, []);

  const load = useCallback(async () => {
    if (mounted.current) setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const list = await getNotificationPreferences();
      adopt(list);
      if (mounted.current) {
        setFromCache(false);
        setStatus("ready");
      }
      if (scope) await AsyncStorage.setItem(cacheKey(scope), JSON.stringify(list)).catch(() => undefined);
    } catch {
      let cached: NotificationPreference[] | null = null;
      if (scope) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey(scope));
          cached = raw ? (JSON.parse(raw) as NotificationPreference[]) : null;
        } catch {
          cached = null;
        }
      }
      if (!mounted.current) return;
      if (cached && cached.length > 0) {
        adopt(cached);
        setFromCache(true);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    }
  }, [adopt, scope]);

  // Load on mount and whenever the evaluated role or the person changes.
  useEffect(() => {
    void load();
  }, [load, role]);

  const flush = useCallback(
    async (key: string) => {
      if (writing.current.has(key)) return; // the running loop will pick up the newest intent
      writing.current.add(key);
      try {
        // Re-read the intent after every await: a toggle made mid-request is sent next, never lost.
        for (;;) {
          const want = desired.current.get(key);
          if (want === undefined || want === confirmed.current.get(key)) break;
          try {
            await setNotificationPreference(key, want);
            confirmed.current.set(key, want);
          } catch {
            const last = confirmed.current.get(key) ?? !want;
            desired.current.set(key, last);
            patch(key, { enabled: last, saving: false, failed: true });
            return;
          }
        }
        patch(key, { saving: false, failed: false });
        if (mounted.current) {
          setJustSaved(true);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => mounted.current && setJustSaved(false), 2500);
        }
        if (scope) {
          const snapshot = catalog.current.map((p) => ({ ...p, enabled: confirmed.current.get(p.key) ?? p.enabled }));
          await AsyncStorage.setItem(cacheKey(scope), JSON.stringify(snapshot)).catch(() => undefined);
        }
      } finally {
        writing.current.delete(key);
      }
    },
    [patch, scope],
  );

  const setEnabled = useCallback(
    (key: string, enabled: boolean) => {
      if (!online) return;
      desired.current.set(key, enabled);
      setJustSaved(false);
      patch(key, { enabled, saving: true, failed: false });
      void flush(key);
    },
    [flush, online, patch],
  );

  /** Re-send the choice that failed (the switch shows the saved value, so retry means "try the opposite"). */
  const retry = useCallback(
    (key: string) => {
      const current = confirmed.current.get(key);
      if (current === undefined) return;
      setEnabled(key, !current);
    },
    [setEnabled],
  );

  return { status, items, fromCache, justSaved, setEnabled, retry, reload: load };
}
