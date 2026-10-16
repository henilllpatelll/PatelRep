import { useCallback, useEffect, useRef, useState } from "react";
import { listLibrary, type SOPDocument } from "@/lib/api/sop";
import { assistantScope } from "@/lib/ai/session";
import { readSopCache, writeSopCache } from "@/lib/sop/offlineCache";
import { useAppStore } from "@/stores/appStore";

export interface SopLibraryState {
  docs: SOPDocument[];
  loading: boolean;
  refreshing: boolean;
  /** Nothing could be loaded, live or saved. */
  failed: boolean;
  /** The list on screen is the copy saved on this phone (the server could not be reached). */
  fromCache: boolean;
  /** When that saved copy was made. */
  savedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * The procedures this person may read. The live list always wins; when the server cannot be reached the copy
 * saved on this phone for THIS person and hotel is shown and clearly marked as saved. Ordinary reading never
 * depends on the assistant.
 */
export function useSopLibrary(): SopLibraryState {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const scope = assistantScope(user);
  const [docs, setDocs] = useState<SOPDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = (latest.current += 1);
    const current = () => latest.current === mine;
    const fallBack = async () => {
      const snapshot = await readSopCache(scope);
      if (!current()) return;
      if (snapshot) {
        setDocs(snapshot.docs);
        setFromCache(true);
        setSavedAt(snapshot.savedAt);
        setFailed(false);
      } else {
        setDocs([]);
        setFromCache(false);
        setSavedAt(null);
        setFailed(true);
      }
    };
    if (!isOnline) {
      await fallBack();
      return;
    }
    try {
      const res = await listLibrary();
      if (!current()) return;
      const list = Array.isArray(res.data) ? res.data : [];
      setDocs(list);
      setFromCache(false);
      setSavedAt(null);
      setFailed(false);
      void writeSopCache(scope, list);
    } catch {
      await fallBack();
    }
  }, [scope, isOnline]);

  // A different person or hotel never inherits the previous list.
  useEffect(() => {
    setDocs([]);
    setFromCache(false);
    setSavedAt(null);
    setFailed(false);
    setLoading(true);
    const expected = latest.current + 1;
    void load().finally(() => {
      if (latest.current === expected) setLoading(false);
    });
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { docs, loading, refreshing, failed, fromCache, savedAt, refresh };
}
