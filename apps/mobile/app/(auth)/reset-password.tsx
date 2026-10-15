import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { PasswordForm } from "@/components/auth/PasswordForm";
import { Button } from "@/components/ui/Button";
import { setRecoveredPassword } from "@/lib/auth/passwordChange";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme/useTheme";

/** Final step of "Forgot password": reached only from a verified recovery link (see auth/callback). */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const pending = useRecoveryStore((s) => s.pending);
  const [done, setDone] = useState(false);

  async function cancel() {
    // Leaving without a new password must not leave a recovery session behind.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    useRecoveryStore.getState().setPending(false);
    router.replace("/(auth)/login");
  }

  if (!pending && !done) {
    // Opened without a recovery link (e.g. app restarted mid-way): nothing to reset.
    return (
      <AuthFrame title={t("auth.callback.expiredTitle")} body={t("auth.callback.expiredBody")} testID="reset-invalid">
        <Button label={t("auth.callback.backToSignIn")} onPress={() => router.replace("/(auth)/login")} testID="reset-back" />
      </AuthFrame>
    );
  }

  if (done) {
    return (
      <AuthFrame title={t("auth.reset.doneTitle")} body={t("auth.reset.doneBody")} testID="reset-done">
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark-circle" size={48} color={theme.status.ready} />
        </View>
        <Button
          label={t("auth.reset.continue")}
          // Clearing the flag lets (auth)/_layout take the signed-in person into the app.
          onPress={() => useRecoveryStore.getState().setPending(false)}
          testID="reset-continue"
        />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={t("auth.reset.title")} body={t("auth.reset.body")} testID="reset-screen">
      <PasswordForm
        requireCurrent={false}
        submitLabel={t("auth.reset.save")}
        onSubmit={async ({ next }) => {
          const failure = await setRecoveredPassword(next);
          if (!failure) setDone(true);
          return failure;
        }}
      />
      <Text
        accessibilityRole="button"
        onPress={() => void cancel()}
        style={[styles.cancel, { color: theme.textMuted }]}
        testID="reset-cancel"
      >
        {t("common.cancel")}
      </Text>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  doneIcon: { alignItems: "center", paddingVertical: 8 },
  cancel: { textAlign: "center", fontSize: 14.5, fontWeight: "700", paddingVertical: 12 },
});
