import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { classifyAuthError } from "@/lib/auth/authErrors";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppLockStore } from "@/stores/appLockStore";
import { Button } from "@/components/ui/Button";

/**
 * Landing route for magic-link and password-recovery emails (patelrep://auth/callback).
 * Supabase PKCE returns a one-time `code`; it is exchanged here, once, with the verifier that only this
 * device holds. Codes and tokens are never logged or shown. Provider errors arrive as `error`/`error_code`.
 */
export default function AuthCallback() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_code?: string;
    error_description?: string;
  }>();
  const handled = useRef(false);
  const [failure, setFailure] = useState<"linkExpired" | "generic" | null>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    async function handleCallback() {
      const { code, error, error_code } = params;

      if (error || error_code) {
        setFailure(error_code === "otp_expired" || error === "access_denied" ? "linkExpired" : "generic");
        return;
      }
      if (!code) {
        setFailure("generic");
        return;
      }
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        setFailure(classifyAuthError(exchangeError) === "linkExpired" ? "linkExpired" : "generic");
        return;
      }
      useAppLockStore.getState().markFreshSignIn();
      // A recovery link raised PASSWORD_RECOVERY (see _layout.tsx): choose a new password first.
      if (useRecoveryStore.getState().pending) {
        router.replace("/(auth)/reset-password");
      }
      // Otherwise it was a magic link: SIGNED_IN hydrates the user and (auth)/_layout.tsx enters the app.
    }

    void handleCallback();
  }, [params]);

  if (failure) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]} testID="callback-failure">
        <Text style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header">
          {t(failure === "linkExpired" ? "auth.callback.expiredTitle" : "auth.callback.failedTitle")}
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {t(failure === "linkExpired" ? "auth.callback.expiredBody" : "auth.callback.failedBody")}
        </Text>
        <Button label={t("auth.callback.backToSignIn")} onPress={() => router.replace("/(auth)/login")} testID="callback-back" />
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: theme.background }]} testID="callback-loading">
      <ActivityIndicator size="large" color={theme.primaryAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 14 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 14.5, lineHeight: 21, textAlign: "center", marginBottom: 6 },
});
