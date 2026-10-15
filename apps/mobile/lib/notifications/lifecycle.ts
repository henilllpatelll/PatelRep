import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import type { UserRole } from "@/lib/supabase";
import { getUnreadCount } from "@/lib/api/notifications";
import { useAppStore } from "@/stores/appStore";
import { resolveNotificationTarget, routeForTarget } from "./deepLink";
import { canReceivePush, getPushPermissionState } from "./permissions";
import { setupPushNotifications, syncPushRegistration } from "./registration";

const UNREAD_POLL_MS = 60_000;
const FOREGROUND_RECHECK_MS = 60 * 60 * 1000;
const MAX_REMEMBERED_TAPS = 50;

// One tap can arrive twice (the cold-start read and the listener). Remember what was already opened.
const handledTaps: string[] = [];

function alreadyHandled(identifier: string): boolean {
  if (handledTaps.includes(identifier)) return true;
  handledTaps.push(identifier);
  if (handledTaps.length > MAX_REMEMBERED_TAPS) handledTaps.shift();
  return false;
}

/**
 * The ONE place a notification tap becomes navigation (the app has a single listener, installed once the
 * person is signed in). Handles taps while foregrounded, backgrounded, and the tap that cold-started the
 * app. The payload is validated against the closed route list in deepLink.ts; an unrecognised one opens
 * nothing.
 */
export function useNotificationResponses(enabled: boolean, role: UserRole | undefined): void {
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    if (!enabled) return;

    const open = (response: Notifications.NotificationResponse) => {
      if (alreadyHandled(response.notification.request.identifier)) return;
      const target = resolveNotificationTarget(response.notification.request.content.data, roleRef.current);
      const route = routeForTarget(target);
      if (route) router.push(route as never);
    };

    // Cold start: the app was opened BY the tap, which never reaches the listener. Handle it once, then
    // clear it so the next launch does not replay the same tap.
    Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (!last) return;
        open(last);
        return Notifications.clearLastNotificationResponseAsync?.();
      })
      .catch(console.warn);

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [enabled]);
}

/**
 * Keeps this phone registered for the signed-in person: once per person at sign-in/launch (not on every
 * role change), again when the OS rotates the token, and when the app returns to the foreground after an
 * hour (covers a permission switched on in system settings meanwhile).
 */
export function usePushRegistration(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    void setupPushNotifications(userId).catch(console.warn);

    const tokenSubscription = Notifications.addPushTokenListener?.(() => {
      void syncPushRegistration(userId, { force: true });
    });

    let lastCheck = Date.now();
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active" || Date.now() - lastCheck < FOREGROUND_RECHECK_MS) return;
      lastCheck = Date.now();
      void getPushPermissionState().then((permission) => {
        if (canReceivePush(permission)) void syncPushRegistration(userId);
      });
    });

    return () => {
      tokenSubscription?.remove();
      appState.remove();
    };
  }, [userId]);
}

/**
 * The inbox badge: the exact unread count from the server, refreshed every minute while the app is in
 * the foreground and immediately when it returns to the foreground (no polling in the background), and
 * mirrored to the app icon badge where the OS allows it.
 */
export function useUnreadBadge(enabled: boolean): void {
  const setUnreadCount = useAppStore((state) => state.setUnreadCount);
  const unreadCount = useAppStore((state) => state.unreadCount);
  const userId = useAppStore((state) => state.user?.id);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    // A late answer for a person who has since signed out must not repaint the next person's badge.
    let cancelled = false;
    const poll = () => {
      getUnreadCount()
        .then((count) => {
          if (!cancelled) setUnreadCount(count);
        })
        .catch(() => undefined);
    };
    const start = () => {
      poll();
      if (!timer) timer = setInterval(poll, UNREAD_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    // "unknown" can be reported briefly at launch; only an explicit background state pauses polling.
    if (AppState.currentState !== "background") start();
    const subscription = AppState.addEventListener("change", (state) => (state === "active" ? start() : stop()));
    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [enabled, userId, setUnreadCount]);

  useEffect(() => {
    if (!enabled) return;
    void Notifications.setBadgeCountAsync?.(unreadCount)?.catch(() => undefined);
  }, [enabled, unreadCount]);
}
