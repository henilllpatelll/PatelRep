import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { RefreshReason } from "@/lib/engineering/refreshGate";

/**
 * Re-reads when the app comes back to the foreground and when the connection returns. The tab stays "focused" while the app
 * sits in the background, so neither would otherwise trigger the screen-focus refresh.
 *  - foreground → a "focus" hint: skipped when the data was read in the last few seconds;
 *  - offline → online → a "manual" read: the last attempt probably failed, so freshness is not a reason to wait.
 * Both go through the same refresh gate as everything else, so they can never double a read already in flight.
 */
export function useRefreshOnResume(isOnline: boolean | undefined, onResume: (reason: RefreshReason) => void): void {
  const latest = useRef(onResume);
  latest.current = onResume;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") latest.current("focus");
    });
    return () => subscription.remove();
  }, []);

  const online = isOnline !== false;
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) latest.current("manual");
    wasOnline.current = online;
  }, [online]);
}
