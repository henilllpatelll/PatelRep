import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  canReceivePush,
  getPushPermissionState,
  openDeviceNotificationSettings,
  requestPushPermission,
  type PushPermissionState,
} from "./permissions";
import { syncPushRegistration } from "./registration";

/**
 * The OS permission for this phone, read fresh each time the screen is shown and each time the app returns
 * from system settings (the person may have changed it there). It is never inferred from a saved setting.
 */
export function usePushPermission(userId: string | undefined) {
  const [state, setState] = useState<PushPermissionState | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getPushPermissionState();
    if (mounted.current) setState(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") void refresh();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [refresh]);

  /** Ask the OS (only while it will still ask) and, if allowed, register this phone for this person. */
  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const next = await requestPushPermission();
      if (mounted.current) setState(next);
      if (canReceivePush(next) && userId) await syncPushRegistration(userId, { force: true });
      return next;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [userId]);

  return { state, busy, enable, openSettings: openDeviceNotificationSettings, refresh };
}
