import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { touchV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { IconButton } from "@/components/ui/IconButton";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/** Design System V2 header contract (mobile). These are presentation-only building blocks:
 *  they render what the caller passes and never fetch, navigate or decide permissions.
 *
 *  Shared rules: the safe-area top inset is applied by the header itself; the back control is
 *  always 44x44 at the leading edge; titles wrap rather than truncate and cap font scaling at
 *  1.5x; every icon-only control has a spoken name; unread counts are text as well as color.
 *  Colors come from `useTheme()`, so a header is V2 inside a `<DesignV2Scope>`. */

export const HEADER_MAX_FONT_SCALE = 1.5;

/* -- Shared atoms ---------------------------------------------------------- */

export type ConnectionState = "online" | "offline" | "pending";

/** What the app honestly knows: offline, online with saved-but-unsent changes, or online. */
export function useConnectionState(): { state: ConnectionState; pendingCount: number } {
  const isOnline = useAppStore((s) => s.isOnline);
  const pendingCount = useAppStore((s) => s.pendingActions.length);
  if (!isOnline) return { state: "offline", pendingCount };
  return { state: pendingCount > 0 ? "pending" : "online", pendingCount };
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Small status chip: icon + text (never color alone). Hidden when fully online unless `showOnline`. */
export function ConnectionIndicator({
  state,
  pendingCount = 0,
  showOnline = false,
  onPress,
  testID,
}: {
  state: ConnectionState;
  pendingCount?: number;
  showOnline?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (state === "online" && !showOnline) return null;
  const specs: Record<ConnectionState, { icon: IconName; fg: string; bg: string; line: string; text: string }> = {
    online: {
      icon: "checkmark-circle-outline",
      fg: theme.status.ready,
      bg: theme.status.readySoft,
      line: theme.status.readyLine,
      text: t("headerV2.online"),
    },
    offline: {
      icon: "cloud-offline-outline",
      fg: theme.status.dirty,
      bg: theme.status.dirtySoft,
      line: theme.status.dirtyLine,
      text: t("headerV2.offline"),
    },
    pending: {
      icon: "sync-outline",
      fg: theme.status.pickup,
      bg: theme.status.pickupSoft,
      line: theme.status.pickupLine,
      text: t("headerV2.pending", { count: pendingCount }),
    },
  };
  const spec = specs[state];
  const body = (
    <View style={[styles.chip, { backgroundColor: spec.bg, borderColor: spec.line }]}>
      <Ionicons name={spec.icon} size={14} color={spec.fg} />
      <AppText variant="micro" maxFontSizeMultiplier={1.4} style={{ color: spec.fg }}>
        {spec.text}
      </AppText>
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={spec.text} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spec.text}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

/** The one notification entry point: bell + unread count (text), 44x44. */
export function NotificationBell({
  unreadCount,
  onPress,
  testID = "header-notifications",
}: {
  unreadCount: number;
  onPress: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <IconButton
      icon="notifications-outline"
      variant="tonal"
      onPress={onPress}
      badgeCount={unreadCount}
      accessibilityLabel={t("headerV2.notifications")}
      testID={testID}
    />
  );
}

/** Optional account entry: initials in a circle, 44x44. */
export function AvatarButton({ name, onPress, testID = "header-avatar" }: { name: string; onPress: () => void; testID?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "?";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("headerV2.account", { name })}
      style={({ pressed }) => [
        styles.avatar,
        { backgroundColor: pressed ? theme.primaryLine : theme.primarySoft, borderColor: theme.primaryLine },
      ]}
      testID={testID}
    >
      <AppText variant="label" tone="accent" maxFontSizeMultiplier={1.2}>
        {initials}
      </AppText>
    </Pressable>
  );
}

export function BackButton({
  onPress,
  label,
  icon = "chevron-back",
  testID = "header-back",
}: {
  onPress: () => void;
  label?: string;
  icon?: IconName;
  testID?: string;
}) {
  const { t } = useTranslation();
  return <IconButton icon={icon} onPress={onPress} accessibilityLabel={label ?? t("headerV2.back")} testID={testID} />;
}

/* -- Header variants ------------------------------------------------------- */

type Shell = { testID?: string };

function useHeaderFrame(surface: "background" | "surface" = "background") {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return { theme, top: insets.top, backgroundColor: surface === "surface" ? theme.surface : theme.background };
}

/** Dashboard header: title, hotel context line, sync chip, bell and optional avatar. */
export function HomeHeader({
  title,
  subtitle,
  hotelName,
  connection,
  unreadCount,
  onOpenNotifications,
  onOpenSync,
  avatarName,
  onOpenAccount,
  testID = "header-home",
}: Shell & {
  title: string;
  subtitle?: string;
  /** Property context, e.g. the hotel name. */
  hotelName?: string;
  connection?: { state: ConnectionState; pendingCount?: number };
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenSync?: () => void;
  avatarName?: string;
  onOpenAccount?: () => void;
}) {
  const { theme, top, backgroundColor } = useHeaderFrame();
  return (
    <View style={[styles.frame, { paddingTop: top + spaceV2.sm, backgroundColor }]} testID={testID}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          {hotelName ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} testID={`${testID}-hotel`}>
              {hotelName}
            </AppText>
          ) : null}
          <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="body" tone="secondary" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <View style={styles.actions}>
          <NotificationBell unreadCount={unreadCount} onPress={onOpenNotifications} testID={`${testID}-notifications`} />
          {avatarName && onOpenAccount ? (
            <AvatarButton name={avatarName} onPress={onOpenAccount} testID={`${testID}-avatar`} />
          ) : null}
        </View>
      </View>
      {connection ? (
        <View style={styles.syncRow}>
          <ConnectionIndicator
            state={connection.state}
            pendingCount={connection.pendingCount}
            onPress={onOpenSync}
            testID={`${testID}-sync`}
          />
        </View>
      ) : null}
      <View style={[styles.rule, { backgroundColor: theme.borderSubtle }]} />
    </View>
  );
}

/** Top-level destination header (a tab root): title, optional subtitle, trailing actions. */
export function ScreenHeader({
  title,
  subtitle,
  trailing,
  testID = "header-screen",
}: Shell & {
  title: string;
  subtitle?: string;
  /** Up to two compact controls (for example the bell). */
  trailing?: React.ReactNode;
}) {
  const { theme, top, backgroundColor } = useHeaderFrame();
  return (
    <View style={[styles.frame, { paddingTop: top + spaceV2.sm, backgroundColor }]} testID={testID}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing ? <View style={styles.actions}>{trailing}</View> : null}
      </View>
      <View style={[styles.rule, { backgroundColor: theme.borderSubtle }]} />
    </View>
  );
}

