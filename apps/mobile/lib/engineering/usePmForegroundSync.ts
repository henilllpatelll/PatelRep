import { useEffect } from "react";
import { AppState } from "react-native";
import { useAppStore } from "@/stores/appStore";
import { flushPmCompletions } from "./pmSyncRunner";

/**
 * Tries the saved PM inspections when the app comes back to the foreground. The shared sync only fires on a network
 * change, so a phone that never lost its connection (or reconnected while backgrounded) would otherwise wait for the
 * next change. The flush is single-flight, honours the retry backoff and does nothing offline or signed out, so
 * repeated foreground events cannot start parallel or repeated requests. This is a foreground retry only: nothing runs
 * while the app is closed.
 */
export function usePmForegroundSync(): void {
  const userId = useAppStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void flushPmCompletions();
    });
    return () => subscription.remove();
  }, [userId]);
}
