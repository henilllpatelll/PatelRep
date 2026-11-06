import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Notice } from "@/components/management/HomeParts";
import { IconButton } from "@/components/ui/IconButton";
import { ScreenHeader } from "@/components/shared/HeadersV2";
import { radiusV2, spaceV2, touchV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { GUEST_REQUEST_PAGE_SIZE, formatCount, summarizeGuestRequests, type GuestRequestView } from "@/lib/frontDesk/guestRequests";
import { useGuestRequestsLive } from "@/lib/frontDesk/useGuestRequestsLive";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/* ─── Guest Requests (Design System V2) ───────────────────────────────────────
   Each card answers: what does the guest need, where, how urgent, what is its status, what can I do next (open it).
   The list is the newest 100 requests the API returns (it has no total), so every count says so when the page is
   full. The API has no assignee and no priority above "urgent"; neither is shown. Read-only: changes happen in the
   detail screen through the server's own status transitions. */

type Segment = "active" | "resolved" | "all";

const STATUS_BADGE: Record<string, StatusKey> = {
  open: "pickup",
  reopened: "pickup",
  acknowledged: "inProgress",
  dispatched: "inProgress",
  arrived: "inProgress",
  guest_contacted: "inProgress",
  resolved: "completed",
  verified: "completed",
};

export function ageText(createdAt: string | null, now: number, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const ms = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(ms)) return null;
  const mins = Math.max(0, Math.floor((now - ms) / 60000));
  if (mins < 1) return t("guestRequestsV2.age.now");
  if (mins < 60) return t("guestRequestsV2.age.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("guestRequestsV2.age.hours", { count: hours });
  return t("guestRequestsV2.age.days", { count: Math.floor(hours / 24) });
}

export function GuestRequestsV2() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const { rows, status, stale, isOnline, refresh } = useGuestRequestsLive();
  const [segment, setSegment] = useState<Segment>("active");
  const [query, setQuery] = useState("");
  const [pulling, setPulling] = useState(false);
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";
  const now = Date.now();

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const summary = useMemo(() => (rows ? summarizeGuestRequests(rows, { timeZone: hotelTimezone }) : null), [rows, hotelTimezone]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => r.stage !== "cancelled")
      .filter((r) => (segment === "all" ? true : segment === "active" ? r.stage === "open" || r.stage === "inProgress" : r.stage === "resolved"))
      .filter((r) => !q || [r.roomNumber, r.guestName, r.title, r.description].some((f) => (f ?? "").toLowerCase().includes(q)))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0) || 0);
  }, [rows, segment, query]);

  const segmentOptions = [
    { key: "active" as const, label: t("guestRequestsV2.segments.active") },
    { key: "resolved" as const, label: t("guestRequestsV2.segments.resolved") },
    { key: "all" as const, label: t("guestRequestsV2.segments.all") },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="guest-requests-v2">
      <ScreenHeader
        title={t("tabs.guestRequests")}
        trailing={<IconButton icon="add" onPress={() => router.push("/(app)/copilot" as never)} accessibilityLabel={`${t("guestRequestsV2.new")}. ${t("guestRequestsV2.newHint")}`} testID="requests-new" />}
        subtitle={summary ? t(summary.partial ? "guestRequestsV2.summary.partial" : "guestRequestsV2.summary.loaded", { count: summary.partial ? GUEST_REQUEST_PAGE_SIZE : summary.loaded }) : undefined} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}>
        {!isOnline ? <Notice testID="requests-offline" text={t("managementHome.notice.offline")} /> : stale ? <Notice testID="requests-stale" text={t("managementHome.notice.stale")} /> : null}

        {summary ? (
          <View style={styles.metrics} testID="requests-summary">
            <MetricCard label={t("guestRequestsV2.summary.open")} value={formatCount(summary.open, summary.partial)} tone={summary.open > 0 ? "pickup" : "neutral"} style={styles.metric} testID="requests-metric-open" />
            <MetricCard label={t("guestRequestsV2.summary.inProgress")} value={formatCount(summary.inProgress, summary.partial)} tone={summary.inProgress > 0 ? "inProgress" : "neutral"} style={styles.metric} testID="requests-metric-progress" />
            <MetricCard label={t("guestRequestsV2.summary.urgent")} value={formatCount(summary.urgentActive, summary.partial)} tone={summary.urgentActive > 0 ? "dirty" : "neutral"} style={styles.metric} testID="requests-metric-urgent" />
          </View>
        ) : null}

        <SegmentedControl options={segmentOptions} value={segment} onChange={setSegment} accessibilityLabel={t("guestRequestsV2.segments.a11y")} testID="requests-segments" />

        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: radiusV2.input }]}>
          <Ionicons name="search-outline" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("guestRequestsV2.search")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("guestRequestsV2.search")}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: theme.textPrimary }]}
            testID="requests-search"
          />
        </View>

        {status === "loading" ? (
          <StateBlock status="loading" />
        ) : !rows && !isOnline ? (
          <StateBlock status="offline" offlineTitle={t("guestRequestsV2.offline.title")} offlineBody={t("guestRequestsV2.offline.body")} />
        ) : !rows ? (
          <StateBlock status="error" errorMessage={`${t("guestRequestsV2.error.title")}. ${t("guestRequestsV2.error.body")}`} onRetry={() => void onRefresh()} retryLabel={t("common.retry")} />
        ) : visible.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="chatbubble-ellipses-outline"
            emptyTitle={query.trim() ? t("guestRequestsV2.empty.noMatchTitle") : t(`guestRequestsV2.empty.${segment}Title`)}
            emptyBody={query.trim() ? t("guestRequestsV2.empty.noMatchBody") : t(`guestRequestsV2.empty.${segment}Body`)}
          />
        ) : (
          <View style={styles.list}>
            {visible.map((r) => (
              <RequestCard key={r.id} r={r} now={now} language={language} zone={hotelTimezone} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function RequestCard({ r, now, language, zone }: { r: GuestRequestView; now: number; language: "en" | "es"; zone: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const age = ageText(r.createdAt, now, t);
  const badge = STATUS_BADGE[r.status];
  const statusLabel = t(`guestRequestsV2.status.${r.status in STATUS_BADGE || r.status === "cancelled" ? r.status : "unknown"}`);
  const due = r.dueAt && r.stage !== "resolved" ? formatHotelTime(new Date(r.dueAt), zone, language) : null;
  const title = r.title || t("guestRequestsV2.untitled");
  const label = [r.roomNumber ? t("guestRequests.roomLabel", { room: r.roomNumber }) : null, title, statusLabel, r.urgent ? t("guestRequestsV2.urgent") : null, age].filter(Boolean).join(". ");
  return (
    <Pressable onPress={() => router.push(`/(app)/guest-requests/${r.id}` as never)} accessibilityRole="button" accessibilityLabel={label} testID={`request-${r.id}`} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      <Card style={[styles.card, r.urgent && r.stage !== "resolved" ? { borderColor: theme.status.dirtyLine } : null]}>
        <View style={styles.top}>
          <View style={styles.grow}>
            {r.roomNumber ? (
              <AppText variant="headline" numeric>
                {t("guestRequests.roomLabel", { room: r.roomNumber })}
              </AppText>
            ) : null}
            {r.guestName ? (
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {r.guestName}
              </AppText>
            ) : null}
          </View>
          <View style={styles.badges}>
            {r.urgent && r.stage !== "resolved" ? <StatusBadge statusKey="urgent" label={t("guestRequestsV2.urgent")} /> : null}
            {badge ? <StatusBadge statusKey={badge} label={statusLabel} /> : null}
          </View>
        </View>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {r.description && r.description !== title ? (
          <AppText variant="caption" tone="secondary" numberOfLines={2}>
            {r.description}
          </AppText>
        ) : null}
        <View style={styles.foot}>
          {age ? (
            <AppText variant="micro" tone="muted" numeric>
              {age}
            </AppText>
          ) : null}
          {due ? (
            <AppText variant="micro" tone="muted" numeric>
              {t("guestRequestsV2.due", { time: due })}
            </AppText>
          ) : null}
          {r.linkedWorkOrder ? (
            <AppText variant="micro" tone="muted">
              {t("guestRequestsV2.linkedWo")}
            </AppText>
          ) : null}
          <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} style={styles.chev} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spaceV2.page, gap: spaceV2.md, paddingBottom: 40 },
  metrics: { flexDirection: "row", gap: spaceV2.sm },
  metric: { flex: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm, borderWidth: 1, paddingHorizontal: spaceV2.md, minHeight: touchV2.comfortable },
  searchInput: { flex: 1, fontSize: 16, minHeight: touchV2.comfortable },
  list: { gap: spaceV2.sm },
  card: { padding: spaceV2.lg, gap: spaceV2.sm },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spaceV2.sm },
  grow: { flex: 1, minWidth: 0 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: "55%" },
  foot: { flexDirection: "row", alignItems: "center", gap: spaceV2.md, flexWrap: "wrap" },
  chev: { marginLeft: "auto" },
});