/** Pushed detail screen: back at the leading edge, title, optional trailing action. */
export function DetailHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  trailing,
  testID = "header-detail",
}: Shell & {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel?: string;
  trailing?: React.ReactNode;
}) {
  const { theme, top, backgroundColor } = useHeaderFrame("surface");
  return (
    <View
      style={[styles.frame, styles.detail, { paddingTop: top + spaceV2.xs, backgroundColor, borderBottomColor: theme.borderSubtle }]}
      testID={testID}
    >
      <View style={styles.row}>
        <BackButton onPress={onBack} label={backLabel} />
        <View style={[styles.titleBlock, styles.detailTitle]}>
          <AppText variant="headline" accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="secondary" numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing ? <View style={styles.actions}>{trailing}</View> : <View style={{ width: touchV2.min }} />}
      </View>
    </View>
  );
}

/** Modal / sheet header: title + close. The grab handle and top inset are the sheet's job. */
export function SheetHeader({
  title,
  onClose,
  closeLabel,
  testID = "header-sheet",
}: Shell & {
  title: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, styles.sheet]} testID={testID}>
      <View style={styles.titleBlock}>
        <AppText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
          {title}
        </AppText>
      </View>
      <IconButton icon="close" onPress={onClose} accessibilityLabel={closeLabel ?? t("headerV2.close")} testID={`${testID}-close`} />
    </View>
  );
}

/** Profile / Settings header. Pushed screens pass `onBack`; the root Settings screen omits it.
 *  Keeps the legacy `settings-back` / `settings-title` test IDs so existing contracts hold. */
export function AccountHeader({
  title,
  onBack,
  backLabel,
  testID = "header-account",
}: Shell & {
  title: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const { theme, top, backgroundColor } = useHeaderFrame();
  return (
    <View
      style={[styles.frame, styles.detail, { paddingTop: top + spaceV2.xs, backgroundColor, borderBottomColor: theme.borderSubtle }]}
      testID={testID}
    >
      <View style={styles.row}>
        {onBack ? <BackButton onPress={onBack} label={backLabel} testID="settings-back" /> : null}
        <View style={[styles.titleBlock, onBack ? null : styles.accountRootTitle]}>
          <AppText
            variant="title"
            accessibilityRole="header"
            numberOfLines={2}
            maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
            testID="settings-title"
          >
            {title}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { paddingHorizontal: spaceV2.page, paddingBottom: spaceV2.sm, gap: spaceV2.xs },
  detail: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spaceV2.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  detailTitle: { paddingHorizontal: spaceV2.xs },
  accountRootTitle: { paddingLeft: spaceV2.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm },
  syncRow: { flexDirection: "row", alignItems: "center" },
  rule: { height: StyleSheet.hairlineWidth, marginTop: spaceV2.xs, marginHorizontal: -spaceV2.page },
  sheet: { paddingBottom: spaceV2.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
  },
  avatar: {
    width: touchV2.min,
    height: touchV2.min,
    borderRadius: touchV2.min / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
