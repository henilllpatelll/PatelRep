import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Skeleton, UnavailableBlock, ProgressBar } from "@/components/supervisor/today/TodayBlocks";
import { R } from "@/components/shared/tokens";
import type { Derived } from "@/lib/housekeeping/supervisorSources";
import type { ReadinessSummary } from "@/lib/housekeeping/supervisorToday";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  readiness: Derived<ReadinessSummary>;
  /** Already-worded freshness line (or null). Only ever text the app can substantiate. */
  freshness: string | null;
  t: Translate;
  onOpen: () => void;
  onRetry: () => void;
}

/**
 * The primary status card. "ready / total" is ready ÷ in-service rooms (out-of-order rooms are
 * excluded and said so); rooms awaiting inspection are NOT ready. Unknown data is "unavailable", never 0.
 */
export function ReadinessCard({ readiness, freshness, t, onOpen, onRetry }: Props) {
  const theme = useTheme();
  const value = readiness.value;

  if (readiness.status === "loading") {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="today-readiness-loading" accessibilityLabel={t("supervisorToday.readiness.loading")}>
        <Skeleton height={14} width="40%" />
        <Skeleton height={38} width="55%" />
        <Skeleton height={10} />
        <Skeleton height={44} />
      </View>
    );
  }

  if (!value) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="today-readiness-unavailable">
        <UnavailableBlock
          title={t("supervisorToday.readiness.unavailable")}
          hint={t("supervisorToday.readiness.unavailableHint")}
          retryLabel={t("supervisorToday.status.retry")}
          onRetry={onRetry}
        />
      </View>
    );
  }

  const hasRooms = value.inService > 0;
  const stats = [
    { key: "toClean", label: t("supervisorToday.readiness.toClean"), count: value.toClean, color: theme.status.dirty },
    { key: "working", label: t("supervisorToday.readiness.working"), count: value.inProgress, color: theme.status.inProgress },
    { key: "inspect", label: t("supervisorToday.readiness.inspect"), count: value.awaitingInspection, color: theme.status.clean },
  ];

  return (
    <Pressable
      onPress={onOpen}
      testID="today-readiness"
      accessibilityRole="button"
      accessibilityLabel={`${t("supervisorToday.readiness.title")}. ${
        hasRooms ? t("supervisorToday.readiness.a11y", { ready: value.ready, total: value.inService }) : t("supervisorToday.readiness.empty")
      }. ${t("supervisorToday.readiness.open")}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.titleRow}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
          {t("supervisorToday.readiness.title").toUpperCase()}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>

      {hasRooms ? (
        <>
          <Text
            maxFontSizeMultiplier={1.3}
            style={[styles.hero, { color: theme.textPrimary }]}
            testID="today-readiness-ready"
            adjustsFontSizeToFit
            numberOfLines={1}
          >
            {t("supervisorToday.readiness.ready", { ready: value.ready, total: value.inService })}
          </Text>
          <ProgressBar fraction={value.progress ?? 0} color={theme.status.ready} height={10} testID="today-readiness-bar" />
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View key={stat.key} style={styles.stat} testID={`today-stat-${stat.key}`}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.statCount, { color: stat.count > 0 ? stat.color : theme.textPrimary }]}>
                  {stat.count}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statLabel, { color: theme.textSecondary }]} numberOfLines={2}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.empty} testID="today-readiness-empty">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: theme.textPrimary }]}>
            {t("supervisorToday.readiness.empty")}
          </Text>
          {value.inventoryTotal === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
              {t("supervisorToday.readiness.emptyHint")}
            </Text>
          ) : null}
        </View>
      )}

      {value.outOfOrder > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="today-readiness-ooo">
          {t("supervisorToday.readiness.outOfOrder", { count: value.outOfOrder })}
        </Text>
      ) : null}

      {freshness ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.note, { color: readiness.status === "stale" ? theme.status.pickup : theme.textMuted }]}
          testID="today-readiness-freshness"
        >
          {freshness}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.xl, padding: 18, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  hero: { fontSize: 40, lineHeight: 46, fontWeight: "700" },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, gap: 2 },
  statCount: { fontSize: 24, lineHeight: 28, fontWeight: "700" },
  statLabel: { fontSize: 12.5, fontWeight: "600" },
  empty: { gap: 4 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  note: { fontSize: 12.5, lineHeight: 17 },
});
