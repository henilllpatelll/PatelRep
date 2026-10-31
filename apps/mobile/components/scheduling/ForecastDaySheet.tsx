import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { Breakdown, Hero, Recommendations } from "@/components/scheduling/ForecastParts";
import type { ForecastDay, ForecastRecommendation } from "@/lib/api/schedulingForecast";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { capacityAssumption, durationText, factText, heroFor, limitationText, reasonText, sourceText } from "@/lib/scheduling/forecastModel";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  day: ForecastDay | null;
  zone: string | null;
  language?: string;
  onClose: () => void;
  onAction: (item: ForecastRecommendation) => void;
  t: Translate;
}

function Group({ title, children, testID }: { title: string; children: React.ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.group} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One day's forecast in full: what was counted, where each number came from, and what could not be assessed. Plain
 * words only — no database names, no employee names. Read-only; the recommendations at the bottom lead to screens
 * that already exist.
 */
export function ForecastDaySheet({ day, zone, language, onClose, onAction, t }: Props) {
  const theme = useTheme();
  if (!day) return null;
  const na = t("teamSchedule.forecast.unavailable");
  const demand = factText(day.demand.minutes, t);
  const capacity = factText(day.capacity.productive, t);
  const difference =
    day.gap.minutes === null || day.status === "unknown"
      ? na
      : t(day.status === "short" ? "teamSchedule.forecast.metrics.gapShort" : "teamSchedule.forecast.metrics.gapSpare", { duration: durationText(Math.abs(day.gap.minutes), t) });
  // The hero already says why a day cannot be assessed; the list below only adds what it does not.
  const heroBody = heroFor(day, t).body;
  const limitations = day.limitations.flatMap((code) => {
    const text = limitationText(code, t);
    return text && text !== heroBody ? [text] : [];
  });
  const reasons = day.demand.incompleteReasons.map((code) => reasonText(code, t)).filter((text) => text !== heroBody);
  const cap = day.capacity;

  return (
    <CoverageSheet
      visible
      title={formatLongDate(day.date, language)}
      subtitle={t("teamSchedule.forecast.drawer.subtitle")}
      closeLabel={t("common.close")}
      onClose={onClose}
      testID="forecast-sheet"
    >
      <Hero day={day} t={t} testID="forecast-sheet-hero" />

      <Group title={t("teamSchedule.forecast.drawer.comparison")} testID="forecast-sheet-comparison">
        <Line label={t("teamSchedule.forecast.drawer.demand")} value={demand ?? na} testID="forecast-sheet-demand" />
        <Line label={t("teamSchedule.forecast.drawer.capacity")} value={capacity ?? na} testID="forecast-sheet-capacity" />
        <Line label={t("teamSchedule.forecast.drawer.difference")} value={difference} testID="forecast-sheet-difference" />
        <Line label={t("teamSchedule.forecast.drawer.quality")} value={t(`teamSchedule.forecast.qualityShort.${day.quality}`)} testID="forecast-sheet-quality" />
      </Group>

      <Breakdown day={day} t={t} />

      <Group title={t("teamSchedule.forecast.drawer.laborTitle")} testID="forecast-sheet-labor">
        <Line label={t("teamSchedule.forecast.drawer.people")} value={cap.people === null ? na : String(cap.people)} />
        {cap.shifts.map((shift) => (
          <Line
            key={`${shift.shiftId ?? shift.name}`}
            label={`${shift.name ?? t("teamSchedule.coverage.shiftFallback")} · ${t("teamSchedule.forecast.peopleCount", { count: shift.people })}`}
            value={durationText(shift.productiveMinutes, t)}
          />
        ))}
        {cap.confirmedCallouts ? <Line label={t("teamSchedule.forecast.drawer.callouts")} value={String(cap.confirmedCallouts)} testID="forecast-sheet-callouts" /> : null}
        {cap.replacements ? <Line label={t("teamSchedule.forecast.drawer.replacements")} value={String(cap.replacements)} testID="forecast-sheet-replacements" /> : null}
        {cap.leaveReducedShifts ? <Line label={t("teamSchedule.forecast.drawer.leave")} value={String(cap.leaveReducedShifts)} /> : null}
        {cap.draftShifts ? <Line label={t("teamSchedule.forecast.drawer.drafts")} value={String(cap.draftShifts)} /> : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="forecast-sheet-assumption">
          {capacityAssumption(day, t)}
        </Text>
        {day.current ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="forecast-sheet-current">
            {day.current.verified
              ? t("teamSchedule.forecast.drawer.currentVerified", { working: day.current.working ?? 0, scheduled: day.current.scheduledPeople })
              : t("teamSchedule.forecast.drawer.currentUnverified")}
          </Text>
        ) : null}
      </Group>

      {limitations.length > 0 || reasons.length > 0 ? (
        <Group title={t("teamSchedule.forecast.drawer.limitations")} testID="forecast-sheet-limitations">
          {[...new Set([...reasons, ...limitations])].map((text) => (
            <Text key={text} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
              {`• ${text}`}
            </Text>
          ))}
        </Group>
      ) : null}

      <Group title={t("teamSchedule.forecast.drawer.sources")} testID="forecast-sheet-sources">
        {day.sources.map((source) => (
          <Text key={source.code} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
            {`• ${sourceText(source, t, source.asOf ? formatHotelTime(new Date(source.asOf), zone, language) : null)}`}
          </Text>
        ))}
      </Group>

      <Recommendations items={day.recommendations} onAction={onAction} t={t} />
    </CoverageSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, marginTop: 14 },
  groupTitle: { fontSize: 12.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center", minHeight: 30 },
  lineLabel: { flex: 1, fontSize: 14.5, fontWeight: "600" },
  lineValue: { fontSize: 14.5, fontWeight: "800", textAlign: "right" },
  note: { fontSize: 13.5, lineHeight: 19, fontWeight: "500" },
});
