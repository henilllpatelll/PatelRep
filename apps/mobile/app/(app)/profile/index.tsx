import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { C, displayFont, monoFont } from "@/components/shared/tokens";
import { Avatar, IconButton, Pill } from "@/components/shared/mobileHandoff";

function roleLabel(role?: string | null) {
  if (!role) return "Staff";
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const [hotelName, setHotelName] = useState("Lone Star Inn");
  const [language, setLanguage] = useState(i18n.language);

  useEffect(() => {
    if (!user?.tenant_id) return;
    let mounted = true;

    api
      .get<{ data: { name: string } }>(`/hotels/${user.tenant_id}`)
      .then((res) => {
        if (mounted && res.data?.name) setHotelName(res.data.name);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [user?.tenant_id]);

  const rows = useMemo(
    () => [
      { icon: "calendar-outline" as const, label: t("profile.schedule"), value: t("profile.scheduleValue") },
      { icon: "trending-up-outline" as const, label: t("profile.stats"), value: t("profile.avgTime") },
      { icon: "document-text-outline" as const, label: t("profile.payHours"), value: t("profile.hoursThisWeek") },
      { icon: "notifications-outline" as const, label: t("profile.notifications"), value: t("profile.notificationsOn") },
      { icon: "settings-outline" as const, label: t("profile.language"), value: language === "es" ? t("profile.spanish") : t("profile.english") },
      { icon: "shield-checkmark-outline" as const, label: t("profile.helpSafety"), value: null },
    ],
    [language, t]
  );

  async function toggleLanguage(value: boolean) {
    const next = value ? "es" : "en";
    setLanguage(next);
    await i18n.changeLanguage(next);

    if (user) {
      await supabase
        .from("user_profiles")
        .update({ language_pref: next })
        .eq("id", user.id);
    }
  }

  async function signOut() {
    Alert.alert(t("profile.signOutTitle"), t("profile.signOutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("profile.signOut"),
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  const name = user?.full_name ?? "Staff";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("profile.me")}</Text>
        <IconButton icon="settings-outline" />
      </View>

      <View style={styles.identity}>
        <Avatar name={name} size={58} />
        <View style={styles.identityBody}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.role}>
            {roleLabel(user?.role)} - {hotelName}
          </Text>
          <View style={styles.badges}>
            <Pill tone="ready" icon="checkmark">
              {t("profile.qualityBadge", { score: "94" })}
            </Pill>
            <Pill tone="accent" icon="star">
              {t("profile.topPace")}
            </Pill>
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        {[
          { value: "128", label: t("profile.roomsThisMonth") },
          { value: "96%", label: t("profile.firstPass"), tone: C.ready },
          { value: "21d", label: t("profile.streak"), tone: C.accent },
        ].map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={[styles.statValue, stat.tone ? { color: stat.tone } : undefined]}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.settingsList}>
        {rows.map((row, index) => (
          <View key={row.label} style={[styles.row, index > 0 && styles.rowBorder]}>
            <Ionicons name={row.icon} size={17} color={C.ink3} />
            <Text style={styles.rowLabel}>{row.label}</Text>
            {row.label === t("profile.language") ? (
              <Switch
                value={language === "es"}
                onValueChange={toggleLanguage}
                trackColor={{ true: C.accent, false: C.line }}
                thumbColor="#fff"
              />
            ) : row.value ? (
              <Text style={styles.rowValue}>{row.value}</Text>
            ) : null}
            <Ionicons name="chevron-forward" size={15} color={C.ink4} />
          </View>
        ))}
      </View>

      <TouchableOpacity activeOpacity={0.84} style={styles.signOutButton} onPress={signOut}>
        <Ionicons name="log-out-outline" size={18} color={C.ink2} />
        <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>PatelRep v2.4 - build 1182</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.paper,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.ink,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  identityBody: {
    flex: 1,
  },
  name: {
    fontFamily: displayFont,
    fontSize: 24,
    lineHeight: 28,
    color: C.ink,
  },
  role: {
    color: C.ink3,
    fontSize: 12.5,
    marginTop: 3,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  stats: {
    flexDirection: "row",
    gap: 9,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  statValue: {
    fontFamily: displayFont,
    fontSize: 24,
    lineHeight: 26,
    color: C.ink,
  },
  statLabel: {
    color: C.ink3,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 5,
  },
  settingsList: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: C.line2,
  },
  rowLabel: {
    flex: 1,
    color: C.ink,
    fontSize: 14,
  },
  rowValue: {
    color: C.ink3,
    fontSize: 12.5,
  },
  signOutButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  signOutText: {
    color: C.ink2,
    fontSize: 15,
    fontWeight: "700",
  },
  version: {
    textAlign: "center",
    color: C.ink4,
    fontFamily: monoFont,
    fontSize: 11,
  },
});
