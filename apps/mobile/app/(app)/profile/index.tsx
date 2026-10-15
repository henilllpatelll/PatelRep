import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useAppStore } from "@/stores/appStore";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { monoFont } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useSyncOverview } from "@/lib/offline/useSyncOverview";
import { useOwnProfile } from "@/lib/settings/useOwnProfile";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { useAppearancePreference } from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

export default function SettingsHomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference } = useAppearancePreference();
  const { unreadCount } = useAppStore();
  const { overview } = useSyncOverview();
  const { user, name, roleLabel, hotelName, connection } = useSettingsIdentity(overview);
  // Refreshes the short-lived photo URL and mirrors the latest display name into the user store.
  const { profile } = useOwnProfile();
  const appVersion = Constants.expoConfig?.version ?? "dev";
  const [signOutOpen, setSignOutOpen] = useState(false);

  const appearanceLabel = t(`profile.appearance.${preference}`);
  const languageLabel = i18n.language === "es" ? "Español" : "English";
  const syncSubtitle =
    overview.attention > 0
      ? t("settings.sync.row.attention", { count: overview.attention })
      : overview.status === "syncing"
        ? t("settings.sync.row.syncing")
        : !overview.online
          ? overview.pending > 0
            ? t("settings.sync.row.offline", { count: overview.pending })
            : t("settings.sync.offline")
          : overview.pending > 0
            ? t("settings.sync.row.waiting", { count: overview.pending })
            : overview.status === "unavailable"
              ? t("settings.sync.row.unavailable")
              : t("settings.sync.row.saved");

  return (
    <SettingsScreen title={t("settings.title")}>
      <Pressable
        onPress={() => router.push("/(app)/profile/personal")}
        accessibilityRole="button"
        accessibilityLabel={[name, roleLabel, hotelName, connection.text, t("settings.personal.title")]
          .filter(Boolean)
          .join(", ")}
        style={({ pressed }) => [
          styles.identity,
          {
            backgroundColor: pressed ? theme.surfaceMuted : theme.surface,
            borderColor: theme.border,
          },
        ]}
        testID="settings-identity"
      >
        <Avatar name={name} size={56} uri={profile?.avatar_url ?? user?.avatar_url ?? null} />
        <View style={styles.identityText}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={1}
            style={[styles.name, { color: theme.textPrimary }]}
            testID="identity-name"
          >
            {name}
          </Text>
          {roleLabel ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.role, { color: theme.primary }]}
              testID="identity-role"
            >
              {roleLabel}
            </Text>
          ) : null}
          {hotelName ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              numberOfLines={1}
              style={[styles.hotel, { color: theme.textMuted }]}
              testID="identity-hotel"
            >
              {hotelName}
            </Text>
          ) : null}
          <View style={styles.connRow} testID="connection-status">
            <View style={[styles.connDot, { backgroundColor: connection.color }]} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.connText, { color: theme.textMuted }]}>
              {connection.text}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
      </Pressable>

      <SettingsSection title={t("settings.sections.account")}>
        <SettingsRow
          first
          icon="person-outline"
          label={t("settings.personal.title")}
          subtitle={t("settings.personal.subtitle")}
          onPress={() => router.push("/(app)/profile/personal")}
          testID="row-personal"
        />
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t("settings.security.title")}
          subtitle={t("settings.security.subtitle")}
          onPress={() => router.push("/(app)/profile/security")}
          testID="row-security"
        />
      </SettingsSection>

      <SettingsSection title={t("settings.sections.preferences")}>
        <SettingsRow
          first
          icon="notifications-outline"
          label={t("settings.notifications.title")}
          subtitle={t("settings.notifications.subtitle")}
          trailing={unreadCount > 0 ? String(unreadCount > 99 ? "99+" : unreadCount) : null}
          onPress={() => router.push("/(app)/profile/notifications")}
          testID="row-notifications"
        />
        <SettingsRow
          icon="color-palette-outline"
          label={t("profile.appearance.label")}
          subtitle={appearanceLabel}
          onPress={() => router.push("/(app)/profile/appearance")}
          testID="row-appearance"
        />
        <SettingsRow
          icon="globe-outline"
          label={t("profile.language")}
          subtitle={languageLabel}
          onPress={() => router.push("/(app)/profile/language")}
          testID="row-language"
        />
      </SettingsSection>

      <SettingsSection title={t("profile.myWork")}>
        <SettingsRow
          first
          icon="calendar-outline"
          label={t("profile.schedule")}
          onPress={() => router.push("/(app)/scheduling")}
          testID="row-schedule"
        />
        <SettingsRow
          icon="document-text-outline"
          label={t("profile.sopLibrary")}
          onPress={() => router.push("/(app)/sop")}
          testID="row-sop"
        />
      </SettingsSection>

      <SettingsSection title={t("settings.sections.support")}>
        <SettingsRow
          first
          icon="cloud-outline"
          label={t("settings.sync.title")}
          subtitle={syncSubtitle}
          onPress={() => router.push("/(app)/profile/sync")}
          testID="row-sync"
        />
        <SettingsRow
          icon="help-circle-outline"
          label={t("settings.help.title")}
          subtitle={t("settings.help.subtitle")}
          onPress={() => router.push("/(app)/profile/help")}
          testID="row-help"
        />
        <SettingsRow
          icon="information-circle-outline"
          label={t("settings.about.title")}
          subtitle={t("settings.about.subtitle")}
          onPress={() => router.push("/(app)/profile/about")}
          testID="row-about"
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow first icon="log-out-outline" label={t("profile.signOut")} onPress={() => setSignOutOpen(true)} destructive testID="row-sign-out" />
      </SettingsSection>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.version, { color: theme.textDisabled }]}>
        {t("profile.appVersion", { version: appVersion })}
      </Text>
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderRadius: 20,
    minHeight: 88,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 19, fontWeight: "700" },
  role: { fontSize: 13, fontWeight: "700" },
  hotel: { fontSize: 13 },
  connRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { fontSize: 12.5 },
  version: { textAlign: "center", fontFamily: monoFont, fontSize: 11 },
});
