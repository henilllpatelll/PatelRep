import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { dueLabel, frequencyLabel, useDueTone } from "@/components/engineering/pm/pmUi";
import type { PmCompletionSummary } from "@/lib/api/pm";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import type { LoadFailure } from "@/lib/engineering/loadState";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import type { AssetWorkOrders } from "@/lib/engineering/useAssetWorkOrders";
import { Fact, Panel, PanelTitle } from "./assetUi";
import { WorkOrderList } from "./AssetWorkOrdersSection";
import { PM_LIST_ROUTE, pmRecordRoute, pmScheduleRoute } from "@/lib/engineering/routes";

interface Props {
  /** Open repairs and completed repairs for this asset (the Work Orders list lives here now). */
  active: AssetWorkOrders;
  completed: AssetWorkOrders;
  /** Engineers only see their own and unclaimed orders; the section says so rather than implying a full history. */
  scoped: boolean;
  /** The 90-day count when the API reports it for the inventory list; null when unknown. */
  repeats90d: number | null;
  schedules: readonly PmScheduleView[];
  history: readonly PmCompletionSummary[] | null;
  historyFailure: LoadFailure | null;
  hasMoreHistory: boolean;
  onLoadHistory: () => void;
  language: string;
  timezone: string | null | undefined;
}

function ScheduleRow({ schedule, language, timezone }: { schedule: PmScheduleView; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = useDueTone(schedule.state);
  const frequency = frequencyLabel(schedule, t);
  const last = formatDayYear(schedule.lastCompletedAt, timezone, language);
  return (
    <View style={[styles.item, { borderTopColor: theme.borderSubtle }]} testID={`asset-pm-${schedule.id}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemTitle, { color: theme.textPrimary }]}>
        {schedule.name}
      </Text>
      <View style={styles.facts}>
        <View style={[styles.duePill, { backgroundColor: tone.bg }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dueText, { color: tone.fg }]}>
            {dueLabel(schedule, t, language)}
          </Text>
        </View>
        {frequency ? <Fact icon="repeat-outline" text={frequency} /> : null}
        {schedule.estimatedMinutes ? <Fact icon="time-outline" text={t("pmSchedules.minutes", { count: schedule.estimatedMinutes })} /> : null}
        <Fact icon="checkmark-done-outline" text={last ? t("assets.maintenance.lastDone", { date: last }) : t("assets.maintenance.neverDone")} />
      </View>
      {/* The checklist workflow lives on the schedule: an inspection is never completed from an asset card. */}
      <Button
        label={t("assets.maintenance.openSchedule")}
        variant="secondary"
        size="sm"
        onPress={() => router.push((pmScheduleRoute(schedule.id) ?? PM_LIST_ROUTE) as never)}
        testID={`asset-pm-open-${schedule.id}`}
      />
    </View>
  );
}

/** PM schedules and inspection history for this asset, from the same Phase 5 data and rules the PM tab uses. */
export function AssetMaintenanceSection({ active, completed, scoped, repeats90d, schedules, history, historyFailure, hasMoreHistory, onLoadHistory, language, timezone }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.stack} testID="asset-maintenance">
      <Panel testID="asset-work-orders">
        <PanelTitle>{t("assets.maintenance.activeRepairs")}</PanelTitle>
        {repeats90d != null && repeats90d >= 2 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="asset-repeat-note">
            {t("assets.workOrders.repeat90d", { count: repeats90d })}
          </Text>
        ) : null}
        <WorkOrderList source={active} language={language} timezone={timezone} emptyBody={t("assets.workOrders.noActive")} />
      </Panel>

      <Panel>
        <PanelTitle>{t("assets.maintenance.schedules")}</PanelTitle>
        {schedules.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="asset-no-pm">
            {t("assets.maintenance.noSchedule")}
          </Text>
        ) : (
          schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} language={language} timezone={timezone} />)
        )}
      </Panel>

      <Panel>
        <PanelTitle>{t("assets.maintenance.records")}</PanelTitle>
        {history == null ? (
          historyFailure ? (
            <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onLoadHistory} testID="asset-pm-history-retry" />
          ) : (
            <Button label={t("assets.maintenance.showHistory")} variant="secondary" size="sm" onPress={onLoadHistory} testID="asset-pm-history-load" />
          )
        ) : history.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]}>
            {t("assets.maintenance.noHistory")}
          </Text>
        ) : (
          history.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => router.push((pmRecordRoute(row.id, row.pm_schedule_id) ?? PM_LIST_ROUTE) as never)}
              accessibilityRole="button"
              accessibilityLabel={t("assets.maintenance.openRecord", { name: row.schedule_name ?? "" })}
              style={[styles.item, styles.historyRow, { borderTopColor: theme.borderSubtle }]}
              testID={`asset-pm-record-${row.id}`}
            >
              <View style={styles.historyBody}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemTitle, { color: theme.textPrimary }]}>
                  {row.schedule_name ?? t("assets.maintenance.inspection")}
                </Text>
                <View style={styles.facts}>
                  <Fact icon="calendar-outline" text={formatDayYear(row.completed_at, timezone, language) ?? ""} />
                  {row.technician_name ? <Fact icon="person-outline" text={row.technician_name} /> : null}
                  <Fact icon="checkmark-circle-outline" text={t("assets.maintenance.passed", { count: row.passed_count })} />
                  {row.failed_count > 0 ? <Fact icon="close-circle-outline" text={t("assets.maintenance.failed", { count: row.failed_count })} tone="alert" /> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
            </Pressable>
          ))
        )}
        {history && hasMoreHistory ? (
          <Button label={t("assets.workOrders.loadMore")} variant="ghost" onPress={onLoadHistory} testID="asset-pm-history-more" />
        ) : null}
        {history && historyFailure ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]}>
            {t("assets.maintenance.historyFailed")}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subhead, { color: theme.textMuted }]} accessibilityRole="header">
          {t("assets.maintenance.completedRepairs")}
        </Text>
        <WorkOrderList source={completed} language={language} timezone={timezone} emptyBody={t("assets.workOrders.noCompleted")} />
        {scoped ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="asset-wo-scope">
            {t("assets.workOrders.scoped")}
          </Text>
        ) : null}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  item: { gap: 8, paddingTop: 12, borderTopWidth: 1 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 4 },
  historyBody: { flex: 1, gap: 5 },
  itemTitle: { fontSize: 14.5, fontWeight: "700" },
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  duePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  dueText: { fontSize: 12, fontWeight: "700" },
  empty: { fontSize: 13.5, lineHeight: 19 },
  subhead: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 8 },
});
