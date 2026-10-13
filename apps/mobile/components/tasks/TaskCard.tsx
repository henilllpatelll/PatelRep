import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { monoFont, R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { Task } from "@/lib/api/tasks";
import { minutesSince, overdueMinutes } from "@/lib/tasks/workQueue";
import type { SyncRowState } from "@/lib/tasks/offline/syncStatus";

/* ─── Task card ──────────────────────────────────────────────────────────────
   Hierarchy: location -> title -> urgency/status -> type -> time context -> ONE action.
   The body opens the Task Detail sheet; the action button is a separate target so the two never
   compete. Completing is confirmed in its own sheet, never one accidental tap. Urgency is always spelled out in
   text, never colour alone. All colours come from the active theme. */

const MAX_FONT_SCALE = 1.5;

type IconName = ComponentProps<typeof Ionicons>["name"];

const TYPE_ICON: Record<Task["task_type"], IconName> = {
  housekeeping: "bed-outline",
  engineering: "construct-outline",
  guest_request: "person-outline",
  lost_found: "search-outline",
  general: "clipboard-outline",
};

export type TaskCardVariant = "hero" | "inProgress" | "queue" | "available" | "blocked";

export interface TaskCardProps {
  task: Task;
  variant: TaskCardVariant;
  now: Date;
  zone: string | null;
  language: string;
  /** A mutation for this task is running. */
  busy: boolean;
  /** Actions are unavailable (e.g. offline). Details still open. */
  actionsDisabled: boolean;
  onOpenDetails: () => void;
  onPrimary: () => void;
  /**
   * A completion saved on this device that the server has not confirmed. The card stays in My Work,
   * clearly not "done", and offers details only (no second completion request is possible).
   */
  pending?: { state: SyncRowState; queuedAt: string } | null;
}

function durationLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  minutes: number,
  shortKey: string,
  longKey: string,
): string {
  return minutes >= 60
    ? t(longKey, { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t(shortKey, { minutes });
}

export function TaskCard({
  task,
  variant,
  now,
  zone,
  language,
  busy,
  actionsDisabled,
  onOpenDetails,
  onPrimary,
  pending = null,
}: TaskCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const hero = variant === "hero";

  const late = overdueMinutes(task, now);
  const urgent = task.priority === "urgent";
  const typeLabel = t(`tasks.typeLabel.${task.task_type}`);
  const dueTime = formatHotelTime(task.due_at, zone, language);
  const started = minutesSince(task.started_at, now);

  const locationText = task.room_number
    ? t("tasks.hk.card.room", { room: task.room_number })
    : task.location_text;

  const timeContext =
    variant === "inProgress"
      ? started === null
        ? null
        : started < 1
          ? t("tasks.hk.card.startedJustNow")
          : durationLabel(t, started, "tasks.hk.card.startedAgo", "tasks.hk.card.startedAgoHours")
      : dueTime
        ? t("tasks.hk.card.due", { time: dueTime })
        : null;

  const blocker = task.blocker;
  const blockerReason = blocker ? t(`tasks.hk.blocker.reason.${blocker.reason}`) : null;
  const reportedTime = blocker ? formatHotelTime(blocker.reported_at, zone, language) : null;

  const needsReview = pending?.state === "conflict" || pending?.state === "failed";
  const savedAt = pending ? formatHotelTime(pending.queuedAt, zone, language) ?? "" : "";
  const detailsOnly = variant === "blocked" || pending !== null;

  const action =
    detailsOnly
      ? { label: t("tasks.hk.action.viewDetails"), a11y: t("tasks.hk.action.viewDetailsA11y", { title: task.title }), icon: "eye-outline" as IconName }
      : variant === "inProgress"
      ? { label: t("tasks.hk.action.complete"), a11y: t("tasks.hk.action.completeA11y", { title: task.title }), icon: "checkmark" as IconName }
      : variant === "available"
        ? { label: t("tasks.hk.action.claim"), a11y: t("tasks.hk.action.claimA11y", { title: task.title }), icon: "hand-left-outline" as IconName }
        : { label: t("tasks.hk.action.start"), a11y: t("tasks.hk.action.startA11y", { title: task.title }), icon: "play" as IconName };

  const railColor = needsReview ? theme.status.dirty : late !== null ? theme.status.dirty : urgent || blocker || pending ? theme.status.pickup : theme.border;
  const lateText = late !== null ? durationLabel(t, late, "tasks.hk.card.overdueBy", "tasks.hk.card.overdueByHours") : null;
  const mutedColor = theme.textMuted;

  return (
    <View
      testID={`task-${task.id}`}
      style={[
        styles.card,
        hero && styles.cardHero,
        {
          backgroundColor: hero ? theme.surfaceElevated : theme.surface,
          borderColor: hero ? theme.primaryLine : late !== null ? theme.status.dirtyLine : theme.border,
        },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: railColor }]} />
      <View style={styles.content}>
        <Pressable
          onPress={onOpenDetails}
          accessibilityRole="button"
          accessibilityLabel={t("tasks.hk.action.openDetails", { title: task.title })}
          style={styles.body}
          testID={`task-open-${task.id}`}
        >
          <View style={styles.topRow}>
            <View style={styles.locationRow}>
              <Ionicons
                name={task.room_number ? "bed-outline" : task.location_text ? "location-outline" : TYPE_ICON[task.task_type]}
                size={13}
                color={theme.textSecondary}
              />
              {locationText ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  numberOfLines={1}
                  style={[styles.location, { color: theme.textSecondary }]}
                >
                  {locationText}
                </Text>
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.location, { color: theme.textSecondary }]}>
                  {typeLabel}
                </Text>
              )}
            </View>
            {lateText ? (
              <View style={styles.lateRow}>
                <Ionicons name="alert-circle" size={13} color={theme.status.dirty} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.late, { color: theme.status.dirty }]}>
                  {lateText}
                </Text>
              </View>
            ) : null}
          </View>

          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={2}
            style={[styles.title, hero && styles.titleHero, { color: theme.textPrimary }]}
          >
            {task.title}
          </Text>

          {pending ? (
            <View
              style={[
                styles.blockerRow,
                needsReview
                  ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
                  : { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
              ]}
              accessible
              accessibilityLabel={
                needsReview
                  ? t("tasks.hk.offline.card.conflictA11y", { title: task.title })
                  : t("tasks.hk.offline.card.pendingA11y", { title: task.title, time: savedAt })
              }
              testID={`task-pending-${task.id}`}
            >
              <Ionicons
                name={needsReview ? "warning-outline" : "time-outline"}
                size={15}
                color={needsReview ? theme.status.dirty : theme.status.pickup}
              />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerReason, { color: needsReview ? theme.status.dirty : theme.status.pickup }]}>
                {needsReview ? t("tasks.hk.offline.card.conflictTitle") : t("tasks.hk.offline.card.pendingTitle")}
              </Text>
              {!needsReview ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerTime, { color: theme.textSecondary }]}>
                  {pending.state === "sending" ? t("tasks.hk.offline.card.sending") : t("tasks.hk.offline.card.savedAt", { time: savedAt })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {blocker && blockerReason && !pending ? (
            <View
              style={[styles.blockerRow, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
              accessible
              accessibilityLabel={t("tasks.hk.blocker.panel.a11y", { reason: blockerReason, time: reportedTime ?? "" })}
              testID={`task-blocker-${task.id}`}
            >
              <Ionicons name="alert-circle-outline" size={15} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerReason, { color: theme.status.pickup }]}>
                {blockerReason}
              </Text>
              {reportedTime ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerTime, { color: theme.textSecondary }]}>
                  {t("tasks.hk.card.reportedAt", { time: reportedTime })}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.metaRow}>
            {urgent ? (
              <View style={[styles.urgentBadge, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.urgentText, { color: theme.status.pickup }]}>
                  {t("tasks.hk.card.urgent")}
                </Text>
              </View>
            ) : null}
            {locationText ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: mutedColor }]}>
                {typeLabel}
              </Text>
            ) : null}
            {locationText && timeContext ? (
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.meta, { color: mutedColor }]}>
                ·
              </Text>
            ) : null}
            {timeContext ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: mutedColor }]}>
                {timeContext}
              </Text>
            ) : null}
          </View>

        </Pressable>

        <View style={styles.actionRow}>
          <Button
            label={action.label}
            accessibilityLabel={action.a11y}
            onPress={detailsOnly ? onOpenDetails : onPrimary}
            icon={action.icon}
            loading={busy}
            disabled={detailsOnly ? false : actionsDisabled}
            variant={variant === "inProgress" || detailsOnly ? "secondary" : "primary"}
            style={styles.flex}
            testID={`task-action-${task.id}`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderWidth: 1, borderRadius: R.lg, overflow: "hidden" },
  cardHero: { borderWidth: 1.5 },
  rail: { width: 5 },
  content: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 6, gap: 6, minHeight: 44 },
  flex: { flex: 1 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  location: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "700", letterSpacing: 0.3, flexShrink: 1 },
  lateRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  late: { fontSize: 12.5, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", lineHeight: 21 },
  titleHero: { fontSize: 19, lineHeight: 25 },
  blockerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, alignSelf: "flex-start" },
  blockerReason: { fontSize: 13, fontWeight: "800" },
  blockerTime: { fontSize: 12.5 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  meta: { fontSize: 12.5 },
  urgentBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  urgentText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  actionRow: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4 },
});
