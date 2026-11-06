import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type HeaderStatusTone = "ok" | "warn" | "alert" | "muted";

export interface HeaderStatus {
  text: string;
  tone: HeaderStatusTone;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}

interface Props {
  /** Test-id prefix: `<prefix>-header`, `-hotel`, `-date`, `-bell`, `-bell-badge`, `-profile`, `-status`. */
  prefix: string;
  /** The signed-in property, when known. Hidden otherwise (never a placeholder). */
  hotelName?: string | null;
  greeting: string;
  /** Hotel-local date / part of day, e.g. "Friday, October 16". */
  dateLine: string;
  unreadCount: number;
  topInset: number;
  t: Translate;
  /** One honest line about how current the data is (connection / freshness). */
  status?: HeaderStatus | null;
  /** Makes the status chip a button (e.g. refresh). Omit for a read-only chip. */
  onPressStatus?: () => void;
  statusActionLabel?: string;
  /** Show the account avatar as a profile entry. */
  profileName?: string;
  profileLabel?: string;
  onOpenProfile?: () => void;
  onOpenNotifications: () => void;
}

/** Design System V2 role-home header shared by Inspector Home and Supervisor Today: property context, plain-sans
 *  greeting and date, the real unread count, an optional profile entry and a connection/freshness chip. Used only
 *  inside an active `<DesignV2Scope>`; legacy Home headers are untouched. */
export function RoleHomeHeader({
  prefix,
  hotelName,
  greeting,
  dateLine,
  unreadCount,
  topInset,
  t,
  status,
  onPressStatus,
  statusActionLabel,
  profileName,
  profileLabel,
  onOpenProfile,
  onOpenNotifications,
}: Props) {
  const theme = useTheme();
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  const tone = status
    ? {
        ok: { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
        warn: { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine },
        alert: { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
        muted: { fg: theme.textSecondary, bg: theme.surfaceSubtle, line: theme.borderSubtle },
      }[status.tone]
    : null;

  const chipBody = status && tone ? (
    <>
      <Ionicons name={status.icon} size={15} color={tone.fg} />
      <AppText variant="caption" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.statusText} testID={`${prefix}-status-text`}>
        {status.text}
      </AppText>
      {onPressStatus ? <Ionicons name="refresh-outline" size={15} color={theme.textMuted} /> : null}
    </>
  ) : null;

  return (
    <View style={[styles.wrap, { paddingTop: topInset + spaceV2.sm }]} testID={`${prefix}-header`}>
      <View style={styles.row}>
        <View style={styles.text}>
          {hotelName ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} testID={`${prefix}-hotel`}>
              {hotelName}
            </AppText>
          ) : null}
          <AppText variant="title" accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {greeting}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} testID={`${prefix}-date`}>
            {dateLine}
          </AppText>
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={onOpenNotifications}
            testID={`${prefix}-bell`}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? t("home.header.notificationsUnread", { count: unreadCount }) : t("home.header.notifications")}
            style={({ pressed }) => [
              styles.bell,
              { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderRadius: radiusV2.control },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="notifications-outline" size={22} color={theme.textPrimary} />
            {unreadCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.status.dirty }]} testID={`${prefix}-bell-badge`}>
                <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: theme.onDestructive }]}>
                  {badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
          {profileName && onOpenProfile ? (
            <Pressable
              onPress={onOpenProfile}
              testID={`${prefix}-profile`}
              accessibilityRole="button"
              accessibilityLabel={profileLabel}
              style={({ pressed }) => [styles.profile, pressed && { opacity: 0.7 }]}
            >
              <Avatar name={profileName} size={40} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {status && tone ? (
        onPressStatus ? (
          <Pressable
            onPress={onPressStatus}
            testID={`${prefix}-status`}
            accessibilityRole="button"
            accessibilityLabel={`${status.text}. ${statusActionLabel ?? ""}`.trim()}
            style={({ pressed }) => [styles.chip, { backgroundColor: tone.bg, borderColor: tone.line }, pressed && { opacity: 0.7 }]}
          >
            {chipBody}
          </Pressable>
        ) : (
          <View
            testID={`${prefix}-status`}
            accessible
            accessibilityRole="text"
            accessibilityLabel={status.text}
            style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.line }]}
          >
            {chipBody}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spaceV2.page, paddingBottom: spaceV2.sm, gap: spaceV2.sm },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spaceV2.md },
  text: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm },
  bell: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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
  badgeText: { fontSize: 11, fontWeight: "700" },
  profile: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  chip: {
    minHeight: 44,
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceV2.sm,
    borderWidth: 1,
    borderRadius: radiusV2.control,
    paddingHorizontal: spaceV2.md,
    paddingVertical: spaceV2.sm,
  },
  statusText: { flexShrink: 1, minWidth: 0 },
});
