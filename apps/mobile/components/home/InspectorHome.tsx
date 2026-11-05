import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Kicker, LinkButton, MAX_FONT_SCALE } from "@/components/home/homeUi";
import { RoleHomeHeader, type HeaderStatus } from "@/components/home/RoleHomeHeader";
import { ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MetricCard, type MetricTone } from "@/components/ui/MetricCard";
import { StateBlock } from "@/components/ui/StateBlock";
import { resolveTimeZone, formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { firstNameOf } from "@/lib/housekeeping/homeText";
import { greetingPart } from "@/lib/housekeeping/supervisorTodayView";
import { useHotelName } from "@/lib/housekeeping/useHotelName";
import { buildInspectorHome, queueAccess } from "@/lib/inspections/inspectorHome";
import { inspectionHref, recordHref } from "@/lib/inspections/route";
import type { QueueItem } from "@/lib/inspections/queue";
import { useInspectionQueue } from "@/lib/inspections/useInspectionQueue";
import { cardText, metricText, staleBanner, statusLine, type BadgeKey } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";

/* ─── Inspector Home ────────────────────────────────────────────────────────
   An inspector's day in one screen: which room to inspect next, how the day is going, what should go first, and
   what was just decided. Read-only over the data the Inspections tab already loads (`useInspectionQueue`); starting
   an inspection goes through the same canonical route and the same guards (verified queue, usable checklist) as the
   queue, and nothing here changes how a room qualifies for inspection. */

const MINUTE = 60_000;

function openInspections(tab?: "corrections" | "done") {
  router.push((tab ? { pathname: "/(app)/inspect", params: { tab } } : "/(app)/inspect") as never);
}

export function InspectorHome({ name }: { name: string }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const unreadCount = useAppStore((state) => state.unreadCount);
  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";
  const hotelName = useHotelName(true);

  const data = useInspectionQueue();
  const { queue, items, correctionList, doneList, now, refreshing, refresh, selectionFor } = data;
  const [pulling, setPulling] = useState(false);

  const minute = Math.floor(now / MINUTE) * MINUTE;
  const ctx = useMemo(() => ({ now: minute, timeZone: hotelTimezone }), [minute, hotelTimezone]);
  const model = useMemo(() => buildInspectorHome({ items, corrections: correctionList, done: doneList, ctx }), [items, correctionList, doneList, ctx]);
  const access = queueAccess(queue);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  /** The same guards as the queue: a checklist that cannot be used, or a queue that is no longer verified, blocks the start. */
  const start = useCallback(
    (item: QueueItem) => {
      const selected = selectionFor(item.roomTypeId);
      if (selected && !selected.ok) {
        toast.error(t(`inspect.template.${selected.reason}`));
        return;
      }
      if (queue.status === "stale") {
        toast.error(t("inspect.start.needsConnection"));
        void refresh();
        return;
      }
      router.push(inspectionHref(item.roomId, item.roomNumber, "queue") as never);
    },
    [queue.status, refresh, selectionFor, t, toast],
  );

  const part = greetingPart(hotelTimezone, new Date(now));
  const first = firstNameOf(name);
  const greeting = first ? t(`supervisorToday.greeting.${part}Name`, { name: first }) : t(`supervisorToday.greeting.${part}`);
  const dateLine = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: resolveTimeZone(hotelTimezone),
      }).format(new Date(now)),
    [now, language, hotelTimezone],
  );

  const line = statusLine(queue, now, hotelTimezone, language, t);
  const status: HeaderStatus = !isOnline
    ? { text: line.text, tone: "warn", icon: "cloud-offline-outline" }
    : line.tone === "live"
      ? { text: line.text, tone: "ok", icon: "checkmark-circle-outline" }
      : line.tone === "busy"
        ? { text: line.text, tone: "muted", icon: "time-outline" }
        : { text: line.text, tone: "warn", icon: "alert-circle-outline" };
  const banner = staleBanner(queue, hotelTimezone, language, t);

  const metricRows: Array<{ key: "awaiting" | "completed" | "failed" | "reinspection"; icon: React.ComponentProps<typeof Ionicons>["name"]; tone: MetricTone; tab?: "corrections" | "done" }> = [
    { key: "awaiting", icon: "hourglass-outline", tone: "neutral" },
    { key: "completed", icon: "checkmark-done-outline", tone: "ready", tab: "done" },
    { key: "failed", icon: "close-circle-outline", tone: (model.metrics.failed.value ?? 0) > 0 ? "dirty" : "neutral", tab: "done" },
    { key: "reinspection", icon: "refresh-outline", tone: (model.metrics.reinspection.value ?? 0) > 0 ? "pickup" : "neutral", tab: "corrections" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="inspector-home">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling || refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <RoleHomeHeader
          prefix="inspector"
          hotelName={hotelName}
          greeting={greeting}
          dateLine={dateLine}
          unreadCount={unreadCount}
          topInset={insets.top}
          t={t}
          status={status}
          onPressStatus={() => void onRefresh()}
          statusActionLabel={t("inspectorHome.status.refresh")}
          onOpenNotifications={() => router.push("/(app)/notifications" as never)}
        />

        {!isOnline ? (
          <Notice tone="warn" testID="inspector-offline" text={t("inspectorHome.state.offlineNote")} />
        ) : banner ? (
          <Notice tone="warn" testID="inspector-stale" text={banner} />
        ) : null}

        <View style={styles.body}>
          {access === "loading" ? (
            <View style={styles.loading} testID="inspector-loading" accessibilityLabel={t("inspectorHome.state.loading")} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.primaryAction} />
              <AppText variant="caption" tone="muted">
                {t("inspectorHome.state.loading")}
              </AppText>
            </View>
          ) : access === "restricted" ? (
            <View testID="inspector-restricted">
              <StateBlock
                status="empty"
                emptyIcon="lock-closed-outline"
                emptyTitle={t("inspectorHome.state.restrictedTitle")}
                emptyBody={t("inspectorHome.state.restrictedBody")}
              />
            </View>
          ) : access === "unavailable" ? (
            <View testID="inspector-unavailable">
              <StateBlock
                status="error"
                errorMessage={`${t("inspectorHome.state.unavailableTitle")}. ${t("inspectorHome.state.unavailableBody")}`}
                onRetry={() => void onRefresh()}
                retryLabel={t("common.retry")}
              />
            </View>
          ) : (
            <>
              {model.focus ? (
                <FocusCard
                  item={model.focus}
                  ctx={ctx}
                  language={language}
                  blockedReason={blockedReason(model.focus, selectionFor, t)}
                  onStart={start}
                  t={t}
                />
              ) : model.allComplete ? (
                <Card testID="inspector-all-complete">
                  <StateBlock
                    status="empty"
                    emptyIcon="checkmark-done-circle-outline"
                    emptyTitle={t("inspectorHome.state.allDoneTitle")}
                    emptyBody={t("inspectorHome.state.allDoneBody")}
                  />
                </Card>
              ) : (
                <Card testID="inspector-empty">
                  <StateBlock
                    status="empty"
                    emptyIcon="shield-checkmark-outline"
                    emptyTitle={t("inspectorHome.state.emptyTitle")}
                    emptyBody={t("inspectorHome.state.emptyBody")}
                  />
                </Card>
              )}

              <View style={styles.section}>
                <Kicker>{t("inspectorHome.overview.title")}</Kicker>
                <View style={styles.grid} testID="inspector-overview">
                  {metricRows.map((row) => {
                    const metric = model.metrics[row.key];
                    const text = metricText(metric, t);
                    const label = t(`inspectorHome.overview.${row.key}`);
                    return (
                      <MetricCard
                        key={row.key}
                        testID={`inspector-metric-${row.key}`}
                        label={label}
                        value={text.text}
                        icon={row.icon}
                        tone={row.tone}
                        onPress={() => openInspections(row.tab)}
                        style={styles.metric}
                      />
                    );
                  })}
                </View>
              </View>

              {model.priority.length > 0 ? (
                <View style={styles.section} testID="inspector-priority">
                  <Kicker>{t("inspectorHome.priority.title")}</Kicker>
                  <Card style={styles.list}>
                    {model.priority.map(({ item, badge }, index) => (
                      <PriorityRow key={item.roomId} item={item} badge={badge} first={index === 0} onStart={start} t={t} />
                    ))}
                  </Card>
                </View>
              ) : null}

              <View style={styles.section} testID="inspector-recent">
                <View style={styles.sectionHead}>
                  <Kicker>{t("inspectorHome.recent.title")}</Kicker>
                  {model.recent.length > 0 ? <LinkButton label={t("inspectorHome.recent.viewAll")} onPress={() => openInspections("done")} testID="inspector-recent-all" /> : null}
                </View>
                {model.recent.length === 0 ? (
                  <AppText variant="caption" tone="muted" testID="inspector-recent-empty">
                    {doneList ? t("inspectorHome.recent.empty") : t("inspect.metric.unavailableA11y")}
                  </AppText>
                ) : (
                  <Card style={styles.list}>
                    {model.recent.map((entry, index) => {
                      const clock = formatHotelTime(entry.completedAtMs === null ? null : new Date(entry.completedAtMs), hotelTimezone, language) ?? "—";
                      return (
                        <Pressable
                          key={entry.id}
                          testID={`inspector-recent-${entry.id}`}
                          onPress={() => router.push(recordHref(entry.id, "done", entry.roomId, entry.roomNumber) as never)}
                          accessibilityRole="button"
                          accessibilityLabel={`${t("inspect.card.room", { room: entry.roomNumber })}. ${t(`inspect.history.result.${entry.result}`)}. ${clock}`}
                          style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
                        >
                          <AppText variant="headline" numeric style={styles.roomNo} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                            {entry.roomNumber}
                          </AppText>
                          <AppText variant="caption" tone="muted" style={styles.grow} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                            {clock}
                          </AppText>
                          <ResultBadge result={entry.result} t={t} />
                          <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
                        </Pressable>
                      );
                    })}
                  </Card>
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────────── */

function blockedReason(
  item: QueueItem,
  selectionFor: (roomTypeId: string | null | undefined) => { ok: boolean; reason?: string } | null,
  t: (key: string) => string,
): string | null {
  const selected = selectionFor(item.roomTypeId);
  return selected && !selected.ok && selected.reason ? t(`inspect.template.${selected.reason}`) : null;
}

function Notice({ text, tone, testID }: { text: string; tone: "warn"; testID: string }) {
  const theme = useTheme();
  const s = theme.status;
  return (
    <View
      style={[styles.notice, { backgroundColor: tone === "warn" ? s.pickupSoft : s.cleanSoft, borderColor: s.pickupLine }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Ionicons name="information-circle-outline" size={18} color={s.pickup} />
      <AppText variant="caption" style={styles.grow} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </AppText>
    </View>
  );
}

const BADGE_ICON: Record<BadgeKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  overdue: "time-outline",
  reinspection: "refresh-outline",
  arrival: "log-in-outline",
  vip: "star-outline",
  priority: "flag-outline",
};

function BadgePill({ badge, t }: { badge: BadgeKey; t: (key: string) => string }) {
  const theme = useTheme();
  const s = theme.status;
  const tone =
    badge === "overdue"
      ? { fg: s.dirty, bg: s.dirtySoft, line: s.dirtyLine }
      : badge === "arrival" || badge === "vip"
        ? { fg: s.clean, bg: s.cleanSoft, line: s.cleanLine }
        : { fg: s.pickup, bg: s.pickupSoft, line: s.pickupLine };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.line }]}>
      <Ionicons name={BADGE_ICON[badge]} size={13} color={tone.fg} />
      <AppText variant="micro" style={{ color: tone.fg, fontWeight: "600" }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {t(`inspect.card.badge.${badge}`)}
      </AppText>
    </View>
  );
}

function FocusCard({
  item,
  ctx,
  language,
  blockedReason: blocked,
  onStart,
  t,
}: {
  item: QueueItem;
  ctx: { now: number; timeZone: string | null };
  language: string;
  blockedReason: string | null;
  onStart: (item: QueueItem) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  const text = cardText(item, ctx, language, false, t);
  const action = t(text.reinspection ? "inspect.card.reinspect" : "inspect.card.start");
  const sub = [item.roomTypeName, text.where].filter(Boolean).join(" · ");
  return (
    <Card style={styles.focus} testID="inspector-focus">
      <View style={styles.sectionHead}>
        <Kicker>{t("inspectorHome.next.kicker")}</Kicker>
        {text.badge ? <BadgePill badge={text.badge} t={t} /> : null}
      </View>
      <AppText variant="display" numeric maxFontSizeMultiplier={1.3} testID="inspector-focus-room" accessibilityLabel={t("inspect.card.room", { room: item.roomNumber })}>
        {item.roomNumber}
      </AppText>
      {sub ? (
        <AppText variant="bodyStrong" tone="secondary" numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {sub}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text.who}
      </AppText>
      {text.note ? (
        <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text.note}
        </AppText>
      ) : null}
      {text.failedItems ? (
        <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text.failedItems}
        </AppText>
      ) : null}
      {blocked ? (
        <AppText variant="caption" style={{ color: theme.status.pickup }} testID="inspector-focus-blocked" accessibilityRole="alert">
          {blocked}
        </AppText>
      ) : null}
      <Button
        label={action}
        size="lg"
        icon={text.reinspection ? "refresh-outline" : "shield-checkmark-outline"}
        disabled={blocked !== null}
        onPress={() => onStart(item)}
        testID="inspector-start"
        accessibilityLabel={`${action}. ${text.summary}`}
      />
    </Card>
  );
}

function PriorityRow({
  item,
  badge,
  first,
  onStart,
  t,
}: {
  item: QueueItem;
  badge: BadgeKey;
  first: boolean;
  onStart: (item: QueueItem) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  const where = [item.roomTypeName, item.floor !== null ? t("inspect.card.floor", { floor: item.floor }) : null].filter(Boolean).join(" · ");
  return (
    <Pressable
      testID={`inspector-priority-${item.roomId}`}
      onPress={() => onStart(item)}
      accessibilityRole="button"
      accessibilityLabel={t("inspectorHome.priority.a11y", { room: t("inspect.card.room", { room: item.roomNumber }), reason: t(`inspect.card.badge.${badge}`) })}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
    >
      <AppText variant="headline" numeric style={styles.roomNo} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {item.roomNumber}
      </AppText>
      <View style={styles.grow}>
        <BadgePill badge={badge} t={t} />
        {where ? (
          <AppText variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {where}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  // Bottom padding clears the floating assistant button the layout draws over every screen.
  content: { flexGrow: 1, paddingBottom: 110 },
  body: { paddingHorizontal: spaceV2.page, paddingTop: spaceV2.md, gap: spaceV2.xl },
  loading: { alignItems: "center", gap: spaceV2.sm, paddingVertical: spaceV2.xxl },
  notice: {
    marginHorizontal: spaceV2.page,
    marginTop: spaceV2.xs,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spaceV2.sm,
    borderWidth: 1,
    borderRadius: radiusV2.control,
    padding: spaceV2.md,
  },
  focus: { gap: spaceV2.sm },
  section: { gap: spaceV2.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spaceV2.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
  metric: { flexGrow: 1, flexBasis: "47%" },
  list: { padding: 0, overflow: "hidden" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spaceV2.md, paddingHorizontal: spaceV2.lg, paddingVertical: spaceV2.sm },
  roomNo: { minWidth: 52 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderRadius: radiusV2.pill, paddingHorizontal: 9, paddingVertical: 3 },
});
