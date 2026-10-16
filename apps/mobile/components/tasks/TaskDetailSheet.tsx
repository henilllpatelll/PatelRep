import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ActivityFeed } from "@/components/tasks/ActivityFeed";
import { TaskHelpCard } from "@/components/tasks/TaskHelpCard";
import { TaskTranslation } from "@/components/tasks/TaskTranslation";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import type { Task } from "@/lib/api/tasks";
import { canAddNote, isMine, primaryAction, type TaskAction, type Viewer } from "@/lib/tasks/taskActions";
import { canReportBlocker, notificationKey } from "@/lib/tasks/blockers";
import { formatWhen, placeLabel, shortPlace, statusLabel } from "@/lib/tasks/taskDisplay";
import { isOverdue } from "@/lib/tasks/workQueue";
import { useTaskActivity } from "@/lib/tasks/useTaskActivity";
import { canRetryConflict, type OutboxEntry } from "@/lib/tasks/offline/outboxPolicy";
import type { SyncRowState } from "@/lib/tasks/offline/syncStatus";

const PREVIEW_EVENTS = 3;
/** Instructions longer than this fold behind "Show more" so the actions stay reachable. */
const LONG_TEXT = 280;

interface Props {
  visible: boolean;
  /** The task as the lists/mutations last reported it. */
  task: Task | null;
  viewer: Viewer;
  zone: string | null;
  language: string;
  now: Date;
  /** A lifecycle request for this task is running. */
  busy: boolean;
  offline: boolean;
  /** Plain-language reason from the last refused/failed action, shown above the buttons. */
  notice: string | null;
  /** My Rooms detail can be opened only when this room is in the employee's own room list. */
  canOpenRoom: boolean;
  onClose: () => void;
  /** The server's current copy, fetched when the sheet opened or reloaded. */
  onTaskRefreshed: (task: Task) => void;
  onAction: (action: Exclude<TaskAction, "complete">) => void;
  onRequestComplete: () => void;
  /** Open "Unable to complete?" for this task (nothing is sent until the employee submits). */
  onRequestBlocker: () => void;
  onOpenNotes: () => void;
  onOpenRoom: () => void;
  /** A completion saved on this device for this task (pending, or refused and waiting for review). */
  queued?: { entry: OutboxEntry; state: SyncRowState } | null;
  onRetryQueued?: () => void;
  onDismissQueued?: () => void;
  /** Offline: when the saved copy on screen was last synced (null = unknown). */
  savedCopySyncedAt?: string | null;
  /** Open the assistant about this task. Given only when the assistant exists and may use this task as context. */
  onAskAssistant?: () => void;
  /** Offer "Translate instructions". Given only for a task the server will let this person read (the same rule as the assistant). */
  canTranslate?: boolean;
  onFindProcedure?: () => void;
  onOpenProcedure?: (documentId: string) => void;
}

