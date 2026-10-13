import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AddTaskSheet } from "@/components/tasks/AddTaskSheet";
import { TaskCard, type TaskCardVariant } from "@/components/tasks/TaskCard";
import { TasksHeader, type Segment, type SummaryValue, type SyncKey } from "@/components/tasks/TasksHeader";
import { resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import type { Task } from "@/lib/api/tasks";
import { buildWorkBuckets } from "@/lib/tasks/workQueue";
import { useWorkQueue, type ListState, type MutationResult } from "@/lib/tasks/useWorkQueue";

const MAX_FONT_SCALE = 1.5;
const CLOCK_TICK_MS = 60_000;

type Row =
  | { key: string; kind: "intro" }
  | { key: string; kind: "header"; section: "nextUp" | "inProgress" | "upNext" | "later" | "available"; count?: number; toggle?: boolean; open?: boolean }
  | { key: string; kind: "card"; task: Task; variant: TaskCardVariant };

function dateLabel(now: Date, zone: string | null, language: string): string {
  return now.toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: resolveTimeZone(zone),
  });
}

function messageKey(action: "start" | "claim" | "complete", result: Extract<MutationResult, { ok: false }>): string | null {
  if (result.code === "busy") return null;
  if (result.code === "offline") return "tasks.hk.msg.offline";
  if (action === "claim") return result.code === "conflict" ? "tasks.hk.msg.claimConflict" : "tasks.hk.msg.claimFailed";
  if (action === "start") return result.code === "conflict" ? "tasks.hk.msg.startConflict" : "tasks.hk.msg.startFailed";
  return result.code === "conflict" ? "tasks.hk.msg.completeConflict" : "tasks.hk.msg.completeFailed";
}

function Skeleton() {
  const theme = useTheme();
  return (
    <View style={styles.skeletonStack} testID="tasks-skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]} />
      ))}
    </View>
  );
}

