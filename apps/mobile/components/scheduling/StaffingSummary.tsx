import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { SectionCard } from "@/components/supervisor/today/TodayBlocks";
import type { AttendanceCounts } from "@/lib/scheduling/teamScheduleModel";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const COUNT_KEYS = ["onShift", "onBreak", "upcoming", "notClockedIn", "shiftEnded"] as const;

function Stat({ value, label, testID }: { value: number | null; label: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surfaceMuted }]} accessible accessibilityLabel={`${label}: ${value ?? "?"}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statValue, { color: theme.textPrimary }]}>
        {value ?? "–"}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statLabel, { color: theme.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

interface Props {
  /** People with a shift on the selected day. null = the plan is not known. */
  scheduled: number | null;
  /** Verified attendance counts; null = no attendance claim is made (past/future day, unverified, or stale). */
  counts: AttendanceCounts | null;
  /** "Attendance read at 10:42 AM" for a verified read; null otherwise. */
  attendanceNote: string | null;
  /** Why there are no attendance counts, when the day should have had them. */
  attendanceMissing: boolean;
  isToday: boolean;
  t: Translate;
}

/**
 * The staffing overview. The headline is always the PLAN ("N scheduled"); attendance counts appear only when a
 * fresh, verified read backs them. It states no shortage and no required headcount: coverage against the day's
 * cleaning work is the staffing forecast's job (ForecastSummaryCard, just below), which carries its own data quality.
 */
export function StaffingSummary({ scheduled, counts, attendanceNote, attendanceMissing, isToday, t }: Props) {
  const theme = useTheme();
  return (
    <SectionCard testID="team-schedule-summary">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
        {isToday ? t("teamSchedule.summary.title") : t("teamSchedule.summary.planTitle")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headline, { color: theme.textPrimary }]} testID="team-schedule-scheduled-count">
        {scheduled === null ? t("teamSchedule.summary.scheduledUnknown") : t("teamSchedule.summary.scheduled", { count: scheduled })}
      </Text>

      {counts ? (
        <AttendanceCountsRow counts={counts} t={t} />
      ) : attendanceMissing ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.pickup }]} testID="team-schedule-attendance-missing">
          {t("teamSchedule.summary.attendanceMissing")}
        </Text>
      ) : !isToday ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="team-schedule-plan-only">
          {t("teamSchedule.summary.planOnly")}
        </Text>
      ) : null}

      {counts && counts.unscheduledOnShift > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="team-schedule-unscheduled-note">
          {t("teamSchedule.summary.unscheduledOnShift", { count: counts.unscheduledOnShift })}
        </Text>
      ) : null}
      {attendanceNote ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="team-schedule-attendance-note">
          {attendanceNote}
        </Text>
      ) : null}
    </SectionCard>
  );
}

/** Verified attendance counts; "Unknown" is shown only when somebody really is unknown. */
export function AttendanceCountsRow({ counts, t }: { counts: AttendanceCounts; t: Translate }) {
  return (
    <View style={styles.grid} testID="team-schedule-counts">
      {COUNT_KEYS.map((key) => (
        <Stat key={key} value={counts[key]} label={t(`teamSchedule.summary.counts.${key}`)} testID={`team-schedule-count-${key}`} />
      ))}
      {counts.unknown > 0 ? <Stat value={counts.unknown} label={t("teamSchedule.summary.counts.unknown")} testID="team-schedule-count-unknown" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 13, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  headline: { fontSize: 22, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "30%", flexGrow: 1, borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
