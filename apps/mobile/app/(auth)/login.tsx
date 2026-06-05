import { useState } from "react";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { C, displayFont, monoFont } from "@/components/shared/tokens";

export default function LoginScreen() {
  const { t } = useTranslation();
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
      Alert.alert("Error", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.inner}>
        <View style={styles.logoRow}>
          <View style={styles.logoMark}>
            <Ionicons name="home-outline" size={17} color={C.accent} />
          </View>
          <View>
            <Text style={styles.logoText}>PatelRep</Text>
            <Text style={styles.logoSub}>v2 - Lone Star Inn</Text>
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={styles.eyebrow}>Sign in</Text>
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.body}>Sign in to start your shift.</Text>
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
          />
          {mode === "password" ? (
            <Input
              icon="key-outline"
              placeholder={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          ) : null}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryText}>{mode === "password" ? t("auth.login") : t("auth.magicLink")}</Text>
              <Ionicons name="arrow-forward" size={17} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode(mode === "password" ? "magic" : "password")}>
          <Ionicons name={mode === "password" ? "phone-portrait-outline" : "mail-outline"} size={17} color={C.ink} />
          <Text style={styles.secondaryText}>{mode === "password" ? "Sign in with phone" : t("auth.signInWith")}</Text>
        </TouchableOpacity>

        <Text style={styles.invite}>
          New to PatelRep? <Text style={styles.inviteLink}>Get the invite link</Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function Input(props: ComponentProps<typeof TextInput> & { icon: ComponentProps<typeof Ionicons>["name"] }) {
  const { icon, ...inputProps } = props;
  return (
    <View style={styles.inputWrap}>
      <Ionicons name={icon} size={15} color={C.ink3} />
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={C.ink4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  inner: { flex: 1, padding: 24, gap: 22 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  logoMark: { width: 28, height: 28, borderRadius: 7, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" },
  logoText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  logoSub: { color: C.ink3, fontFamily: monoFont, fontSize: 10, marginTop: 2 },
  copy: { marginTop: 30 },
  eyebrow: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 32, lineHeight: 36, marginTop: 10 },
  body: { color: C.ink2, fontSize: 14, lineHeight: 21, marginTop: 12 },
  form: { gap: 12, marginTop: 6 },
  inputWrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, color: C.ink, fontSize: 15, paddingVertical: 10 },
  primaryButton: { minHeight: 48, borderRadius: 10, backgroundColor: C.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: C.paper, fontSize: 15, fontWeight: "700" },
  secondaryButton: { minHeight: 48, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { color: C.ink, fontSize: 15, fontWeight: "700" },
  invite: { marginTop: "auto", textAlign: "center", color: C.ink3, fontSize: 12 },
  inviteLink: { color: C.accent, fontWeight: "700" },
});
