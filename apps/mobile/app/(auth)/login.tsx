import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>PatelRep</Text>
        <Text style={styles.subtitle}>AI Staff Copilot</Text>

        <TextInput
          style={styles.input}
          placeholder={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        {mode === "password" && (
          <TextInput
            style={styles.input}
            placeholder={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />
        )}

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === "password" ? t("auth.login") : t("auth.magicLink")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === "password" ? "magic" : "password")}>
          <Text style={styles.toggleText}>
            {mode === "password" ? t("auth.magicLink") : t("auth.signInWith")}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1815" },
  inner: { flex: 1, justifyContent: "center", padding: 32 },
  logo: { fontSize: 36, fontWeight: "bold", color: "#f7f4ee", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#807a70", textAlign: "center", marginBottom: 48 },
  input: {
    backgroundColor: "#221f1b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#322d26",
    padding: 16,
    fontSize: 16,
    color: "#f1ede4",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#b8431c",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  toggleText: {
    color: "#807a70",
    textAlign: "center",
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
