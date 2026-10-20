import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { ProgressBar } from "@/components/supervisor/today/TodayBlocks";
import type { BoardMetrics } from "@/lib/housekeeping/roomBoardSelectors";
import type { AttentionKey, AttentionSignal } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One compact readiness card. Ready = INSPECTED only; "to inspect" (CLEAN) is not ready. The denominator is
 * in-service rooms, out-of-service rooms are named separately, and an unrecognised status is counted aloud.
 * With nothing in service there is no percentage to claim, so there is no bar.
 */
export function BoardReadinessCard({ metrics, t }: { metrics: BoardMetrics; t: Translate }) {
  const theme = useTheme();
  const hasRooms = metrics.inService > 0;
  const stats = [
    { key: "toClean", label: t("roomBoard.card.toClean"), count: metrics.toClean, color: theme.status.dirty },
    { key: "working", label: t("roomBoard.card.working"), count: metrics.inProgress, color: theme.status.inProgress },
    { key: "toInspect", label: t("roomBoard.card.toInspect"), count: metrics.awaitingInspection, color: theme.status.clean },
    { key: "ready", label: t("roomBoard.card.ready"), count: metrics.guestReady, color: theme.status.ready },
  ];
  const headline = hasRooms
    ? t("roomBoard.card.headline", { ready: metrics.guestReady, total: metrics.inService })
    : t("roomBoard.card.noneInService");
  const footer = [
    t("roomBoard.card.totalRooms", { count: metrics.inventory }),
    metrics.unavailable > 0 ? t("roomBoard.card.outOfService", { count: metrics.unavailable }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
      testID="room-board-readiness"
      accessible
      accessibilityLabel={`${t("roomBoard.card.title")}. ${headline}. ${stats.map((s) => `${s.count} ${s.label}`).join(", ")}. ${footer}`}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
        {t("roomBoard.card.title").toUpperCase()}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.headline, { color: theme.textPrimary }]}
        numberOfLines={2}
        testID="room-board-readiness-headline"
      >
        {headline}
      </Text>
      {hasRooms ? <ProgressBar fraction={metrics.readiness ?? 0} color={theme.status.ready} height={10} testID="room-board-readiness-bar" /> : null}
      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.key} style={styles.stat} testID={`room-board-stat-${stat.key}`}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.statCount, { color: stat.count > 0 ? stat.color : theme.textPrimary }]}>
              {stat.count}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statLabel, { color: theme.textSecondary }]} numberOfLines={2}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="room-board-readiness-footer">
        {footer}
      </Text>
      {metrics.unknown > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.pickup }]} testID="room-board-readiness-unknown">
          {t("roomBoard.card.unrecognized", { count: metrics.unknown })}
        </Text>
      ) : null}
    </View>
  );
}

const SIGNAL_ICON: Record<AttentionKey, "person-remove-outline" | "flash-outline" | "moon-outline" | "star-outline"> = {
  unassigned: "person-remove-outline",
  urgent: "flash-outline",
  dnd: "moon-outline",
  vip: "star-outline",
};

/** Informational chips for substantiated, non-zero signals. They are not buttons: nothing here is filterable until Phase 3. */
export function BoardAttentionChips({ signals, t }: { signals: AttentionSignal[]; t: Translate }) {
  const theme = useTheme();
  if (signals.length === 0) return null;
  return (
    <View style={styles.chips} testID="room-board-attention">
      {signals.map((signal) => {
        const urgent = signal.key === "urgent" || signal.key === "unassigned";
        const fg = urgent ? theme.status.dirty : signal.key === "vip" ? theme.status.pickup : theme.textSecondary;
        const bg = urgent ? theme.status.dirtySoft : signal.key === "vip" ? theme.status.pickupSoft : theme.surfaceMuted;
        const line = urgent ? theme.status.dirtyLine : signal.key === "vip" ? theme.status.pickupLine : theme.border;
        const label = t(`roomBoard.attention.${signal.key}`, { count: signal.count });
        return (
          <View
            key={signal.key}
            accessible
            accessibilityRole="text"
            accessibilityLabel={label}
            style={[styles.chip, { backgroundColor: bg, borderColor: line }]}
            testID={`room-board-signal-${signal.key}`}
          >
            <Ionicons name={SIGNAL_ICON[signal.key]} size={13} color={fg} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: fg }]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, borderWidth: 1, borderRadius: R.xl, padding: 14, gap: 8 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  headline: { fontSize: 30, lineHeight: 36, fontWeight: "700" },
  stats: { flexDirection: "row", gap: 6 },
  stat: { flex: 1, gap: 1 },
  statCount: { fontSize: 22, lineHeight: 26, fontWeight: "700" },
  statLabel: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 12.5, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: 16, marginTop: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
});
