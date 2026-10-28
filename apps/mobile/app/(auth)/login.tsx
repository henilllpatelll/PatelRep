import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { classifyAuthError, isValidEmail, normalizeEmail, type AuthFailure } from "@/lib/auth/authErrors";
import { displayFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppLockStore } from "@/stores/appLockStore";
import type { TextInputInstance } from "react-native";

type Mode = "password" | "magic";
type FieldError = "emailRequired" | "emailInvalid" | "passwordRequired";

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  // One email value survives switching between password and email-link sign-in.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("password");
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);
  const inFlight = useRef(false);

  async function handleLogin() {
    if (inFlight.current) return;
    setFailure(null);
    setLinkSent(false);

    const normalized = normalizeEmail(email);
    if (!normalized) return setFieldError("emailRequired");
    if (!isValidEmail(normalized)) return setFieldError("emailInvalid");
    if (mode === "password" && !password) return setFieldError("passwordRequired");
    setFieldError(null);

    inFlight.current = true;
    setLoading(true);
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
        if (error) throw error;
        useAppLockStore.getState().markFreshSignIn();
      } else {
        // Staff are invited by their hotel, so a link must never create a new account.
        const { error } = await supabase.auth.signInWithOtp({
          email: normalized,
          options: { emailRedirectTo: "patelrep://auth/callback", shouldCreateUser: false },
        });
        // Unknown addresses are answered exactly like known ones, so this form cannot be used to
        // discover who has an account. Only rate limits and connectivity are worth telling the person.
        const kind = error ? classifyAuthError(error) : null;
        if (kind === "rateLimited" || kind === "offline") throw error;
        setLinkSent(true);
      }
    } catch (err: unknown) {
      setFailure(classifyAuthError(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const errorKey = failure
    ? failure === "invalidCredentials" || failure === "emailNotConfirmed" || failure === "rateLimited" || failure === "offline"
      ? failure
      : "generic"
    : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="login-screen"
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logoRow}>
          <View style={[styles.logoMark, { backgroundColor: theme.shell.bg }]} testID="login-logo-mark">
            <Ionicons name="home-outline" size={17} color={theme.shell.ink} />
          </View>
          <View style={styles.logoCopy}>
            <Text style={[styles.logoText, { color: theme.textPrimary }]}>PatelRep</Text>
            <Text style={[styles.logoSub, { color: theme.textMuted }]}>{t("auth.staffSignIn")}</Text>
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: theme.primaryAction }]}>{t("auth.signInEyebrow")}</Text>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{t("auth.welcomeBack")}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {t(mode === "password" ? "auth.startShift" : "auth.magicLinkIntro")}
          </Text>
        </View>

        <View style={styles.form}>
          <AuthTextField
            icon="mail-outline"
            placeholder={t("auth.email")}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (fieldError === "emailRequired" || fieldError === "emailInvalid") setFieldError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            inputMode="email"
            returnKeyType={mode === "password" ? "next" : "send"}
            onSubmitEditing={() => (mode === "password" ? passwordRef.current?.focus() : void handleLogin())}
            invalid={fieldError === "emailRequired" || fieldError === "emailInvalid"}
            testID="email-input"
          />
          {mode === "password" ? (
            <AuthTextField
              icon="key-outline"
              placeholder={t("auth.password")}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (fieldError === "passwordRequired") setFieldError(null);
              }}
              revealable
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void handleLogin()}
              invalid={fieldError === "passwordRequired"}
              inputRef={passwordRef}
              testID="password-input"
            />
          ) : null}
        </View>

        {fieldError ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.status.dirty }]} testID="login-field-error">
            {t(`auth.errors.${fieldError}`)}
          </Text>
        ) : null}
        {errorKey ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.status.dirty }]} testID="login-error">
            {t(`auth.errors.${errorKey}`)}
          </Text>
        ) : null}
        {linkSent ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.textSecondary }]} testID="login-link-sent">
            {t("auth.magicLinkSent")}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primaryAction }]}
          onPress={() => void handleLogin()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
          activeOpacity={0.85}
          testID="login-submit"
        >
          {loading ? (
            <ActivityIndicator color={theme.onPrimary} testID="login-loading" />
          ) : (
            <>
              <Text style={[styles.primaryText, { color: theme.onPrimary }]}>
                {mode === "password" ? t("auth.login") : t("auth.magicLink")}
              </Text>
              <Ionicons name="arrow-forward" size={17} color={theme.onPrimary} />
            </>
          )}
        </TouchableOpacity>

        {mode === "password" ? (
          <Pressable
            onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: { email: normalizeEmail(email) } })}
            accessibilityRole="link"
            accessibilityLabel={t("auth.forgotPassword")}
            style={styles.linkPress}
            testID="login-forgot"
          >
            <Text style={[styles.link, { color: theme.primaryAction }]}>{t("auth.forgotPassword")}</Text>
          </Pressable>
        ) : null}

        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => {
            setMode(mode === "password" ? "magic" : "password");
            setFieldError(null);
            setFailure(null);
            setLinkSent(false);
          }}
          accessibilityRole="button"
          activeOpacity={0.85}
          testID="login-mode-toggle"
        >
          <Ionicons name={mode === "password" ? "mail-outline" : "key-outline"} size={17} color={theme.textPrimary} />
          <Text style={[styles.secondaryText, { color: theme.textPrimary }]}>
            {mode === "password" ? t("auth.signInWithEmailLink") : t("auth.signInWithPassword")}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.invite, { color: theme.textMuted }]} testID="login-invite">
          {t("auth.inviteNotice")}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flexGrow: 1, padding: 24, gap: 18 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  logoMark: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  logoCopy: { flex: 1, minWidth: 0 },
  logoText: { flexShrink: 1, fontSize: 14, fontWeight: "700" },
  logoSub: { flexShrink: 1, fontSize: 11, marginTop: 2 },
  copy: { marginTop: 26 },
  eyebrow: { flexShrink: 1, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { flexShrink: 1, fontFamily: displayFont, fontSize: 32, lineHeight: 36, marginTop: 10 },
  body: { flexShrink: 1, fontSize: 14, lineHeight: 21, marginTop: 12 },
  form: { gap: 12, marginTop: 6 },
  message: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  primaryButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { flexShrink: 1, textAlign: "center", fontSize: 15, fontWeight: "700" },
  linkPress: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontSize: 14.5, fontWeight: "700" },
  secondaryButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { flexShrink: 1, textAlign: "center", fontSize: 15, fontWeight: "700" },
  invite: { flexShrink: 1, marginTop: "auto", textAlign: "center", fontSize: 12.5, lineHeight: 18 },
});