export function TaskDetailSheet({
  visible,
  task,
  viewer,
  zone,
  language,
  now,
  busy,
  offline,
  notice,
  canOpenRoom,
  onClose,
  onTaskRefreshed,
  onAction,
  onRequestComplete,
  onRequestBlocker,
  onOpenNotes,
  onOpenRoom,
  queued = null,
  onRetryQueued,
  onDismissQueued,
  savedCopySyncedAt = null,
  onAskAssistant,
  canTranslate = false,
  onFindProcedure,
  onOpenProcedure,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  // Offline there is nothing to fetch: the saved copy is shown and activity waits for a connection.
  const activity = useTaskActivity(visible && task && !offline ? task.id : null);

  // Whatever the server says now replaces what the list showed when the card was tapped.
  const fetched = activity.data?.task ?? null;
  useEffect(() => {
    if (fetched) onTaskRefreshed(fetched);
  }, [fetched]);
  useEffect(() => setExpanded(false), [task?.id]);

  // A saved completion is never offered a second time; the sheet shows its state instead.
  const action = task && !queued ? primaryAction(task, viewer) : null;
  const review = queued && (queued.state === "conflict" || queued.state === "failed") ? queued : null;
  const events = activity.data?.events ?? [];
  const preview = useMemo(() => events.slice(-PREVIEW_EVENTS), [events]);

  if (!task) return null;

  const place = placeLabel(task, t);
  const overdue = (task.status === "open" || task.status === "in_progress" || task.status === "escalated") && isOverdue(task, now);
  const dueText = formatWhen(task.due_at, now, zone, language);
  const startedText = formatWhen(task.started_at, now, zone, language);
  const completedText = task.status === "completed" ? formatWhen(task.completed_at, now, zone, language) : null;
  const assignee = isMine(task, viewer) ? t("tasks.hk.sheet.you") : task.assigned_to_name;
  const readOnlyKey = task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : !action ? "other" : null;
  const longText = (task.description?.length ?? 0) > LONG_TEXT;
  const typeLabel = t(`tasks.typeLabel.${task.task_type}`);
  const actionsDisabled = offline || busy;

  const rows: Array<{ key: string; label: string; value: string; warn?: boolean; room?: boolean }> = [];
  if (place) rows.push({ key: "location", label: t("tasks.hk.sheet.field.location"), value: place, room: !!task.room_id });
  if (dueText) {
    rows.push({
      key: "due",
      label: t("tasks.hk.sheet.field.due"),
      value: overdue ? `${dueText} · ${t("tasks.hk.sheet.overdue")}` : dueText,
      warn: overdue,
    });
  }
  if (assignee) rows.push({ key: "assigned", label: t("tasks.hk.sheet.field.assignedTo"), value: assignee });
  else if (task.status === "open") rows.push({ key: "assigned", label: t("tasks.hk.sheet.field.assignedTo"), value: t("tasks.hk.sheet.unassigned") });
  if (task.created_by_name) rows.push({ key: "creator", label: t("tasks.hk.sheet.field.createdBy"), value: task.created_by_name });
  if (startedText) rows.push({ key: "started", label: t("tasks.hk.sheet.field.started"), value: startedText });
  if (completedText) rows.push({ key: "completed", label: t("tasks.hk.sheet.field.completed"), value: completedText });
  if (task.guest_request) rows.push({ key: "guest", label: t("tasks.hk.sheet.field.guestRequest"), value: t("tasks.hk.sheet.guestRequestLinked") });

  const reportable = canReportBlocker(task, viewer);
  const unableButton = reportable ? (
    <Button
      label={t("tasks.hk.sheet.action.unableToComplete")}
      onPress={onRequestBlocker}
      variant="ghost"
      icon="alert-circle-outline"
      disabled={busy}
      testID="detail-unable"
    />
  ) : null;

  const footer = (
    <>
      {action === "resume" ? (
        <>
          <Button
            label={t("tasks.hk.sheet.action.resume")}
            accessibilityLabel={t("tasks.hk.action.resumeA11y", { title: task.title })}
            onPress={() => onAction("resume")}
            icon="play"
            size="lg"
            loading={busy}
            disabled={actionsDisabled}
            testID="detail-resume"
          />
          <Button
            label={t("tasks.hk.sheet.action.viewActivity")}
            onPress={onOpenNotes}
            variant="secondary"
            icon="time-outline"
            disabled={busy}
            testID="detail-view-activity"
          />
        </>
      ) : null}
      {action === "start" ? (
        <Button
          label={t("tasks.hk.sheet.action.start")}
          accessibilityLabel={t("tasks.hk.action.startA11y", { title: task.title })}
          onPress={() => onAction("start")}
          icon="play"
          size="lg"
          loading={busy}
          disabled={actionsDisabled}
          testID="detail-start"
        />
      ) : null}
      {action === "start" ? unableButton : null}
      {action === "claim" ? (
        <Button
          label={t("tasks.hk.sheet.action.claim")}
          accessibilityLabel={t("tasks.hk.action.claimA11y", { title: task.title })}
          onPress={() => onAction("claim")}
          icon="hand-left-outline"
          size="lg"
          loading={busy}
          disabled={actionsDisabled}
          testID="detail-claim"
        />
      ) : null}
      {action === "complete" ? (
        <>
          <Button
            label={t("tasks.hk.sheet.action.complete")}
            accessibilityLabel={t("tasks.hk.action.completeA11y", { title: task.title })}
            onPress={onRequestComplete}
            icon="checkmark"
            size="lg"
            // Offline, completing can still be saved for sync (the complete sheet applies the rules).
            disabled={busy}
            testID="detail-complete"
          />
          {canAddNote(task, viewer) ? (
            <Button
              label={t("tasks.hk.sheet.action.addNote")}
              onPress={onOpenNotes}
              variant="secondary"
              icon="chatbubble-ellipses-outline"
              disabled={busy}
              testID="detail-add-note"
            />
          ) : null}
          {unableButton}
        </>
      ) : null}
    </>
  );

  const reviewFooter = review ? (
    <>
      {review.state === "failed" || canRetryConflict(review.entry.conflict?.reason) ? (
        <Button label={t("tasks.hk.offline.detail.retry")} onPress={() => onRetryQueued?.()} icon="refresh" size="lg" disabled={offline} testID="queued-retry" />
      ) : null}
      <Button
        label={t("tasks.hk.offline.detail.viewUpdated")}
        onPress={() => void activity.reload()}
        variant="secondary"
        icon="eye-outline"
        disabled={offline}
        testID="queued-view-updated"
      />
      <Button label={t("tasks.hk.offline.detail.dismiss")} onPress={() => onDismissQueued?.()} variant="ghost" icon="close-circle-outline" testID="queued-dismiss" />
    </>
  ) : null;

  return (
    <BottomSheet
      visible={visible}
      title={t("tasks.hk.sheet.detailTitle")}
      onClose={busy ? () => undefined : onClose}
      footer={review ? reviewFooter : action ? footer : undefined}
      grabber
      testID="task-detail-sheet"
    >
      <View style={styles.head}>
        <View style={styles.headRow}>
          <View style={styles.placeRow}>
            <Ionicons
              name={task.room_number ? "bed-outline" : "location-outline"}
              size={15}
              color={theme.textSecondary}
            />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.place, { color: theme.textSecondary }]} numberOfLines={1}>
              {shortPlace(task, t) ?? typeLabel}
            </Text>
          </View>
          {task.priority === "urgent" ? (
            <View style={[styles.urgent, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.urgentText, { color: theme.status.pickup }]}>
                {t("tasks.hk.sheet.priorityUrgent")}
              </Text>
            </View>
          ) : null}
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {task.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textMuted }]}>
          {t("tasks.hk.sheet.subtitle", { type: typeLabel, status: statusLabel(task, viewer, t) })}
        </Text>
      </View>

      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.status.dirty }]}>
            {notice}
          </Text>
        </View>
      ) : null}

      {task.blocker ? (
        <View
          style={[styles.blockerPanel, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
          accessible
          accessibilityLabel={t("tasks.hk.blocker.panel.a11y", {
            reason: t(`tasks.hk.blocker.reason.${task.blocker.reason}`),
            time: formatWhen(task.blocker.reported_at, now, zone, language) ?? "",
          })}
          testID="detail-blocker"
        >
          <View style={styles.blockerHead}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.blockerTitle, { color: theme.status.pickup }]}>
              {t("tasks.hk.blocker.panel.title")}
            </Text>
          </View>
          {(
            [
              ["reason", t(`tasks.hk.blocker.reason.${task.blocker.reason}`)],
              [
                "reportedBy",
                task.blocker.reported_by && task.blocker.reported_by === viewer.userId
                  ? t("tasks.hk.sheet.you")
                  : task.blocker.reported_by_name,
              ],
              ["reportedAt", formatWhen(task.blocker.reported_at, now, zone, language)],
              ["details", task.blocker.details],
            ] as Array<[string, string | null]>
          )
            .filter(([, value]) => !!value)
            .map(([key, value]) => (
              <View key={key} style={styles.blockerRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detailLabel, { color: theme.textMuted }]}>
                  {t(`tasks.hk.blocker.panel.${key}`)}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detailValue, { color: theme.textPrimary }]} testID={`detail-blocker-${key}`}>
                  {value}
                </Text>
              </View>
            ))}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerNotify, { color: theme.textSecondary }]} testID="detail-blocker-notify">
            {t(notificationKey(task.blocker.notification_status))}
          </Text>
        </View>
      ) : null}

      {offline ? (
        <View style={[styles.notice, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="detail-saved-copy">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
            {savedCopySyncedAt && formatWhen(savedCopySyncedAt, now, zone, language)
              ? t("tasks.hk.offline.detail.cachedBanner", { time: formatWhen(savedCopySyncedAt, now, zone, language) })
              : t("tasks.hk.offline.detail.cachedBannerNoTime")}
          </Text>
        </View>
      ) : null}

      {queued ? (
        <View
          style={[
            styles.notice,
            review
              ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
              : { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
          ]}
          accessibilityRole="alert"
          testID="detail-queued"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockerTitle, { color: review ? theme.status.dirty : theme.status.pickup }]}>
            {queued.state === "conflict"
              ? t("tasks.hk.offline.detail.conflictTitle")
              : queued.state === "failed"
                ? t("tasks.hk.offline.detail.failedTitle")
                : t("tasks.hk.offline.detail.pendingTitle")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
            {queued.state === "conflict"
              ? t(`tasks.hk.offline.detail.conflict.${queued.entry.conflict?.reason ?? "changed"}`)
              : queued.state === "failed"
                ? queued.entry.conflict?.reason === "expired"
                  ? t("tasks.hk.offline.detail.conflict.expired")
                  : t("tasks.hk.offline.detail.failedBody")
                : queued.state === "sending"
                  ? t("tasks.hk.offline.detail.sendingBody")
                  : t("tasks.hk.offline.detail.pendingBody", { time: formatWhen(queued.entry.queuedAt, now, zone, language) ?? "" })}
          </Text>
          {queued.state === "conflict" ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
              {t("tasks.hk.offline.detail.supervisor")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {readOnlyKey && !queued ? (
        <View style={[styles.notice, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="detail-readonly">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
            {t(`tasks.hk.sheet.readOnly.${readOnlyKey}`)}
          </Text>
        </View>
      ) : null}

      {task.description ? (
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
            {t("tasks.hk.sheet.instructions")}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={longText && !expanded ? 6 : undefined}
            style={[styles.body, { color: theme.textPrimary }]}
            testID="detail-description"
          >
            {task.description}
          </Text>
          {longText ? (
            <Pressable
              onPress={() => setExpanded((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={t(expanded ? "tasks.hk.sheet.showLess" : "tasks.hk.sheet.showMore")}
              style={styles.link}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
                {t(expanded ? "tasks.hk.sheet.showLess" : "tasks.hk.sheet.showMore")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
            {t("tasks.hk.sheet.details")}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
            {rows.map((row) => (
              <View key={row.key} style={styles.detailRow} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detailLabel, { color: theme.textMuted }]}>
                  {row.label}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.detailValue, { color: row.warn ? theme.status.dirty : theme.textPrimary }]}
                >
                  {row.value}
                </Text>
              </View>
            ))}
            {canOpenRoom && task.room_number ? (
              <Pressable
                onPress={onOpenRoom}
                accessibilityRole="button"
                accessibilityLabel={t("tasks.hk.sheet.action.openRoomA11y", { room: task.room_number })}
                style={styles.roomLink}
                testID="detail-open-room"
              >
                <Ionicons name="bed-outline" size={16} color={theme.primaryAction} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
                  {t("tasks.hk.sheet.action.openRoom", { room: task.room_number })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {!review && canTranslate ? <TaskTranslation task={task} offline={offline} /> : null}

      {!review ? (
        <TaskHelpCard task={task} viewer={viewer} zone={zone} language={language} now={now} offline={offline} onAskAssistant={onAskAssistant} onFindProcedure={onFindProcedure} onOpenProcedure={onOpenProcedure} />
      ) : null}

      {/* Offline there is nothing to fetch, so an empty Activity heading would say nothing. */}
      {offline && !activity.data ? null : (
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
            {t("tasks.hk.sheet.activity")}
          </Text>
          {activity.status === "loading" ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("tasks.hk.sheet.activityLoading")}
            </Text>
          ) : activity.status === "error" ? (
            <View style={styles.errorRow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                {t("tasks.hk.sheet.activityError")}
              </Text>
              <Pressable onPress={() => void activity.reload()} accessibilityRole="button" accessibilityLabel={t("common.retry")} style={styles.link}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
                  {t("common.retry")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <ActivityFeed events={preview} viewer={viewer} zone={zone} language={language} now={now} />
          )}
          {activity.status === "ready" ? (
            <Pressable
              onPress={onOpenNotes}
              accessibilityRole="button"
              accessibilityLabel={t("tasks.hk.sheet.action.viewAll")}
              style={styles.link}
              testID="detail-view-all"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
                {t("tasks.hk.sheet.action.viewAll")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  place: { fontFamily: monoFont, fontSize: 13, fontWeight: "700", letterSpacing: 0.3, flexShrink: 1 },
  urgent: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  urgentText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.2 },
  subtitle: { fontSize: 13.5 },
  blockerPanel: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  blockerHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockerTitle: { fontSize: 15, fontWeight: "800" },
  blockerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  blockerNotify: { fontSize: 13, lineHeight: 18, paddingTop: 2 },
  notice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  noticeText: { fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  body: { fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14, paddingVertical: 9 },
  detailLabel: { fontSize: 13.5, flexShrink: 0 },
  detailValue: { fontSize: 14, fontWeight: "600", flex: 1, textAlign: "right" },
  roomLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, justifyContent: "flex-end" },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { fontSize: 14, fontWeight: "700" },
  muted: { fontSize: 13.5 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
