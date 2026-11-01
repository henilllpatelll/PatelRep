import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { Meta, dueLabel, frequencyLabel, locationLabel, useDueTone } from "@/components/engineering/pm/pmUi";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { getPmAsset, listAssetMeters, listPmCompletions, type PmAssetDetail, type PmCompletionSummary } from "@/lib/api/pm";
import { usePmSchedules } from "@/lib/engineering/usePmSchedules";
import { adaptPmMeters, referenceRange, type PmMeter } from "@/lib/engineering/pmReadings";
import { loadPmDraft } from "@/lib/engineering/pmDraftStore";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { canCompletePm } from "@/lib/engineering/roles";
import { ASSETS_LIST_ROUTE, PM_LIST_ROUTE as PM_LIST, assetRoute, pmInspectRoute, pmRecordRoute } from "@/lib/engineering/routes";
import { formatDueDate } from "@/lib/engineering/pmSchedules";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

export default function PmScheduleDetailScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const canInspect = canCompletePm(user?.effective_role ?? user?.role);
  const data = usePmSchedules();
  const schedule = useMemo(() => data.schedules.find((s) => s.id === scheduleId) ?? null, [data.schedules, scheduleId]);
  /** The exact equipment this schedule is for; the general list is only the fallback when it is unknown or malformed. */
  const exactAssetRoute = assetRoute(schedule?.assetId);
  const tone = useDueTone(schedule?.state ?? "unscheduled");

  const [asset, setAsset] = useState<PmAssetDetail | null>(null);
  const [meters, setMeters] = useState<PmMeter[]>([]);
  const [history, setHistory] = useState<PmCompletionSummary[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const assetId = schedule?.assetId ?? null;

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    // Context is a nicety: each read fails on its own without taking the screen down.
    void getPmAsset(assetId).then((a) => !cancelled && setAsset(a)).catch(() => undefined);
    void listAssetMeters(assetId).then((m) => !cancelled && setMeters(adaptPmMeters(m))).catch(() => undefined);
    void listPmCompletions({ assetId, limit: 5 }).then((p) => !cancelled && setHistory(p.rows)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  useFocusEffect(
    useCallback(() => {
      if (scheduleId) void loadPmDraft(scheduleId).then((d) => setHasDraft(!!d));
    }, [scheduleId]),
  );

  const load = resolveLoadState({ loading: data.loading && !data.hasData, failure: data.failure, count: schedule ? 1 : 0, offline: !isOnline && !data.hasData });
  const language = i18n.language;
  const lastDone = schedule ? formatDueDate(hotelDateKey(schedule.lastCompletedAt, hotelTimezone), language) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="pm-detail-back">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerTitle, { color: theme.shell.ink }]} numberOfLines={1} accessibilityRole="header">
          {t("pm.detail.title")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        {schedule ? (
          <>
            <View style={styles.summary}>
              <View style={[styles.duePill, { backgroundColor: tone.bg }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dueText, { color: tone.fg }]}>
                  {dueLabel(schedule, t, language)}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                {schedule.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                {[schedule.assetName, locationLabel(schedule, t)].filter(Boolean).join(" · ")}
              </Text>
              <View style={styles.metaRow}>
                {frequencyLabel(schedule, t) ? <Meta icon="refresh-outline" text={frequencyLabel(schedule, t)!} /> : null}
                {schedule.estimatedMinutes ? <Meta icon="time-outline" text={t("pmSchedules.minutes", { count: schedule.estimatedMinutes })} /> : null}
              </View>
              {hasDraft ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.draftNote, { color: theme.status.pickup }]} testID="pm-detail-draft">
                  {t("pm.localDraftNote")}
                </Text>
              ) : null}
            </View>

            <Section title={t("pm.detail.equipment")}>
              <Row label={t("pm.detail.assetTag")} value={asset?.asset_tag ?? schedule.assetTag} />
              <Row label={t("pm.detail.type")} value={asset?.asset_categories?.name ?? schedule.categoryName} />
              <Row label={t("pm.detail.manufacturer")} value={asset?.manufacturer ?? schedule.manufacturer} />
              <Row label={t("pm.detail.model")} value={asset?.model} />
              <Row label={t("pm.detail.serial")} value={asset?.serial_number} />
              <Row label={t("pm.detail.location")} value={locationLabel(schedule, t)} />
              <Row label={t("pm.detail.lastCompleted")} value={lastDone ?? t("pmSchedules.never")} />
            </Section>

            <Section title={t("pm.detail.inspection")}>
              {schedule.description ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                  {schedule.description}
                </Text>
              ) : null}
              <Row label={t("pm.detail.estimated")} value={schedule.estimatedMinutes ? t("pmSchedules.minutes", { count: schedule.estimatedMinutes }) : null} />
              <Row label={t("pm.detail.assignedRole")} value={schedule.assignedToRole ? schedule.assignedToRole.replace(/_/g, " ") : null} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("pm.detail.checklistChosen")}
              </Text>
            </Section>

            {meters.length > 0 ? (
              <Section title={t("pm.detail.readings")}>
                {meters.map((meter) => {
                  const range = referenceRange(meter);
                  return (
                    <View key={meter.id} style={styles.meterRow} testID={`pm-detail-meter-${meter.id}`}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary, flex: 1 }]}>
                        {meter.name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
                        {range
                          ? t("pm.reading.reference", { low: range.low ?? "–", high: range.high ?? "–", unit: meter.unit })
                          : meter.unit}
                      </Text>
                    </View>
                  );
                })}
              </Section>
            ) : null}

            <Section title={t("pm.detail.previous")}>
              {history.length === 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.detail.noPrevious")}
                </Text>
              ) : (
                history.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => router.push((pmRecordRoute(row.id, row.pm_schedule_id) ?? PM_LIST) as never)}
                    style={styles.historyRow}
                    accessibilityRole="button"
                    testID={`pm-detail-history-${row.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
                        {formatDueDate(hotelDateKey(row.completed_at, hotelTimezone), language)}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
                        {[row.technician_name, row.failed_count > 0 ? t("pm.countFailed", { count: row.failed_count }) : t("pm.allPassed")].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
                  </Pressable>
                ))
              )}
            </Section>

            <Pressable
              onPress={() => router.push((exactAssetRoute ?? ASSETS_LIST_ROUTE) as never)}
              style={styles.assetLink}
              accessibilityRole="button"
              testID="pm-detail-assets"
            >
              <Ionicons name="cube-outline" size={18} color={theme.primaryAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assetLinkText, { color: theme.primaryAction }]}>
                {exactAssetRoute ? t("pm.detail.openAsset") : t("pm.detail.openAssets")}
              </Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.state}>
            <EngineeringState
              status={load.status === "ready" ? "empty" : load.status === "loading" ? "loading" : load.status}
              onRetry={() => void data.reload()}
              emptyIcon="calendar-outline"
              emptyTitle={t("pm.detail.notFound")}
              emptyBody={t("pm.detail.notFoundBody")}
            />
          </View>
        )}
      </ScrollView>

      {schedule && canInspect ? (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: insets.bottom + 12 }]}>
          <Button
            label={hasDraft ? t("pm.continueInspection") : t("pm.startInspection")}
            onPress={() => router.push((pmInspectRoute(schedule.id) ?? PM_LIST) as never)}
            size="lg"
            testID="pm-detail-start"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700" },
  content: { padding: 16, gap: 16 },
  summary: { gap: 6 },
  duePill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dueText: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 14 },
  metaRow: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  draftNote: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  card: { padding: 14, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  body: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  assetLink: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  assetLinkText: { fontSize: 14, fontWeight: "700" },
  state: { paddingTop: 40 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
});
