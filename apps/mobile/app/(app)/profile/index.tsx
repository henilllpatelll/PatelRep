import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { api } from "@/lib/api/client";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const isSpanish = i18n.language === "es";
  const [hotelName, setHotelName] = useState<string>("");

  useEffect(() => {
    if (user?.hotel_id) {
      api.get<{ data: { name: string } }>(`/hotels/${user.hotel_id}`)
        .then(res => setHotelName(res.data.name))
        .catch(() => {});  // silent — display only
    }
  }, [user?.hotel_id]);

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
        {hotelName ? (
          <Text style={styles.hotel}>{t("profile.hotel")}: {hotelName}</Text>
        ) : null}
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
  hotel: { fontSize: 13, color: "#9CA3AF", marginTop: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 15, color: "#374151" },
  signOutBtn: { backgroundColor: "#FEE2E2", borderRadius: 12, padding: 14, alignItems: "center" },
  signOutText: { color: "#EF4444", fontWeight: "600" },
});