export function HousekeeperTasksScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const { isOnline, hotelTimezone, pendingActions } = useAppStore();
  const zone = hotelTimezone ?? null;

  const queue = useWorkQueue({ isOnline, timeZone: zone });
  const { mine, available, done } = queue;

  const [segment, setSegment] = useState<Segment>("mine");
  const [laterOpen, setLaterOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Relative labels ("12m overdue") re-evaluate on data changes and once a minute.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(), [mine.tasks, available.tasks, tick]);

  const buckets = useMemo(() => buildWorkBuckets(mine.tasks, now), [mine.tasks, now]);
  const mineKnown = mine.status === "ready";
  const availableKnown = available.status === "ready";

  const summary = {
    remaining: { value: mineKnown ? buckets.remaining : null, atLeast: mine.truncated } as SummaryValue,
    inProgress: { value: mineKnown ? buckets.inProgress.length : null } as SummaryValue,
    doneToday: { value: done.value ? done.value.count : null, atLeast: done.value?.atLeast } as SummaryValue,
  };
  const counts = {
    mine: mineKnown ? buckets.remaining + buckets.inProgress.length : null,
    available: availableKnown ? available.tasks.length : null,
  };

  const hasPendingTaskChanges = pendingActions.some((action) => action.type === "task_complete");
  const sync: SyncKey = hasPendingTaskChanges
    ? "pending"
    : !isOnline
      ? "offline"
      : queue.refreshing || queue.busyIds.size > 0
        ? "syncing"
        : mine.stale || available.stale
          ? "stale"
          : "synced";

  const run = useCallback(
    async (action: "start" | "claim" | "complete", task: Task) => {
      setMessage(null);
      const result = await queue[action](task.id);
      if (result.ok) {
        if (action === "complete") setConfirmingId(null);
        return;
      }
      const key = messageKey(action, result);
      if (key) setMessage(t(key));
      if (action === "complete") setConfirmingId(null);
    },
    [queue, t],
  );

  const onPrimary = useCallback(
    (task: Task, variant: TaskCardVariant) => {
      if (variant === "inProgress") {
        setConfirmingId(task.id); // completion is never one accidental tap
      } else if (variant === "available") {
        void run("claim", task);
      } else {
        void run("start", task);
      }
    },
    [run],
  );

  const list: ListState = segment === "mine" ? mine : available;
  const nothingElse = !buckets.nextUp && buckets.inProgress.length === 0 && buckets.upNext.length === 0;
  const laterVisible = laterOpen || nothingElse;

  const rows = useMemo<Row[]>(() => {
    if (segment === "available") {
      const out: Row[] = [{ key: "intro", kind: "intro" }];
      if (available.tasks.length > 0) {
        out.push({ key: "h-available", kind: "header", section: "available", count: available.tasks.length });
        for (const task of available.tasks) out.push({ key: `a-${task.id}`, kind: "card", task, variant: "available" });
      }
      return out;
    }
    const out: Row[] = [];
    if (buckets.nextUp) {
      out.push({ key: "h-next", kind: "header", section: "nextUp" });
      out.push({ key: `n-${buckets.nextUp.id}`, kind: "card", task: buckets.nextUp, variant: "hero" });
    }
    if (buckets.inProgress.length > 0) {
      out.push({ key: "h-prog", kind: "header", section: "inProgress", count: buckets.inProgress.length });
      for (const task of buckets.inProgress) out.push({ key: `p-${task.id}`, kind: "card", task, variant: "inProgress" });
    }
    if (buckets.upNext.length > 0) {
      out.push({ key: "h-up", kind: "header", section: "upNext", count: buckets.upNext.length });
      for (const task of buckets.upNext) out.push({ key: `u-${task.id}`, kind: "card", task, variant: "queue" });
    }
    if (buckets.later.length > 0) {
      out.push({ key: "h-later", kind: "header", section: "later", count: buckets.later.length, toggle: !nothingElse, open: laterVisible });
      if (laterVisible) for (const task of buckets.later) out.push({ key: `l-${task.id}`, kind: "card", task, variant: "queue" });
    }
    return out;
  }, [segment, available.tasks, buckets, laterVisible, nothingElse]);

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "intro") {
      return (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
          {t("tasks.hk.availableIntro")}
        </Text>
      );
    }
    if (item.kind === "header") {
      const title = t(`tasks.hk.sections.${item.section}`) + (item.count !== undefined ? ` · ${item.count}` : "");
      const body = (
        <View style={styles.sectionHeader}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
            {title}
          </Text>
          {item.toggle ? <Ionicons name={item.open ? "chevron-up" : "chevron-down"} size={16} color={theme.textMuted} /> : null}
        </View>
      );
      return item.toggle ? (
        <Pressable
          onPress={() => setLaterOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={t(item.open ? "tasks.hk.sections.hideLater" : "tasks.hk.sections.showLater")}
          accessibilityState={{ expanded: !!item.open }}
          style={styles.headerPressable}
        >
          {body}
        </Pressable>
      ) : (
        body
      );
    }
    const { task, variant } = item;
    return (
      <TaskCard
        task={task}
        variant={variant}
        now={now}
        zone={zone}
        language={language}
        busy={queue.busyIds.has(task.id)}
        actionsDisabled={!isOnline}
        expanded={expandedId === task.id}
        confirming={confirmingId === task.id}
        onToggleDetails={() => setExpandedId((id) => (id === task.id ? null : task.id))}
        onPrimary={() => onPrimary(task, variant)}
        onConfirm={() => void run("complete", task)}
        onCancelConfirm={() => setConfirmingId(null)}
      />
    );
  };

  const reload = segment === "mine" ? queue.reloadMine : queue.reloadAvailable;
  const retry = () => {
    void reload();
  };

  let empty: React.ReactNode = null;
  if (list.status === "loading") {
    empty = <Skeleton />;
  } else if (list.status === "error") {
    empty = (
      <EmptyState
        icon="cloud-offline-outline"
        iconColor={theme.status.dirty}
        title={t("tasks.hk.error.loadTitle")}
        action={<Button label={t("common.retry")} onPress={retry} variant="secondary" icon="refresh" />}
      />
    );
  } else if (segment === "mine" && mine.tasks.length === 0) {
    empty = (
      <EmptyState
        icon="checkmark-circle-outline"
        title={t("tasks.hk.empty.myTitle")}
        body={t("tasks.hk.empty.myBody")}
        action={<Button label={t("tasks.hk.empty.viewAvailable")} onPress={() => setSegment("available")} variant="secondary" />}
      />
    );
  } else if (segment === "available" && available.tasks.length === 0) {
    empty = (
      <EmptyState
        icon="file-tray-outline"
        title={t("tasks.hk.empty.availableTitle")}
        body={t("tasks.hk.empty.availableBody")}
      />
    );
  }

  const banner = list.stale ? (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.pickup }]}>
        {t("tasks.hk.error.staleBanner")}
      </Text>
      <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel={t("common.retry")} style={styles.bannerRetry}>
        <Text style={[styles.bannerRetryText, { color: theme.status.pickup }]}>{t("common.retry")}</Text>
      </Pressable>
    </View>
  ) : list.truncated ? (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.pickup }]}>
        {t("tasks.hk.error.incomplete")}
      </Text>
    </View>
  ) : null;

  const messageBanner = message ? (
    <View style={[styles.banner, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.dirty }]}>
        {message}
      </Text>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TasksHeader
        dateLabel={dateLabel(now, zone, language)}
        sync={sync}
        summary={summary}
        segment={segment}
        counts={counts}
        onSegmentChange={(next) => {
          setSegment(next);
          setConfirmingId(null);
        }}
        onOpenHistory={() => router.push("/(app)/tasks/history" as never)}
        topInset={insets.top}
      />
      <FlatList
        data={empty ? [] : rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ListHeaderComponent={
          <View style={styles.banners}>
            {messageBanner}
            {banner}
          </View>
        }
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={queue.refreshing} onRefresh={() => void queue.pullToRefresh()} tintColor={theme.primaryAction} />
        }
      />
      <Pressable
        onPress={() => setAddOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("tasks.hk.add.button")}
        style={[styles.addButton, { backgroundColor: theme.primaryAction, bottom: 16 + Math.max(insets.bottom - 8, 0) }]}
        testID="add-task-button"
      >
        <Ionicons name="add" size={22} color={theme.onPrimary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.addText, { color: theme.onPrimary }]}>
          {t("tasks.hk.add.button")}
        </Text>
      </Pressable>
      <AddTaskSheet
        visible={addOpen}
        isOnline={isOnline}
        onClose={() => setAddOpen(false)}
        onCreated={() => void queue.refreshAll()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10, flexGrow: 1 },
  banners: { gap: 8 },
  banner: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  bannerRetry: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  bannerRetryText: { fontSize: 13.5, fontWeight: "800" },
  intro: { fontSize: 13.5, lineHeight: 19, paddingTop: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10 },
  headerPressable: { minHeight: 44, justifyContent: "center" },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9 },
  skeletonStack: { gap: 10, paddingTop: 4 },
  skeleton: { height: 112, borderRadius: 16, borderWidth: 1 },
  addButton: {
    position: "absolute",
    left: 16,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  addText: { fontSize: 15, fontWeight: "800" },
});
