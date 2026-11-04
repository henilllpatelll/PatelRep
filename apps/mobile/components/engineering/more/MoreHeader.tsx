import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MIN_TOUCH } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  unreadCount: number;
  onNotifications: () => void;
  onSettings: () => void;
}

/** "More" title with the two header actions: notifications (with unread count) and settings. */
export function MoreHeader({ unreadCount, onNotifications, onSettings }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.background, borderBottomColor: theme.borderSubtle }]}>
      <Text maxFontSizeMultiplier={1.4} accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]} testID="more-title">
        {t("tabs.more")}
      </Text>
      <Pressable
        onPress={onNotifications}
        accessibilityRole="button"
        accessibilityLabel={unreadCount > 0 ? t("home.engineer.notificationsUnread", { count: unreadCount }) : t("engineeringMore.notificationsA11y")}
        style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.surfaceMuted }]}
        testID="more-notifications"
      >
        <Ionicons name="notifications-outline" size={22} color={theme.textPrimary} />
        {unreadCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.status.dirty }]}>
            <Text maxFontSizeMultiplier={1} style={styles.badgeText} testID="more-notifications-badge">
              {badge}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        onPress={onSettings}
        accessibilityRole="button"
        accessibilityLabel={t("engineeringMore.settingsA11y")}
        style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.surfaceMuted }]}
        testID="more-header-settings"
      >
        <Ionicons name="settings-outline" size={22} color={theme.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 24, fontWeight: "700" },
  action: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "800" },
});
