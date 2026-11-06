import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { ENGINEERING_SYNC_ROUTE } from "@/lib/engineering/homeNavigation";
import { HOME_MAX_FONT, HOME_MIN_TOUCH } from "./homeStyles";
import { HomeConnectionStatus, type HomeConnection } from "./HomeConnectionStatus";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "";
}

interface Props {
  name: string;
  greetingKey: string;
  /** Replaces the greeting (the chief's "Engineering Overview"); the person is then named in the role line. */
  heading?: string;
  hotelName: string | null;
  /** Role line, e.g. "Maintenance technician" / "Chief engineer". */
  roleLabel: string;
  unreadCount: number;
  connection: HomeConnection;
}

/** Compact header: who, where, role, notifications, profile and the honest connection line. */
export function TechnicianHomeHeader({ name, greetingKey, heading, hotelName, roleLabel, unreadCount, connection }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const x = useV2Text();
  return (
    <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <View style={styles.row}>
        <Pressable
          onPress={() => router.push("/(app)/profile" as never)}
          accessibilityRole="button"
          accessibilityLabel={t("tabs.profile")}
          style={styles.avatarBtn}
          testID="engineer-profile"
        >
          <Avatar name={name} size={36} />
        </Pressable>
        <View style={styles.identity}>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: theme.shell.ink }]}>
            {heading ?? t(greetingKey, { name: firstName(name) || t("home.engineer.fallbackName") })}
          </Text>
          {hotelName ? (
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={2} style={[styles.sub, { color: theme.shell.ink2 }]} testID="engineer-hotel">
              {hotelName}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={1} style={[styles.role, x.label, { color: theme.shell.ink3 }]} testID="engineer-role">
            {roleLabel}
          </Text>
        </View>
        <Pressable
          style={[styles.bell, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}
          onPress={() => router.push("/(app)/notifications" as never)}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? t("home.engineer.notificationsUnread", { count: unreadCount }) : t("tabs.notifications", { defaultValue: "Notifications" })}
          testID="engineer-bell"
        >
          <Ionicons name="notifications-outline" size={20} color={theme.shell.ink2} />
          {unreadCount > 0 ? (
            <View style={[styles.dot, { backgroundColor: theme.status.dirty }]}>
              <Text maxFontSizeMultiplier={1} style={styles.dotText}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <HomeConnectionStatus connection={connection} onPress={() => router.push(ENGINEERING_SYNC_ROUTE as never)} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 18, paddingBottom: 12, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarBtn: { minWidth: HOME_MIN_TOUCH, minHeight: HOME_MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  identity: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "700", lineHeight: 25 },
  sub: { fontSize: 13.5, fontWeight: "600", marginTop: 1 },
  role: { fontSize: 11.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 },
  bell: { width: HOME_MIN_TOUCH, height: HOME_MIN_TOUCH, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  dotText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
