import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { getAssetDocumentUrl, type AssetDocument, type AssetDowntime, type AssetReliability } from "@/lib/api/assets";
import { formatDayTime, formatDayYear, formatSpan } from "@/lib/engineering/assetFormat";
import { ASSET_HISTORY_GROUPS, filterAssetEvents, historyGroupCounts, type AssetEvent, type AssetHistoryGroup } from "@/lib/engineering/assetModel";
import { useToast } from "@/lib/theme/useToast";
import { pmRecordRoute, workOrderRoute } from "@/lib/engineering/routes";
import { DetailRow, Fact, Panel, PanelTitle, Pill } from "./assetUi";

interface Resource<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
  reload: () => void;
}

interface Props {
  events: readonly AssetEvent[];
  downtime: Resource<AssetDowntime[]>;
  reliability: Resource<AssetReliability>;
  documents: Resource<AssetDocument[]>;
  language: string;
  timezone: string | null | undefined;
}

const EVENT_ICON = {
  downtime_started: "ban-outline",
  downtime_restored: "refresh-circle-outline",
  work_order_created: "add-circle-outline",
  repair_completed: "checkmark-done-outline",
  pm_completed: "calendar-outline",
  reading_recorded: "speedometer-outline",
} as const;

function Retry({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onPress} />;
}

