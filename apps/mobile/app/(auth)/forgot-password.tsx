import { useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { Button } from "@/components/ui/Button";
import { isValidEmail, normalizeEmail, type AuthFailure } from "@/lib/auth/authErrors";
import { requestPasswordReset } from "@/lib/auth/passwordChange";
import { useTheme } from "@/lib/theme/useTheme";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [invalid, setInvalid] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    setFailure(null);
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return setInvalid(true);
    setInvalid(false);
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await requestPasswordReset(normalized);
      if (result) setFailure(result);
      else setSent(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title={t("auth.forgot.title")}
      body={t(sent ? "auth.forgot.sentBody" : "auth.forgot.body")}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/login"))}
      testID="forgot-screen"
    >
      {sent ? (
        <>
          <Text style={[styles.note, { color: theme.textMuted }]} testID="forgot-sent">
            {t("auth.forgot.sentNote")}
          </Text>
          <Button label={t("auth.callback.backToSignIn")} onPress={() => router.replace("/(auth)/login")} testID="forgot-done" />
        </>
      ) : (
        <>
          <AuthTextField
            icon="mail-outline"
            placeholder={t("auth.email")}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setInvalid(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            inputMode="email"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            invalid={invalid}
            testID="forgot-email"
          />
          {invalid ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="forgot-invalid">
              {t("auth.errors.emailInvalid")}
            </Text>
          ) : null}
          {failure ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="forgot-error">
              {t(`auth.errors.${failure === "rateLimited" || failure === "offline" ? failure : "generic"}`)}
            </Text>
          ) : null}
          <Button label={t("auth.forgot.send")} onPress={() => void submit()} loading={loading} testID="forgot-submit" />
        </>
      )}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19 },
  error: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
