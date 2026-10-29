import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { ViewSwitch } from "@/components/scheduling/ViewSwitch";
import type { TeamScheduleView } from "@/lib/navigation/teamScheduleLink";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  topInset: number;
  view: TeamScheduleView;
  onView: (view: TeamScheduleView) => void;
  /** "Thursday, October 29" for the selected day. */
  dateLabel: string;
  isToday: boolean;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  /** Honest freshness sentence ("Updated 10:42 AM" / "Saved schedule from 10:42 AM — not live"), or null while loading. */
  freshness: { text: string; stale: boolean } | null;
  t: Translate;
}

function IconButton({ icon, label, onPress, testID, disabled }: { icon: "chevron-back" | "chevron-forward" | "refresh"; label: string; onPress: () => void; testID: string; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: disabled && icon === "refresh" }}
      testID={testID}
      style={({ pressed }) => [styles.icon, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
    >
      {disabled && icon === "refresh" ? <ActivityIndicator size="small" color={theme.primaryAction} /> : <Ionicons name={icon} size={20} color={theme.textPrimary} />}
    </Pressable>
  );
}

/** Back path, title, refresh, the Today/Week switch, and day-by-day navigation. */
export function ScheduleHeader({ topInset, view, onView, dateLabel, isToday, onPrevDay, onNextDay, onToday, refreshing, onRefresh, onBack, freshness, t }: Props) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="team-schedule-header">
      <View style={styles.titleRow}>
        <IconButton icon="chevron-back" label={t("teamSchedule.back")} onPress={onBack} testID="team-schedule-back" />
        <View style={styles.titleText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} numberOfLines={1}>
            {t("teamSchedule.kicker").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
            {t("teamSchedule.title")}
          </Text>
        </View>
        <IconButton icon="refresh" label={t("teamSchedule.refresh")} onPress={onRefresh} testID="team-schedule-refresh" disabled={refreshing} />
      </View>

      <ViewSwitch value={view} onChange={onView} t={t} />

      {view === "today" ? (
        <View style={styles.dayRow} testID="team-schedule-day-nav">
          <IconButton icon="chevron-back" label={t("teamSchedule.prevDay")} onPress={onPrevDay} testID="team-schedule-prev-day" />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textPrimary }]} numberOfLines={2} accessibilityRole="header" accessibilityLiveRegion="polite" testID="team-schedule-date">
            {dateLabel}
          </Text>
          <IconButton icon="chevron-forward" label={t("teamSchedule.nextDay")} onPress={onNextDay} testID="team-schedule-next-day" />
        </View>
      ) : null}

      {!isToday && view === "today" ? (
        <Pressable onPress={onToday} accessibilityRole="button" accessibilityLabel={t("teamSchedule.backToToday")} testID="team-schedule-back-to-today" style={({ pressed }) => [styles.todayJump, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.75 }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.todayJumpText, { color: theme.primaryAction }]}>
            {t("teamSchedule.backToToday")}
          </Text>
        </Pressable>
      ) : null}

      {freshness ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.fresh, { color: freshness.stale ? theme.status.pickup : theme.textSecondary }]} testID="team-schedule-freshness">
          {freshness.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleText: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { fontSize: 24, fontWeight: "800" },
  icon: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  date: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700" },
  todayJump: { alignSelf: "center", minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: "center" },
  todayJumpText: { fontSize: 14, fontWeight: "700" },
  fresh: { fontSize: 12.5, lineHeight: 17, textAlign: "center" },
});
