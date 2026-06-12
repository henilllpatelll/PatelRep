import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { SectionHeader } from "@/components/shared/evening";

const KNOWN_ROLES = new Set([
  "housekeeper",
  "inspector",
  "engineer",
  "housekeeping_supervisor",
  "chief_engineer",
  "front_desk",
  "gm",
]);

function fallbackRoleLabel(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type RowIcon = React.ComponentProps<typeof Ionicons>["name"];

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  destructive,
  first,
  right,
  testID,
}: {
  icon: RowIcon;
  label: string;
  value?: string | null;
  onPress?: () => void;
  destructive?: boolean;
  first?: boolean;
  right?: React.ReactNode;
  testID?: string;
}) {
  const fg = destructive ? C.alert : C.ink;
  const body = (
    <>
      <View style={[styles.rowIconWrap, destructive && styles.rowIconWrapAlert]}>
        <Ionicons name={icon} size={16} color={destructive ? C.alert : C.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: fg }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={15} color={C.ink4} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={[styles.row, !first && styles.rowBorder]} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      {body}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, isOnline, pendingActions, flushQueue, unreadCount } = useAppStore();
  const [hotelName, setHotelName] = useState<string | null>(null);
  const [language, setLanguage] = useState(i18n.language);
  const [syncing, setSyncing] = useState(false);

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

  const role = user?.effective_role ?? user?.role ?? null;
  const roleDisplay = role
    ? KNOWN_ROLES.has(role)
      ? t(`staff.roles.${role}`)
      : fallbackRoleLabel(role)
    : null;
  const name = user?.full_name ?? "Staff";
  const pendingCount = pendingActions.length;
  const appVersion = Constants.expoConfig?.version ?? "dev";

  const connection = useMemo(() => {
    if (!isOnline) {
      return { color: C.ooo, text: t("profile.connection.offline") };
    }
    if (pendingCount > 0) {
      return { color: C.caution, text: t("profile.connection.pending", { count: pendingCount }) };
    }
    return { color: C.ready, text: t("profile.connection.online") };
  }, [isOnline, pendingCount, t]);

  async function selectLanguage(next: "en" | "es") {
    if (next === language) return;
    setLanguage(next);
    await i18n.changeLanguage(next);
    if (user) {
      try {
        await supabase.from("user_profiles").update({ language_pref: next }).eq("id", user.id);
      } catch {
        // Preference still applies locally; profile sync can catch up later.
      }
    }
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      setSyncing(false);
    }
  }

  function signOut() {
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

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Dark bleed behind iOS overscroll so the hero reads full-bleed */}
        <View style={styles.topBleed} />

        {/* Identity hero — who you are, where you work, and your sync state */}
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <View style={styles.heroTop}>
            <Avatar name={name} size={56} />
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => router.push("/(app)/notifications" as never)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t("profile.notifications")}
              testID="profile-bell"
            >
              <Ionicons name="notifications-outline" size={18} color={shellTokens.ink} />
              {unreadCount > 0 ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
          <Text style={styles.heroName}>{name}</Text>
          <View style={styles.heroMetaRow}>
            {roleDisplay ? (
              <View style={styles.roleChip}>
                <Text style={styles.roleChipText}>{roleDisplay}</Text>
              </View>
            ) : null}
            {hotelName ? <Text style={styles.heroHotel}>{hotelName}</Text> : null}
          </View>
          <View style={styles.connRow} testID="connection-status">
            <View style={[styles.connDot, { backgroundColor: connection.color }]} />
            <Text style={styles.connText}>{connection.text}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <SectionHeader title={t("profile.preferences")} />
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowIconWrap}>
                  <Ionicons name="globe-outline" size={16} color={C.primary} />
                </View>
                <Text style={styles.rowLabel}>{t("profile.language")}</Text>
                <View style={styles.segmented} testID="language-segmented">
                  {(
                    [
                      { code: "en" as const, label: "English" },
                      { code: "es" as const, label: "Español" },
                    ]
                  ).map((option) => {
                    const active = language === option.code;
                    return (
                      <TouchableOpacity
                        key={option.code}
                        style={[styles.segment, active && styles.segmentActive]}
                        onPress={() => void selectLanguage(option.code)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        testID={`language-${option.code}`}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <SettingsRow
                icon="notifications-outline"
                label={t("profile.notifications")}
                value={unreadCount > 0 ? t("profile.notificationsUnread", { count: unreadCount }) : null}
                onPress={() => router.push("/(app)/notifications" as never)}
                testID="row-notifications"
              />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.myWork")} />
            <View style={styles.card}>
              <SettingsRow
                icon="calendar-outline"
                label={t("profile.schedule")}
                onPress={() => router.push("/(app)/scheduling" as never)}
                first
                testID="row-schedule"
              />
              <SettingsRow
                icon="document-text-outline"
                label={t("profile.sopLibrary")}
                onPress={() => router.push("/(app)/sop" as never)}
                testID="row-sop"
              />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.dataSync")} />
            <View style={styles.card}>
              <SettingsRow
                icon={pendingCount > 0 ? "cloud-upload-outline" : "cloud-done-outline"}
                label={t("profile.offlineChanges")}
                value={
                  pendingCount > 0
                    ? t("profile.pendingChanges", { count: pendingCount })
                    : t("profile.upToDate")
                }
                first
                right={
                  pendingCount > 0 && isOnline ? (
                    <TouchableOpacity
                      style={styles.syncBtn}
                      onPress={() => void syncNow()}
                      disabled={syncing}
                      activeOpacity={0.85}
                      testID="sync-now"
                    >
                      {syncing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.syncBtnText}>{t("profile.syncNow")}</Text>
                      )}
                    </TouchableOpacity>
                  ) : undefined
                }
                testID="row-sync"
              />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.account")} />
            <View style={styles.card}>
              <SettingsRow
                icon="log-out-outline"
                label={t("profile.signOut")}
                onPress={signOut}
                destructive
                first
                testID="row-sign-out"
              />
            </View>
          </View>

          <Text style={styles.version}>PatelRep v{appVersion}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: shellTokens.bg,
  },
  scroll: {
    flex: 1,
    backgroundColor: C.paper,
  },
  scrollContent: {
    flexGrow: 1,
  },
  topBleed: {
    position: "absolute",
    top: -600,
    left: 0,
    right: 0,
    height: 600,
    backgroundColor: shellTokens.bg,
  },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: shellTokens.raised,
    borderWidth: 1,
    borderColor: shellTokens.line,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: C.alert,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: {
    color: "#fff",
    fontSize: 9.5,
    fontWeight: "800",
  },
  heroName: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "600",
    color: shellTokens.ink,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  roleChip: {
    backgroundColor: shellTokens.raised,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleChipText: {
    color: shellTokens.ink,
    fontSize: 11.5,
    fontWeight: "800",
  },
  heroHotel: {
    color: shellTokens.ink2,
    fontSize: 13,
  },
  connRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 13,
  },
  connDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connText: {
    flex: 1,
    color: shellTokens.ink2,
    fontSize: 12.5,
    lineHeight: 17,
  },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 18,
  },
  section: {
    gap: 9,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    overflow: "hidden",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: C.line2,
  },
  rowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconWrapAlert: {
    backgroundColor: C.alertSoft,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: C.ink,
  },
  rowValue: {
    color: C.ink3,
    fontSize: 12.5,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: C.surface3,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segment: {
    minHeight: 32,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: C.accent,
  },
  segmentText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: C.ink2,
  },
  segmentTextActive: {
    color: "#fff",
  },
  syncBtn: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 12,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  version: {
    textAlign: "center",
    color: C.ink4,
    fontFamily: monoFont,
    fontSize: 11,
  },
});
