import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  greeting: string;
  /** Hotel-local, e.g. "Friday, October 16". */
  dateLine: string;
  name: string;
  unreadCount: number;
  topInset: number;
  t: Translate;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
}

/** Compact header: greeting and hotel-local date, the real unread count, and the profile entry. */
export function TodayHeader({ greeting, dateLine, name, unreadCount, topInset, t, onOpenNotifications, onOpenProfile }: Props) {
  const theme = useTheme();
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="today-header">
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textMuted }]} numberOfLines={1}>
          {dateLine}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
          style={[styles.greeting, { color: theme.textPrimary }]}
          numberOfLines={2}
        >
          {greeting}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onOpenNotifications}
          testID="today-bell"
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? t("home.header.notificationsUnread", { count: unreadCount }) : t("home.header.notifications")
          }
          style={({ pressed }) => [
            styles.bell,
            { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="notifications-outline" size={22} color={theme.textPrimary} />
          {unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.status.dirty }]} testID="today-bell-badge">
              <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: theme.onDestructive }]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={onOpenProfile}
          testID="today-profile"
          accessibilityRole="button"
          accessibilityLabel={t("supervisorToday.header.profile")}
          style={({ pressed }) => [styles.profile, pressed && { opacity: 0.7 }]}
        >
          <Avatar name={name} size={40} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingBottom: 6 },
  text: { flex: 1, gap: 2 },
  date: { fontSize: 12.5, fontWeight: "600" },
  greeting: { fontSize: 24, lineHeight: 29, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  bell: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10.5, fontWeight: "800" },
  profile: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
});
