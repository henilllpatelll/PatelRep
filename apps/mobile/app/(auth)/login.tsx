import { useState } from "react";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { displayFont, monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"password" | "magic">("password");

  async function handleLogin() {
    if (!email) return;
    setLoading(true);

    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: "patelrep://auth/callback" },
        });
        if (error) throw error;
        Alert.alert("", t("auth.magicLinkSent"));
      }
    } catch (err: unknown) {
      Alert.alert(t("auth.errorTitle"), (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="login-screen"
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoRow}>
          <View
            style={[styles.logoMark, { backgroundColor: theme.shell.bg }]}
            testID="login-logo-mark"
          >
            <Ionicons name="home-outline" size={17} color={theme.shell.ink} />
          </View>
          <View style={styles.logoCopy}>
            <Text style={[styles.logoText, { color: theme.textPrimary }]}>PatelRep</Text>
            <Text style={[styles.logoSub, { color: theme.textMuted }]}>
              {t("auth.propertySubtitle", { property: "Lone Star Inn" })}
            </Text>
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: theme.primaryAction }]}>
            {t("auth.signInEyebrow")}
          </Text>
          <Text style={[styles.title, { color: theme.textPrimary }]}>
            {t("auth.welcomeBack")}
          </Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {t("auth.startShift")}
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            icon="mail-outline"
            placeholder={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            testID="email-input"
          />
          {mode === "password" ? (
            <Input
              icon="key-outline"
              placeholder={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              testID="password-input"
            />
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primaryAction }]}
          onPress={handleLogin}
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

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => setMode(mode === "password" ? "magic" : "password")}
          accessibilityRole="button"
          activeOpacity={0.85}
          testID="login-mode-toggle"
        >
          <Ionicons
            name={mode === "password" ? "phone-portrait-outline" : "mail-outline"}
            size={17}
            color={theme.textPrimary}
          />
          <Text style={[styles.secondaryText, { color: theme.textPrimary }]}>
            {mode === "password" ? t("auth.signInWithPhone") : t("auth.signInWith")}
          </Text>
        </TouchableOpacity>

        <Text
          style={[styles.invite, { color: theme.textMuted }]}
          testID="login-invite"
        >
          {t("auth.newTo")}{" "}
          <Text
            style={[styles.inviteLink, { color: theme.primaryAction }]}
            testID="login-invite-link"
          >
            {t("auth.getInviteLink")}
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input(props: ComponentProps<typeof TextInput> & { icon: ComponentProps<typeof Ionicons>["name"] }) {
  const { icon, testID, ...inputProps } = props;
  const theme = useTheme();
  return (
    <View
      style={[
        styles.inputWrap,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      testID={testID ? `${testID}-container` : undefined}
    >
      <Ionicons name={icon} size={15} color={theme.textMuted} />
      <TextInput
        {...inputProps}
        testID={testID}
        style={[styles.input, { color: theme.textPrimary }]}
        placeholderTextColor={theme.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flexGrow: 1, padding: 24, gap: 22 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  logoMark: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  logoCopy: { flex: 1, minWidth: 0 },
  logoText: { flexShrink: 1, fontSize: 14, fontWeight: "700" },
  logoSub: { flexShrink: 1, fontFamily: monoFont, fontSize: 10, marginTop: 2 },
  copy: { marginTop: 30 },
  eyebrow: { flexShrink: 1, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { flexShrink: 1, fontFamily: displayFont, fontSize: 32, lineHeight: 36, marginTop: 10 },
  body: { flexShrink: 1, fontSize: 14, lineHeight: 21, marginTop: 12 },
  form: { gap: 12, marginTop: 6 },
  inputWrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  primaryButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { flexShrink: 1, textAlign: "center", fontSize: 15, fontWeight: "700" },
  secondaryButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { flexShrink: 1, textAlign: "center", fontSize: 15, fontWeight: "700" },
  invite: { flexShrink: 1, marginTop: "auto", textAlign: "center", fontSize: 12 },
  inviteLink: { fontWeight: "700" },
});
