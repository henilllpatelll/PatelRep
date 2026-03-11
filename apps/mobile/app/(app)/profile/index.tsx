import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const isSpanish = i18n.language === "es";

  async function toggleLanguage(value: boolean) {
    const lang = value ? "es" : "en";
    await i18n.changeLanguage(lang);

    if (user) {
      await supabase
        .from("user_profiles")
        .update({ preferred_language: lang })
        .eq("id", user.id);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.full_name ?? "Staff"}</Text>
        <Text style={styles.role}>{user?.role?.replace(/_/g, " ").toUpperCase()}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Español</Text>
          <Switch
            value={isSpanish}
            onValueChange={toggleLanguage}
            trackColor={{ true: "#1E40AF" }}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  name: { fontSize: 20, fontWeight: "700", color: "#111827" },
  role: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 15, color: "#374151" },
  signOutBtn: { backgroundColor: "#FEE2E2", borderRadius: 12, padding: 14, alignItems: "center" },
  signOutText: { color: "#EF4444", fontWeight: "600" },
});
