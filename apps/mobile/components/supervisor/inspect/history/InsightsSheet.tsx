import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { rateText } from "@/components/supervisor/inspect/history/QualityInsightsCard";
import { TrendChart } from "@/components/supervisor/inspect/history/TrendChart";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { Insights } from "@/lib/api/inspectionHistory";
import { buildInsightsView, buildTrend, durationParts } from "@/lib/inspections/history/insights";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Everything behind the Quality Insights card, for one period: how each number is counted, the daily trend, the most
 * common failed standards, rooms that keep failing, and what happened to the corrections. A standard or room opens the
 * history list filtered to the underlying inspections. Sparse data is called sparse - no conclusions are drawn from it.
 */
export function InsightsSheet({
  visible,
  data,
  periodLabel,
  language,
  t,
  onDrillStandard,
  onDrillRoom,
  onClose,
}: {
  visible: boolean;
  data: Insights | null;
  periodLabel: string;
  language: string;
  t: Translate;
  onDrillStandard: (standard: { id: string; label: string }) => void;
  onDrillRoom: (roomNumber: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const view = data ? buildInsightsView(data) : null;
  const trend = data ? buildTrend(data.daily, data.truncated) : null;
  return (
    <WorkspaceSheet visible={visible} title={t("inspect.history.insights.detailsTitle")} onClose={onClose} onBackdrop={onClose} closeLabel={t("inspect.record.close")} testID="insights-sheet" t={t}>
      {view && data ? (
        <View style={styles.body}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.period, { color: theme.textMuted }]}>
            {periodLabel}
          </Text>

          <Section title={t("inspect.history.insights.firstPass")}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.big, { color: theme.textPrimary }]} testID="insights-detail-rate">
              {rateText(view, t)}
            </Text>
            {view.rate.kind === "value" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
                {t("inspect.history.insights.firstPassOf", { passed: view.rate.passed, eligible: view.rate.eligible })}
                {view.rate.smallSample ? ` ${t("inspect.history.insights.smallSample")}` : ""}
              </Text>
            ) : (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
                {t(view.rate.reason === "truncated" ? "inspect.history.insights.truncated" : "inspect.history.insights.noInitial")}
              </Text>
            )}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
              {t("inspect.history.insights.firstPassDefinition")}
            </Text>
            {view.conditionalExcluded > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="insights-conditional-note">
                {t("inspect.history.insights.conditionalNote", { count: view.conditionalExcluded })}
              </Text>
            ) : null}
            {view.withoutLineage > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="insights-lineage-note">
                {t("inspect.history.insights.lineageNote", { count: view.withoutLineage })}
              </Text>
            ) : null}
          </Section>

          {trend ? (
            <Section title={t("inspect.history.insights.trend")}>
              <TrendChart trend={trend} language={language} t={t} />
            </Section>
          ) : (
            <Section title={t("inspect.history.insights.trend")}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="insights-no-trend">
                {t("inspect.history.insights.noTrend")}
              </Text>
            </Section>
          )}

          <Section title={t("inspect.history.insights.commonIssues")}>
            {view.sparse ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="insights-sparse">
                {t("inspect.history.insights.sparse", { count: view.failed })}
              </Text>
            ) : null}
            {view.topStandards.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
                {view.failed === 0 ? t("inspect.history.insights.noFailures") : t("inspect.history.insights.noIssueDetail")}
              </Text>
            ) : (
              view.topStandards.map((standard, index) => {
                const label = standard.label ?? t("inspect.history.insights.removedStandard");
                return (
                  <Drill
                    key={standard.standard_id}
                    label={`${index + 1}. ${label}`}
                    sub={standard.section ?? undefined}
                    value={String(standard.count)}
                    a11y={t("inspect.history.insights.drillStandardA11y", { label, count: standard.count })}
                    onPress={() => onDrillStandard({ id: standard.standard_id, label })}
                    testID={`insights-standard-${index}`}
                  />
                );
              })
            )}
            {view.unidentifiedFailures > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
                {t("inspect.history.insights.unidentified", { count: view.unidentifiedFailures })}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
              {t("inspect.history.insights.standardsDefinition")}
            </Text>
          </Section>

          <Section title={t("inspect.history.insights.repeated")}>
            {view.sparse ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
                {t("inspect.history.insights.sparseRepeats")}
              </Text>
            ) : view.repeatRooms.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="insights-no-repeats">
                {t("inspect.history.insights.noRepeats")}
              </Text>
            ) : (
              view.repeatRooms.map((room) => (
                <Drill
                  key={room.room_id}
                  label={t("inspect.history.insights.roomFailed", { room: room.room_number ?? "—", count: room.failed_count })}
                  value={String(room.failed_count)}
                  a11y={t("inspect.history.insights.drillRoomA11y", { room: room.room_number ?? "—", count: room.failed_count })}
                  onPress={() => room.room_number && onDrillRoom(room.room_number)}
                  disabled={!room.room_number}
                  testID={`insights-room-${room.room_id}`}
                />
              ))
            )}
            {!view.sparse && view.repeatStandards.length > 0
              ? view.repeatStandards.map((row) => (
                  <Text key={`${row.room_id}-${row.standard_id}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID={`insights-repeat-${row.room_id}-${row.standard_id}`}>
                    {t("inspect.history.insights.roomStandard", { room: row.room_number ?? "—", label: row.label ?? t("inspect.history.insights.removedStandard"), count: row.count })}
                  </Text>
                ))
              : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
              {t("inspect.history.insights.repeatedNote")}
            </Text>
          </Section>

          {view.corrections.shown ? (
            <Section title={t("inspect.history.insights.corrections")}>
              <Line label={t("inspect.history.insights.correctionsVerified")} value={view.corrections.verified} />
              <Line label={t("inspect.history.insights.correctionsFailedAgain")} value={view.corrections.failed_again} />
              <Line label={t("inspect.history.insights.correctionsNone")} value={view.corrections.no_reinspection_recorded} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="insights-verification">
                {view.verification.available && view.verification.medianMinutes !== null
                  ? t("inspect.history.insights.verificationMedian", { ...durationParts(view.verification.medianMinutes), count: view.verification.sample })
                  : t("inspect.history.insights.verificationUnavailable", { sample: view.verification.sample, minimum: view.verification.minimum })}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
                {t("inspect.history.insights.verificationDefinition")}
              </Text>
            </Section>
          ) : null}
        </View>
      ) : null}
    </WorkspaceSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.textMuted }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function Drill({ label, sub, value, a11y, onPress, disabled, testID }: { label: string; sub?: string; value: string; a11y: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID={testID}
      style={({ pressed }) => [styles.drill, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.drillText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.drillLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        {sub ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
      {!disabled ? <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  period: { fontSize: 13, fontWeight: "600" },
  section: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  big: { fontSize: 30, fontWeight: "800" },
  note: { fontSize: 13, lineHeight: 19 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 26, alignItems: "center" },
  lineLabel: { flex: 1, fontSize: 14 },
  lineValue: { fontSize: 15, fontWeight: "800" },
  drill: { minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  drillText: { flex: 1, minWidth: 0 },
  drillLabel: { fontSize: 14.5, fontWeight: "700", lineHeight: 20 },
});
