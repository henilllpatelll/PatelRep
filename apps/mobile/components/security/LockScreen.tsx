import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { authenticate, type AuthResult } from "@/lib/security/biometrics";
import { useTheme } from "@/lib/theme/useTheme";
import { runWithoutAppLock, useAppLockStore } from "@/stores/appLockStore";

/** The product name is a brand, not translated copy. */
const BRAND_NAME = "PatelRep";

/**
 * Covers the whole app while locked. Shows no names, rooms or guest data. The OS prompt (biometric,
 * with the device passcode as its own fallback) is offered once automatically and then only on request,
 * so cancelling never loops. "Sign out" is always available as the way out.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<AuthResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const inFlight = useRef(false);

  const unlock = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const outcome = await runWithoutAppLock(() => authenticate(t("lock.prompt"), t("common.cancel")));
      if (outcome === "success") useAppLockStore.getState().unlock();
      else setResult(outcome);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void unlock();
    // Offer the prompt once when the lock appears; afterwards only on the button.
  }, []);

  const message =
    result === "unavailable"
      ? t("lock.unavailable")
      : result === "failed"
        ? t("lock.failed")
        : result === "cancelled"
          ? t("lock.cancelled")
          : null;

  return (
    <View
      style={[styles.root, { backgroundColor: theme.shell.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      accessibilityViewIsModal
      testID="lock-screen"
    >
      <View style={styles.center}>
        <View style={[styles.mark, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}>
          <Ionicons name="lock-closed" size={30} color={theme.shell.ink} />
        </View>
        <Text accessibilityRole="header" style={[styles.brand, { color: theme.shell.ink }]}>
          {BRAND_NAME}
        </Text>
        <Text style={[styles.title, { color: theme.shell.ink }]}>{t("lock.title")}</Text>
        <Text style={[styles.body, { color: theme.shell.ink2 }]}>{t("lock.body")}</Text>
        {message ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.shell.ink }]} testID="lock-message">
            {message}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button label={t("lock.unlock")} icon="finger-print" onPress={() => void unlock()} loading={busy} testID="lock-unlock" />
        <Button label={t("profile.signOut")} variant="ghost" onPress={() => setSignOutOpen(true)} testID="lock-signout" />
      </View>
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </View>
  );
}

/** Opaque cover for the app-switcher snapshot while the app is not active. */
export function PrivacyCover() {
  const theme = useTheme();
  return (
    <View style={[styles.root, styles.center, { backgroundColor: theme.shell.bg }]} testID="privacy-cover">
      <Ionicons name="lock-closed" size={30} color={theme.shell.ink3} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  mark: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  brand: { fontSize: 22, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", marginTop: 6 },
  body: { fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  message: { fontSize: 13.5, lineHeight: 19, textAlign: "center", marginTop: 10, maxWidth: 320 },
  actions: { gap: 8 },
});
