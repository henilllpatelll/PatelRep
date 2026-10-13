import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { entriesForCurrentUser, useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { taskScope } from "@/lib/tasks/offline/taskCache";

/**
 * Keeps the outbox moving while the Tasks screen is mounted: load it for the signed-in person, flush
 * when the connection returns, and wake once for the earliest scheduled retry. (Coming back to the
 * foreground is handled by useWorkQueue's single AppState listener.) The flush itself is single-flight
 * and bounded: entries that are not due, and an empty outbox, cause no request at all.
 */
export function useTaskOutboxSync(isOnline: boolean) {
  const scope = taskScope(useAppStore((state) => state.user));
  const entries = useTaskOutbox((state) => entriesForCurrentUser(state));

  useEffect(() => {
    if (!scope) return;
    void useTaskOutbox.getState().hydrate().then((ready) => {
      if (ready && useAppStore.getState().isOnline) void useTaskOutbox.getState().flush();
    });
  }, [scope]);

  useEffect(() => {
    if (isOnline && scope) void useTaskOutbox.getState().flush();
  }, [isOnline, scope]);

  // One timer for the earliest backoff that is still in the future.
  useEffect(() => {
    if (!isOnline) return;
    const times = Object.values(entries)
      .filter((entry) => entry.state === "pending" && entry.nextAttemptAt)
      .map((entry) => new Date(entry.nextAttemptAt as string).getTime())
      .filter((at) => !Number.isNaN(at));
    if (times.length === 0) return;
    const wait = Math.max(1_000, Math.min(...times) - Date.now());
    const id = setTimeout(() => void useTaskOutbox.getState().flush(), wait);
    return () => clearTimeout(id);
  }, [entries, isOnline]);
}
