import { useEffect, useMemo, useState } from "react";
import {
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
import { monoFont } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { SectionHeader } from "@/components/shared/evening";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const KNOWN_ROLES = new Set([
  "housekeeper",
  "inspector",
  "engineer",
  "housekeeping_supervisor",
  "engineer",
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
  const theme = useTheme();
  const fg = destructive ? theme.status.dirty : theme.textPrimary;
  const body = (
    <>
      <View
        style={[
          styles.rowIconWrap,
          { backgroundColor: destructive ? theme.status.dirtySoft : theme.primarySoft },
        ]}
      >
        <Ionicons name={icon} size={16} color={destructive ? theme.status.dirty : theme.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: fg }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, { color: theme.textMuted }]}>{value}</Text> : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View
        style={[styles.row, !first && styles.rowBorder, !first && { borderTopColor: theme.borderSubtle }]}
        testID={testID}
      >
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowBorder, !first && { borderTopColor: theme.borderSubtle }]}
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
  const theme = useTheme();
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
      return { color: theme.status.outOfOrder, text: t("profile.connection.offline") };
    }
    if (pendingCount > 0) {
      return { color: theme.status.pickup, text: t("profile.connection.pending", { count: pendingCount }) };
    }
    return { color: theme.status.ready, text: t("profile.connection.online") };
  }, [isOnline, pendingCount, t, theme]);

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
          await supabase.auth.signOut({ scope: "local" });
          router.replace("/(auth)/login" as never);
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView style={[styles.scroll, { backgroundColor: theme.background }]} contentContainerStyle={styles.scrollContent}>
        {/* Dark bleed behind iOS overscroll so the hero reads full-bleed */}
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />

        {/* Identity hero — who you are, where you work, and your sync state */}
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <View style={styles.heroTop}>
            <Avatar name={name} size={56} />
            <TouchableOpacity
              style={[styles.bellBtn, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}
              onPress={() => router.push("/(app)/notifications" as never)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t("profile.notifications")}
              testID="profile-bell"
            >
              <Ionicons name="notifications-outline" size={18} color={theme.shell.ink} />
              {unreadCount > 0 ? (
                <View style={[styles.bellBadge, { backgroundColor: theme.status.dirty }]}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroName, { color: theme.shell.ink }]}>{name}</Text>
          <View style={styles.heroMetaRow}>
            {roleDisplay ? (
              <View style={[styles.roleChip, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}>
                <Text style={[styles.roleChipText, { color: theme.shell.ink }]}>{roleDisplay}</Text>
              </View>
            ) : null}
            {hotelName ? <Text style={[styles.heroHotel, { color: theme.shell.ink2 }]}>{hotelName}</Text> : null}
          </View>
          <View style={styles.connRow} testID="connection-status">
            <View style={[styles.connDot, { backgroundColor: connection.color }]} />
            <Text style={[styles.connText, { color: theme.shell.ink2 }]}>{connection.text}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <SectionHeader title={t("profile.preferences")} />
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.rowIconWrap, { backgroundColor: theme.primarySoft }]}>
                  <Ionicons name="globe-outline" size={16} color={theme.primary} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>{t("profile.language")}</Text>
                <View
                  style={[
                    styles.segmented,
                    { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle },
                  ]}
                  testID="language-segmented"
                >
                  {(
                    [
                      { code: "en" as const, label: language === "es" ? "Ingl\u00e9s" : "English" },
                      { code: "es" as const, label: "Español" },
                    ]
                  ).map((option) => {
                    const active = language === option.code;
                    return (
                      <TouchableOpacity
                        key={option.code}
                        style={[styles.segment, active && { backgroundColor: theme.primaryAction }]}
                        onPress={() => void selectLanguage(option.code)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        testID={`language-${option.code}`}
                      >
                        <Text style={[styles.segmentText, { color: active ? "#fff" : theme.textSecondary }]}>
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
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.myWork")} />
            <Card style={styles.card}>
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
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.dataSync")} />
            <Card style={styles.card}>
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
                    <Button
                      label={t("profile.syncNow")}
                      onPress={() => void syncNow()}
                      loading={syncing}
                      size="sm"
                      style={styles.syncBtn}
                      testID="sync-now"
                    />
                  ) : undefined
                }
                testID="row-sync"
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("profile.account")} />
            <Card style={styles.card}>
              <SettingsRow
                icon="log-out-outline"
                label={t("profile.signOut")}
                onPress={signOut}
                destructive
                first
                testID="row-sign-out"
              />
            </Card>
          </View>

          <Text style={[styles.version, { color: theme.textDisabled }]}>PatelRep v{appVersion}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
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
  },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
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
    borderWidth: 1,
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
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  roleChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleChipText: {
    fontSize: 11.5,
    fontWeight: "800",
  },
  heroHotel: {
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
    padding: 0,
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
  },
  rowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  rowValue: {
    fontSize: 12.5,
  },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
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
  segmentText: {
    fontSize: 12.5,
    fontWeight: "700",
  },
  syncBtn: {
    minWidth: 92,
  },
  version: {
    textAlign: "center",
    fontFamily: monoFont,
    fontSize: 11,
  },
});
