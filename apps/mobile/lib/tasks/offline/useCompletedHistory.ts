import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCompletedPage, type Task } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { fetchDoneToday, type DoneToday } from "@/lib/tasks/workQueue";
import { mergeHistory } from "@/lib/tasks/offline/history";
import { readTaskCache, saveDoneToday, saveHistoryFirstPage } from "@/lib/tasks/offline/taskCache";

/* Server-authoritative completed history with a saved first page for offline.
   * Page 1 is always re-read from the server when there is a connection; the saved copy (labelled with
     the time it was last synced) only stands in while that is impossible.
   * Later pages need a connection; a failed page never discards what is already shown.
   * Responses that arrive after a refresh / scope switch are dropped (token), so stale data never wins.
   * Done today is the server's count for the hotel-local day, never a local counter. */

export type HistoryStatus = "loading" | "ready" | "error";

interface Options {
  isOnline: boolean;
  scope: string | null;
  zone: string | null;
}

const PAGE = 30;

export function useCompletedHistory({ isOnline, scope, zone }: Options) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<HistoryStatus>("loading");
  const [fromCache, setFromCache] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState<"offline" | "failed" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState<{ value: DoneToday | null; failed: boolean }>({ value: null, failed: false });

  const token = useRef(0);
  /** Live page 1 / Done today already arrived for the current scope: a saved copy read later must not replace it. */
  const liveHistory = useRef(false);
  const liveDone = useRef(false);
  const online = useRef(isOnline);
  online.current = isOnline;
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadFirst = useCallback(async () => {
    if (!scope) return;
    const mine = ++token.current;
    const ok = () => mounted.current && token.current === mine;
    try {
      const page = await fetchCompletedPage(null, PAGE);
      if (!ok()) return;
      liveHistory.current = true;
      setTasks(mergeHistory([], page.tasks));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setFromCache(false);
      setSyncedAt(new Date().toISOString());
      setMoreFailed(null);
      setStatus("ready");
      void saveHistoryFirstPage(scope, { tasks: page.tasks, nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch {
      if (!ok()) return;
      // Keep whatever is on screen (saved copy or earlier live data); only an empty screen is an error.
      setStatus((current) => (current === "ready" ? current : "error"));
    }
    try {
      const value = await fetchDoneToday(zoneRef.current);
      if (!ok()) return;
      liveDone.current = true;
      setDone({ value, failed: false });
      const day = hotelDateKey(new Date(), zoneRef.current);
      if (day) void saveDoneToday(scope, value, day);
    } catch {
      if (ok()) setDone((prev) => ({ value: prev.value, failed: true }));
    }
  }, [scope]);

  // Switching person / hotel: drop everything, show only this scope's saved copy, then go live.
  useEffect(() => {
    token.current += 1;
    liveHistory.current = false;
    liveDone.current = false;
    setTasks([]);
    setStatus("loading");
    setFromCache(false);
    setSyncedAt(null);
    setCursor(null);
    setHasMore(false);
    setMoreFailed(null);
    setDone({ value: null, failed: false });
    if (!scope) return;
    let live = true;
    void readTaskCache(scope).then((cache) => {
      if (!live) return;
      if (cache.history && !liveHistory.current) {
        const saved = cache.history;
        setTasks(mergeHistory([], saved.tasks));
        setCursor(saved.nextCursor);
        setHasMore(saved.hasMore);
        setFromCache(true);
        setSyncedAt(saved.syncedAt);
        setStatus("ready");
      }
      const day = hotelDateKey(new Date(), zoneRef.current ?? cache.hotelTimezone);
      if (cache.doneToday && day && cache.doneToday.day === day && !liveDone.current) {
        const savedDone = cache.doneToday;
        setDone((prev) => (prev.value ? prev : { value: { count: savedDone.count, atLeast: savedDone.atLeast }, failed: true }));
      }
    });
    void loadFirst();
    return () => {
      live = false;
    };
  }, [scope, loadFirst]);

  // Reconnecting replaces the saved copy with live data.
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) void loadFirst();
    wasOnline.current = isOnline;
  }, [isOnline, loadFirst]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !scope) return;
    if (!online.current) {
      setMoreFailed("offline");
      return;
    }
    // Only a live listing has a cursor worth following; a saved first page is replaced first.
    const mine = token.current;
    setLoadingMore(true);
    setMoreFailed(null);
    try {
      const page = await fetchCompletedPage(cursor, PAGE);
      if (!mounted.current || token.current !== mine) return;
      setTasks((prev) => mergeHistory(prev, page.tasks));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (mounted.current && token.current === mine) setMoreFailed("failed");
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, scope, cursor]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirst();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [loadFirst]);

  const retry = useCallback(() => {
    setStatus("loading");
    void loadFirst();
  }, [loadFirst]);

  return { tasks, status, fromCache, syncedAt, hasMore, loadingMore, moreFailed, refreshing, done, loadMore, refresh, retry };
}
