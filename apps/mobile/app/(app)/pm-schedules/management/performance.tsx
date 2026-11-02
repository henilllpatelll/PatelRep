import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { EngineeringSegmented } from "@/components/engineering/EngineeringSegmented";
import { ManagementHeader, SectionTitle } from "@/components/engineering/pm/management/ManagementChrome";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { getPmPerformance, type PmPerformancePeriod } from "@/lib/api/pmManagement";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { formatRate } from "@/lib/engineering/pmManagement";
import { useManagementResource } from "@/lib/engineering/useManagementResource";
import { canManagePmSchedules } from "@/lib/engineering/roles";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const PERIODS: readonly PmPerformancePeriod[] = ["today", "week", "month"];

/**
 * PM Performance: how maintenance was executed. Not a compliance verdict - nothing here certifies a safety or
 * regulatory requirement. A rate appears only from completions that recorded the deadline they met.
 */
export default function PmPerformanceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const allowed = canManagePmSchedules(user?.effective_role ?? user?.role);
  const [period, setPeriod] = useState<PmPerformancePeriod>("month");
  const perf = useManagementResource(() => getPmPerformance(period), [period], allowed);
  const data = perf.data;
  const state = resolveLoadState({ loading: perf.loading && !data, failure: allowed ? perf.failure : "forbidden", count: data ? 1 : 0, offline: !isOnline && !data });
  const rate = formatRate(data?.on_time_rate);

  const metrics: Array<[string, number | undefined, string]> = [
    ["onTime", data?.completed_on_time, "ready"],
    ["late", data?.completed_late, "pickup"],
    ["overdue", data?.still_overdue, "dirty"],
    ["upcoming", data?.upcoming_7_days, "clean"],
    ["deferred", data?.deferrals_approved, "inProgress"],
    ["findings", data?.inspections_with_findings, "pickup"],
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ManagementHeader title={t("pmMgmt.performance.title")} subtitle={t("pmMgmt.performance.subtitle")} testID="pm-performance" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void perf.reload()} tintColor={theme.primaryAction} />}>
        <EngineeringSegmented
          options={PERIODS.map((key) => ({ key, label: t(`pmMgmt.period.${key}`), testID: `pm-performance-period-${key}` }))}
          value={period}
          onChange={setPeriod}
          accessibilityLabel={t("pmMgmt.performance.title")}
        />
        {state.status !== "ready" || !data ? (
          <EngineeringState status={state.status === "ready" ? "loading" : state.status} onRetry={() => void perf.reload()} emptyTitle={t("pmMgmt.empty")} />
        ) : (
          <>
            <View accessible accessibilityLabel={rate ? t("pmMgmt.performance.rateA11y", { rate, onTime: data.rate_basis.numerator, total: data.rate_basis.denominator }) : t("pmMgmt.performance.rateNone")}>
            <Card style={styles.rate}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rateValue, { color: rate ? theme.textPrimary : theme.textMuted }]} testID="pm-performance-rate">
                {rate ?? "–"}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rateLabel, { color: theme.textSecondary }]}>
                {rate ? t("pmMgmt.performance.rateBasis", { onTime: data.rate_basis.numerator, total: data.rate_basis.denominator }) : t("pmMgmt.performance.rateNone")}
              </Text>
            </Card>
            </View>

            <View style={styles.grid}>
              {metrics.map(([key, value, tone]) => {
                const color = (theme.status as unknown as Record<string, string>)[tone];
                const soft = (theme.status as unknown as Record<string, string>)[`${tone}Soft`];
                return (
                  <View key={key} style={[styles.tile, { backgroundColor: soft, borderColor: theme.borderSubtle }]} accessible accessibilityLabel={`${t(`pmMgmt.performance.metric.${key}`)}: ${value ?? t("pm.unknownCount")}`} testID={`pm-performance-${key}`}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileValue, { color }]}>{value ?? "–"}</Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileLabel, { color }]} numberOfLines={2}>{t(`pmMgmt.performance.metric.${key}`)}</Text>
                  </View>
                );
              })}
            </View>

            {data.no_recorded_deadline > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-performance-unclassified">
                {t("pmMgmt.performance.unclassified", { count: data.no_recorded_deadline })}
              </Text>
            ) : null}
            <SectionTitle>{t("pmMgmt.performance.aboutTitle")}</SectionTitle>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>{t("pmMgmt.performance.about")}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  rate: { padding: 16, gap: 4, alignItems: "flex-start" },
  rateValue: { fontSize: 40, fontWeight: "700" },
  rateLabel: { fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "47%", minHeight: 76, borderRadius: 14, borderWidth: 1, padding: 12, justifyContent: "center", gap: 2 },
  tileValue: { fontSize: 26, fontWeight: "700" },
  tileLabel: { fontSize: 13, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 19 },
});
