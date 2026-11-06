import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { SyncIndicator, SyncTone } from "@/lib/housekeeping/homeText";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";
import { createTypographyStyles } from "@/lib/design/reactiveTypography";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  /** "WEDNESDAY, OCT 14 · MORNING" */
  meta: string;
  /** The same line in sentence case ("Wednesday, Oct 14 · Morning"); Design System V2 shows this one. */
  metaPlain?: string;
  /** Property context (the signed-in hotel). V2 only; hidden when unknown. */
  hotelName?: string | null;
  greeting: string;
  /** "Your shift is underway." */
  status: string;
  sync: SyncIndicator;
  unreadCount: number;
  topInset: number;
  t: Translate;
  onOpenNotifications: () => void;
  /** Opens the Sync Status drawer. */
  onOpenSync: () => void;
}

/**
 * Compact header: hotel-local date and part of day, greeting, the real shift
 * status, the notifications entry (with its unread count) and one honest line
 * about what is saved and sent.
 */
export function HomeHeader(props: Props) {
  const v2 = useIsDesignV2();
  return v2 ? <HomeHeaderV2 {...props} /> : <HomeHeaderLegacy {...props} />;
}

/** Design System V2: hotel context, plain-sans greeting, shift status, bell and a sync chip. */
function HomeHeaderV2({ meta, metaPlain, hotelName, greeting, status, sync, unreadCount, topInset, t, onOpenNotifications, onOpenSync }: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const tone: Record<SyncTone, { fg: string; bg: string; line: string }> = {
    ok: { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
    warn: { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine },
    alert: { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
    muted: { fg: theme.textSecondary, bg: theme.surfaceSubtle, line: theme.borderSubtle },
  };
  const chip = tone[sync.tone];
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  const dateLine = metaPlain ?? meta;
  return (
    <View style={[styles.wrapV2, { paddingTop: topInset + spaceV2.sm }]} testID="home-header">
      <View style={styles.row}>
        <View style={styles.text}>
          {hotelName ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} testID="home-hotel">
              {hotelName}
            </AppText>
          ) : null}
          <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {greeting}
          </AppText>
          <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE} testID="home-date">
            {dateLine}
          </AppText>
        </View>
        <Pressable
          onPress={onOpenNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? t("home.header.notificationsUnread", { count: unreadCount }) : t("home.header.notifications")
          }
          style={({ pressed }) => [
            styles.bell,
            { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderRadius: radiusV2.control },
            pressed && { opacity: 0.7 },
          ]}
          testID="home-notifications"
        >
          <Ionicons name="notifications-outline" size={22} color={theme.textPrimary} />
          {unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.status.dirty }]} testID="home-notifications-badge">
              <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: theme.onDestructive }]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        <AppText variant="label" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.statusText} testID="home-shift-status">
          {status}
        </AppText>
      </View>

      <Pressable
        onPress={onOpenSync}
        accessibilityRole="button"
        accessibilityLabel={`${sync.text}. ${t("home.header.syncOpen")}`}
        style={({ pressed }) => [
          styles.syncChip,
          { backgroundColor: chip.bg, borderColor: chip.line },
          pressed && { opacity: 0.7 },
        ]}
        testID="home-sync-line"
      >
        <Ionicons name={sync.icon} size={15} color={chip.fg} />
        <AppText variant="caption" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncChipText, { color: theme.textPrimary }]}>
          {sync.text}
        </AppText>
        <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

function HomeHeaderLegacy({ meta, greeting, status, sync, unreadCount, topInset, t, onOpenNotifications, onOpenSync }: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const toneColor: Record<SyncTone, string> = {
    ok: theme.status.ready,
    warn: theme.status.pickup,
    alert: theme.status.dirty,
    muted: theme.textMuted,
  };
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="home-header">
      <View style={styles.row}>
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
            {meta}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityRole="header"
            style={[styles.greeting, { color: theme.textPrimary }]}
          >
            {greeting}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.textSecondary }]} testID="home-shift-status">
            {status}
          </Text>
        </View>
        <Pressable
          onPress={onOpenNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? t("home.header.notificationsUnread", { count: unreadCount }) : t("home.header.notifications")
          }
          style={({ pressed }) => [
            styles.bell,
            { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
            pressed && { opacity: 0.7 },
          ]}
          testID="home-notifications"
        >
          <Ionicons name="notifications-outline" size={22} color={theme.textPrimary} />
          {unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.status.dirty }]} testID="home-notifications-badge">
              <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: theme.onDestructive }]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <Pressable
        onPress={onOpenSync}
        accessibilityRole="button"
        accessibilityLabel={`${sync.text}. ${t("home.header.syncOpen")}`}
        style={({ pressed }) => [styles.syncRow, pressed && { opacity: 0.6 }]}
        testID="home-sync-line"
      >
        <Ionicons name={sync.icon} size={14} color={toneColor[sync.tone]} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncText, { color: theme.textMuted }]} numberOfLines={2}>
          {sync.text}
        </Text>
        <Ionicons name="chevron-forward" size={12} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

const useStyles = createTypographyStyles((t) => ({
  wrap: { paddingHorizontal: 18, paddingBottom: 6, gap: 8 },
  wrapV2: { paddingHorizontal: spaceV2.page, paddingBottom: spaceV2.sm, gap: spaceV2.sm },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  meta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  greeting: { fontFamily: t.serif, fontSize: 30, lineHeight: 35 },
  status: { fontSize: 14, lineHeight: 19 },
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusText: { flexShrink: 1 },
  bell: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TARGET - 8 },
  syncText: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  syncChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radiusV2.control,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  syncChipText: { flex: 1, minWidth: 0 },
}));
