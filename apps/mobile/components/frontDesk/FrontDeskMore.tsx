import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Avatar } from "@/components/shared/mobileHandoff";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { FRONT_DESK_MORE_ITEMS, type FrontDeskMoreItem } from "@/lib/frontDesk/moreMenu";
import { useOwnProfile } from "@/lib/settings/useOwnProfile";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/** Front Desk More (V2, five-tab layout): who is signed in, the tools that left the tab bar, account and support,
 *  and sign out. Every row opens a screen that already exists; nothing here is new functionality. */
export function FrontDeskMore() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const unreadCount = useAppStore((s) => s.unreadCount);
  const { user, name, hotelName } = useSettingsIdentity();
  const { profile } = useOwnProfile();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const rows = (group: FrontDeskMoreItem["group"]) =>
    FRONT_DESK_MORE_ITEMS.filter((i) => i.group === group).map((item, index) => (
      <SettingsRow
        key={item.key}
        first={index === 0}
        icon={item.icon}
        label={t(item.labelKey)}
        subtitle={item.key === "notifications" && unreadCount > 0 ? t("frontDeskMore.unread", { count: unreadCount }) : t(item.subtitleKey)}
        onPress={() => router.push(item.href as never)}
        testID={`more-${item.key}`}
      />
    ));

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="frontdesk-more">
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle }]}>
        <AppText variant="title" accessibilityRole="header" testID="more-title">
          {t("tabs.more")}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.push("/(app)/profile" as never)}
          accessibilityRole="button"
          accessibilityLabel={[name, t("frontDeskMore.role"), hotelName].filter(Boolean).join(", ")}
          testID="more-profile-card"
          style={({ pressed }) => [styles.identity, { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderRadius: radiusV2.card }, pressed && { opacity: 0.7 }]}
        >
          <Avatar name={name} size={52} uri={profile?.avatar_url ?? user?.avatar_url ?? null} />
          <View style={styles.identityText}>
            <AppText variant="headline" numberOfLines={2}>
              {name}
            </AppText>
            <AppText variant="caption" tone="accent">
              {t("frontDeskMore.role")}
            </AppText>
            {hotelName ? (
              <AppText variant="caption" tone="muted" numberOfLines={2}>
                {hotelName}
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
        </Pressable>

        <SettingsSection title={t("frontDeskMore.tools")}>{rows("tools")}</SettingsSection>
        <SettingsSection title={t("frontDeskMore.account")}>{rows("account")}</SettingsSection>
        <SettingsSection>
          <SettingsRow first icon="log-out-outline" label={t("frontDeskMore.signOut")} destructive onPress={() => setSignOutOpen(true)} testID="more-signOut" />
        </SettingsSection>
      </ScrollView>
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: spaceV2.page, paddingBottom: spaceV2.md, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: spaceV2.page, paddingTop: spaceV2.lg, gap: spaceV2.xl },
  identity: { flexDirection: "row", alignItems: "center", gap: spaceV2.md, padding: spaceV2.lg, borderWidth: 1, minHeight: 72 },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
});
