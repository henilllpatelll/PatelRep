import { useCallback, useRef } from "react";
import { router } from "expo-router";

/** A second tap on the same destination inside this window is the same intent, not a second screen. */
export const HOME_NAV_LOCK_MS = 700;

/** Route identity for the lock: path plus params, ignoring the per-tap `nav` stamp that is meant to differ every time. */
export function routeKey(route: unknown): string {
  if (typeof route === "string") return route;
  if (route && typeof route === "object" && "pathname" in route) {
    const { pathname, params } = route as { pathname: unknown; params?: Record<string, unknown> };
    const { nav: _nav, ...rest } = params ?? {};
    return `${String(pathname)}?${JSON.stringify(rest)}`;
  }
  return JSON.stringify(route);
}

/**
 * Home's one navigation entry point. A double tap (or a tap landing while the push animation is still running) opens the
 * destination once, so the back stack never holds duplicates; a different destination is never blocked.
 */
export function useHomeNavigate(now: () => number = Date.now) {
  const last = useRef<{ key: string; at: number } | null>(null);
  return useCallback(
    (route: unknown) => {
      if (!route) return;
      const key = routeKey(route);
      const at = now();
      const prev = last.current;
      if (prev && prev.key === key && at - prev.at < HOME_NAV_LOCK_MS) return;
      last.current = { key, at };
      router.push(route as never);
    },
    [now],
  );
}
