import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Notice, SectionHead, useToneColors, type PartTone } from "@/components/management/HomeParts";
import { ScreenHeader } from "@/components/shared/HeadersV2";
import { spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StateBlock } from "@/components/ui/StateBlock";
import { describeAlert } from "@/lib/gm/alertText";
import { countByTier, type AlertItem, type AlertKind } from "@/lib/gm/riskAlerts";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useRiskAlertsSource } from "@/lib/management/homeData";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/* ─── GM Alerts (Design System V2) ────────────────────────────────────────────
   The deterministic exception feed (`GET /ai/risk-alerts`, no AI credit). The API has no severity, so nothing is
   scored: items are grouped by the server's own selection rule ("needs attention" = work orders already overdue and
   rooms the readiness prediction marks HIGH; "keep an eye on" = the rest) and each is labelled with its source. Older
   payloads that do carry a severity keep it (critical = red, high = amber, otherwise neutral). There is no dismiss or
   resolve here because the API has none. A failed read is shown as a failure, never as "all clear". */

const KIND_ICON: Record<AlertKind, React.ComponentProps<typeof Ionicons>["name"]> = {
  sla_breach: "time-outline",
  room_risk: "bed-outline",
  asset_risk: "flash-outline",
  low_stock: "cube-outline",
  guest_issue: "chatbubble-ellipses-outline",
  recurring: "repeat-outline",
  legacy: "warning-outline",
};

/** Lazy so importing this screen never loads the router (the legacy Alerts tests render without it). */
function openHref(href: string) {
  void import("expo-router").then(({ router }) => router.push(href as never));
}

function toneOf(item: AlertItem): PartTone {
  if (item.severity === "critical") return "alert";
  if (item.severity === "high") return "attention";
  if (item.severity) return "neutral";
  return item.tier === "attention" ? "attention" : "neutral";
}

export function AlertsV2() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isOnline = useAppStore((s) => s.isOnline);
  const zone = useAppStore((s) => s.hotelTimezone);
  const source = useRiskAlertsSource();
  const [pulling, setPulling] = useState(false);
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await source.refresh();
    } finally {
      setPulling(false);
    }
  }, [source]);

  const stamp = useCallback((iso: string | null) => (iso ? formatHotelTime(new Date(iso), zone, language) : null), [zone, language]);
  const items = source.data?.items ?? null;
  const tiers = useMemo(() => (items ? countByTier(items) : null), [items]);
  const attention = items?.filter((i) => i.tier === "attention") ?? [];
  const watch = items?.filter((i) => i.tier === "watch") ?? [];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="alerts-v2">
      <ScreenHeader title={t("tabs.alerts")} subtitle={t("alertsV2.subtitle")} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}>
        {!isOnline ? <Notice testID="alerts-offline" text={t("managementHome.notice.offline")} /> : source.stale ? <Notice testID="alerts-stale" text={t("managementHome.notice.stale")} /> : null}

        {tiers ? (
          <View style={styles.metrics} testID="alerts-summary">
            <MetricCard label={t("alertsV2.summary.attention")} value={String(tiers.attention)} icon="warning-outline" tone={tiers.attention > 0 ? "pickup" : "neutral"} style={styles.metric} testID="alerts-metric-attention" />
            <MetricCard label={t("alertsV2.summary.watch")} value={String(tiers.watch)} icon="eye-outline" tone="neutral" style={styles.metric} testID="alerts-metric-watch" />
          </View>
        ) : null}

        {source.status === "loading" || (source.status === "idle" && isOnline) ? (
          <StateBlock status="loading" />
        ) : !items && !isOnline ? (
          <StateBlock status="offline" offlineTitle={t("alertsV2.offline.title")} offlineBody={t("alertsV2.offline.body")} />
        ) : !items ? (
          <StateBlock status="error" errorMessage={`${t("alertsV2.error.title")}. ${t("alertsV2.error.body")}`} onRetry={() => void onRefresh()} retryLabel={t("common.retry")} />
        ) : items.length === 0 ? (
          <StateBlock status="empty" emptyIcon="shield-checkmark-outline" emptyTitle={t("alertsV2.empty.title")} emptyBody={t("alertsV2.empty.body")} />
        ) : (
          <>
            {attention.length > 0 ? (
              <View style={styles.group} testID="alerts-attention">
                <SectionHead title={t("alertsV2.groups.attention")} />
                {attention.map((item) => (
                  <AlertCard key={item.id} item={item} stamp={stamp} />
                ))}
              </View>
            ) : null}
            {watch.length > 0 ? (
              <View style={styles.group} testID="alerts-watch">
                <SectionHead title={t("alertsV2.groups.watch")} />
                {watch.map((item) => (
                  <AlertCard key={item.id} item={item} stamp={stamp} />
                ))}
              </View>
            ) : null}
            {source.data && source.data.cappedKinds.length > 0 ? (
              <AppText variant="micro" tone="muted" testID="alerts-capped">
                {t("alertsV2.capped")}
              </AppText>
            ) : null}
            <AppText variant="micro" tone="muted" testID="alerts-source">
              {t("alertsV2.source")}
            </AppText>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AlertCard({ item, stamp }: { item: AlertItem; stamp: (iso: string | null) => string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = useToneColors()[toneOf(item)];
  const words = describeAlert(item, t, stamp);
  const kindLabel = t(`alertsV2.kinds.${item.kind}`);
  const label = [kindLabel, words.title, words.detail].filter(Boolean).join(". ");
  const body = (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.line }]}>
          <Ionicons name={KIND_ICON[item.kind]} size={14} color={tone.fg} />
          <AppText variant="micro" style={{ color: tone.fg }} numberOfLines={1}>
            {kindLabel}
          </AppText>
        </View>
        {item.href ? <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} /> : null}
      </View>
      {words.title ? (
        <AppText variant="bodyStrong" numberOfLines={3}>
          {words.title}
        </AppText>
      ) : null}
      {words.detail ? (
        <AppText variant="caption" tone="secondary" numberOfLines={4}>
          {words.detail}
        </AppText>
      ) : null}
    </Card>
  );
  if (!item.href) {
    return (
      <View accessible accessibilityLabel={label} testID={`alert-${item.id}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable onPress={() => openHref(item.href as string)} accessibilityRole="button" accessibilityLabel={`${label}. ${t("alertsV2.view")}`} testID={`alert-${item.id}`} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spaceV2.page, gap: spaceV2.lg, paddingBottom: 40 },
  metrics: { flexDirection: "row", gap: spaceV2.sm },
  metric: { flex: 1 },
  group: { gap: spaceV2.sm },
  card: { padding: spaceV2.lg, gap: spaceV2.xs },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 26, alignSelf: "flex-start", maxWidth: "85%" },
});
