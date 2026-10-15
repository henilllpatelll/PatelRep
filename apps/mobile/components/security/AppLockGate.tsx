import { useEffect } from "react";
import { AppState, Modal, View } from "react-native";
import { LockScreen, PrivacyCover } from "@/components/security/LockScreen";
import { useAppLockStore } from "@/stores/appLockStore";

const IDLE_CHECK_MS = 10_000;

/**
 * Wraps the signed-in app. Tracks foreground/background and touch activity for the lock policy and
 * shows the lock screen (or a privacy cover) over everything. The cover is a native Modal so it also
 * sits above any sheet that happened to be open. While locked the content underneath is hidden from
 * screen readers and receives no touches; it stays mounted, so navigation state, drafts and background
 * sync are not disturbed.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const locked = useAppLockStore((s) => s.locked);
  const obscured = useAppLockStore((s) => s.obscured);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const lock = useAppLockStore.getState();
      if (state === "active") lock.onForeground();
      else if (state === "background") lock.onBackground();
      else lock.onInactive();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => useAppLockStore.getState().checkIdle(), IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <View
      style={{ flex: 1 }}
      // Observes every touch for the idle timer without ever claiming the gesture.
      onStartShouldSetResponderCapture={() => {
        useAppLockStore.getState().touch();
        return false;
      }}
    >
      <View
        style={{ flex: 1 }}
        pointerEvents={locked ? "none" : "auto"}
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      <Modal
        visible={locked || obscured}
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        {locked ? <LockScreen /> : <PrivacyCover />}
      </Modal>
    </View>
  );
}
