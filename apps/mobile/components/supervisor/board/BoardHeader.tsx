import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { describeAge, type BoardStatusLine } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  status: BoardStatusLine;
  /** Already-formatted hotel clock for the last verified answer, or null when none exists. */
  verifiedClock: string | null;
  refreshing: boolean;
  topInset: number;
  t: Translate;
  onRefresh: () => void;
}

/** The status sentence: only what the app can substantiate. "Live" needs a recent server verification. */
export function statusText(status: BoardStatusLine, verifiedClock: string | null, t: Translate): string {
  switch (status.kind) {
    case "loading":
      return t("roomBoard.header.loading");
    case "updating":
      return t("roomBoard.header.updating");
    case "live": {
      const age = describeAge(status.ageMs);
      if (age === null) return t("roomBoard.header.liveClock", { time: verifiedClock ?? "—" });
      if (age.unit === "now") return t("roomBoard.header.liveNow");
      return t(age.unit === "seconds" ? "roomBoard.header.liveSeconds" : "roomBoard.header.liveMinutes", { count: age.value });
    }
    case "stale":
      return t("roomBoard.header.stale", { time: verifiedClock ?? "—" });
    case "offline":
      return verifiedClock ? t("roomBoard.header.offline", { time: verifiedClock }) : t("roomBoard.header.offlineNone");
    case "previous_day":
      return t("roomBoard.header.previousDay");
    case "unavailable":
      return t("roomBoard.header.unavailable");
  }
}

/** Compact operational header: kicker, title, an honest freshness line, and a refresh control. */
export function BoardHeader({ status, verifiedClock, refreshing, topInset, t, onRefresh }: Props) {
  const theme = useTheme();
  const live = status.kind === "live";
  const tone = live ? theme.status.ready : status.kind === "updating" || status.kind === "loading" ? theme.primaryAction : theme.status.pickup;
  const icon = live ? "radio-button-on" : status.kind === "updating" || status.kind === "loading" ? "sync" : status.kind === "offline" ? "cloud-offline-outline" : "alert-circle-outline";
  const text = statusText(status, verifiedClock, t);

  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="room-board-header">
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} numberOfLines={1}>
          {t("roomBoard.header.kicker").toUpperCase()}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
          style={[styles.title, { color: theme.textPrimary }]}
          numberOfLines={1}
        >
          {t("tabs.roomBoard")}
        </Text>
        <View style={styles.statusRow} testID="room-board-status" accessibilityLiveRegion="polite">
          <Ionicons name={icon} size={12} color={tone} />
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.status, { color: live ? theme.textSecondary : tone }]}
            numberOfLines={2}
            testID="room-board-status-text"
            accessibilityLabel={text}
          >
            {text}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onRefresh}
        disabled={refreshing}
        testID="room-board-refresh"
        accessibilityRole="button"
        accessibilityLabel={t("roomBoard.header.refresh")}
        accessibilityState={{ disabled: refreshing, busy: refreshing }}
        style={({ pressed }) => [
          styles.refresh,
          { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
          pressed && { opacity: 0.7 },
        ]}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={theme.primaryAction} />
        ) : (
          <Ionicons name="refresh" size={20} color={theme.textPrimary} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 33, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  status: { flexShrink: 1, fontSize: 12.5, fontWeight: "600" },
  refresh: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