function Timeline({ events, language, timezone }: { events: readonly AssetEvent[]; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (events.length === 0) {
    return <Text style={[styles.hint, { color: theme.textMuted }]}>{t("assets.history.noEvents")}</Text>;
  }
  return (
    <View testID="asset-timeline">
      {events.map((event) => {
        const variant =
          event.type === "downtime_started" && (event.impact === "out_of_service" || event.impact === "degraded") ? `downtime_started_${event.impact}` : event.type;
        const text = t(`assets.history.events.${variant}`, { label: event.label ?? "" });
        const open = () => {
          if (event.workOrderId && (event.type === "work_order_created" || event.type === "repair_completed")) {
            const href = workOrderRoute(event.workOrderId);
            if (href) router.push(href as never);
          } else if (event.type === "pm_completed" && event.recordId && event.scheduleId) {
            const href = pmRecordRoute(event.recordId, event.scheduleId);
            if (href) router.push(href as never);
          }
        };
        const tappable = event.type === "work_order_created" || event.type === "repair_completed" || event.type === "pm_completed";
        const body = (
          <>
            <Ionicons name={EVENT_ICON[event.type]} size={17} color={theme.textMuted} />
            <View style={styles.eventText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventLabel, { color: theme.textPrimary }]}>
                {text}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventDate, { color: theme.textMuted }]}>
                {formatDayTime(event.at, timezone, language)}
              </Text>
            </View>
          </>
        );
        return tappable ? (
          <Pressable key={event.key} onPress={open} accessibilityRole="button" accessibilityLabel={text} style={styles.event}>
            {body}
            <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
          </Pressable>
        ) : (
          <View key={event.key} style={styles.event}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

function Downtime({ res, language, timezone }: { res: Props["downtime"]; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (res.data == null) return res.failed ? <Retry onPress={res.reload} /> : <Text style={{ color: theme.textMuted }}>{t("common.loading")}</Text>;
  if (res.data.length === 0) return <Text style={[styles.hint, { color: theme.textMuted }]}>{t("assets.history.noDowntime")}</Text>;
  return (
    <View testID="asset-downtime">
      {res.data.map((period) => {
        const open = !period.restored_at;
        const minutes = period.elapsed_minutes ?? (period.restored_at ? Math.round((Date.parse(period.restored_at) - Date.parse(period.started_at)) / 60000) : null);
        return (
          <View key={period.id} style={[styles.period, { borderTopColor: theme.borderSubtle }]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventLabel, { color: theme.textPrimary }]}>
              {period.impact_level ? t(`assets.history.impact.${period.impact_level}`, { defaultValue: period.impact_level }) : t("assets.history.downtime")}
              {open ? ` · ${t("assets.history.ongoing")}` : ""}
            </Text>
            <View style={styles.facts}>
              <Fact icon="play-outline" text={t("assets.history.from", { date: formatDayTime(period.started_at, timezone, language) ?? "" })} />
              {period.restored_at ? <Fact icon="stop-outline" text={t("assets.history.to", { date: formatDayTime(period.restored_at, timezone, language) ?? "" })} /> : null}
              {formatSpan(minutes) ? <Fact icon="timer-outline" text={formatSpan(minutes) as string} /> : null}
              {period.downtime_type ? <Fact icon="pricetag-outline" text={t(`assets.history.type.${period.downtime_type}`, { defaultValue: period.downtime_type })} /> : null}
            </View>
            {period.notes?.trim() ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{period.notes.trim()}</Text> : null}
            {period.work_order_id ? (
              <Button
                label={t("assets.history.openWo")}
                variant="ghost"
                size="sm"
                onPress={() => router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: period.work_order_id as string } })}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Reliability({ res, language, timezone }: { res: Props["reliability"]; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (res.data == null) return res.failed ? <Retry onPress={res.reload} /> : <Text style={{ color: theme.textMuted }}>{t("common.loading")}</Text>;
  const r = res.data;
  const since = formatDayYear(r.tracking_started_at, timezone, language);
  return (
    <View style={{ gap: 8 }} testID="asset-reliability-stats">
      {since ? <Text style={[styles.hint, { color: theme.textMuted }]}>{t("assets.history.trackingSince", { date: since })}</Text> : <Text style={[styles.hint, { color: theme.textMuted }]}>{t("assets.history.notTracked")}</Text>}
      {r.failure_count_12mo != null ? <DetailRow label={t("assets.history.failures12")} value={String(r.failure_count_12mo)} /> : null}
      {formatSpan(r.downtime_12mo_minutes) ? <DetailRow label={t("assets.history.downtime12")} value={formatSpan(r.downtime_12mo_minutes) as string} /> : null}
      {formatSpan(r.mttr_minutes) ? <DetailRow label={t("assets.history.mttr")} value={formatSpan(r.mttr_minutes) as string} /> : null}
      {r.repeat_failure_count ? <DetailRow label={t("assets.history.repeatFailures")} value={String(r.repeat_failure_count)} /> : null}
    </View>
  );
}

function Documents({ res, language, timezone }: { res: Props["documents"]; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  if (res.data == null) return res.failed ? <Retry onPress={res.reload} /> : <Text style={{ color: theme.textMuted }}>{t("common.loading")}</Text>;
  if (res.data.length === 0) return <Text style={[styles.hint, { color: theme.textMuted }]} testID="asset-no-documents">{t("assets.history.noDocuments")}</Text>;

  const open = async (doc: AssetDocument) => {
    if (opening) return;
    setOpening(doc.id);
    try {
      // A short-lived signed link, fetched at the moment of opening and never stored or shown.
      const url = await getAssetDocumentUrl(doc.id);
      if (!url) throw new Error("no url");
      await Linking.openURL(url);
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      toast.error(status === 404 ? t("assets.history.documentMissing") : t("assets.history.documentFailed"));
    } finally {
      setOpening(null);
    }
  };

  return (
    <View testID="asset-documents">
      {res.data.map((doc) => (
        <Pressable
          key={doc.id}
          onPress={() => void open(doc)}
          accessibilityRole="button"
          accessibilityLabel={t("assets.history.openDocument", { name: doc.label })}
          style={[styles.period, styles.doc, { borderTopColor: theme.borderSubtle }]}
          testID={`asset-doc-${doc.id}`}
        >
          <Ionicons name="document-text-outline" size={20} color={theme.textMuted} />
          <View style={styles.eventText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventLabel, { color: theme.textPrimary }]}>
              {doc.label}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventDate, { color: theme.textMuted }]}>
              {[t(`assets.history.docType.${doc.evidence_type}`, { defaultValue: doc.evidence_type }), formatDayYear(doc.collected_at ?? doc.created_at, timezone, language)].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Text style={{ color: theme.primary, fontSize: 13, fontWeight: "700" }}>{opening === doc.id ? t("common.loading") : t("assets.history.view")}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** What has happened to this equipment: a timeline from the records already held, confirmed downtime, reliability figures and linked documents. */
export function AssetHistorySection({ events, downtime, reliability, documents, language, timezone }: Props) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<AssetHistoryGroup>("all");
  const counts = historyGroupCounts(events);
  // A group that has emptied (the events were reloaded) can no longer be selected: fall back to everything.
  const active = counts[group] > 0 ? group : "all";
  const groups = ASSET_HISTORY_GROUPS.filter((key) => key === "all" || counts[key] > 0);
  return (
    <View style={styles.stack} testID="asset-history">
      <Panel>
        <PanelTitle>{t("assets.history.timeline")}</PanelTitle>
        {groups.length > 2 ? (
          <View style={styles.chips} accessibilityRole="tablist" accessibilityLabel={t("assets.history.filterLabel")} testID="asset-history-filter">
            {groups.map((key) => (
              <Pill
                key={key}
                label={t(`assets.history.filter.${key}`)}
                count={counts[key]}
                selected={active === key}
                onPress={() => setGroup(key)}
                testID={`asset-history-filter-${key}`}
              />
            ))}
          </View>
        ) : null}
        <Timeline events={filterAssetEvents(events, active)} language={language} timezone={timezone} />
      </Panel>
      <Panel>
        <PanelTitle>{t("assets.history.downtimeTitle")}</PanelTitle>
        <Downtime res={downtime} language={language} timezone={timezone} />
      </Panel>
      <Panel>
        <PanelTitle>{t("assets.history.reliabilityTitle")}</PanelTitle>
        <Reliability res={reliability} language={language} timezone={timezone} />
      </Panel>
      <Panel>
        <PanelTitle>{t("assets.history.documentsTitle")}</PanelTitle>
        <Documents res={documents} language={language} timezone={timezone} />
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  hint: { fontSize: 13.5, lineHeight: 19 },
  event: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingVertical: 6 },
  eventText: { flex: 1, gap: 2 },
  eventLabel: { fontSize: 14, fontWeight: "600" },
  eventDate: { fontSize: 12.5 },
  period: { gap: 6, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1 },
  doc: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 6 },
});
