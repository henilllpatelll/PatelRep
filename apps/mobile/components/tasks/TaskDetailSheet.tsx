import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ActivityFeed } from "@/components/tasks/ActivityFeed";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import type { Task } from "@/lib/api/tasks";
import { canAddNote, isMine, primaryAction, type TaskAction, type Viewer } from "@/lib/tasks/taskActions";
import { formatWhen, placeLabel, shortPlace, statusLabel } from "@/lib/tasks/taskDisplay";
import { isOverdue } from "@/lib/tasks/workQueue";
import { useTaskActivity } from "@/lib/tasks/useTaskActivity";

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
  onOpenNotes: () => void;
  onOpenRoom: () => void;
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
  onOpenNotes,
  onOpenRoom,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const activity = useTaskActivity(visible && task ? task.id : null);

  // Whatever the server says now replaces what the list showed when the card was tapped.
  const fetched = activity.data?.task ?? null;
  useEffect(() => {
    if (fetched) onTaskRefreshed(fetched);
  }, [fetched]);
  useEffect(() => setExpanded(false), [task?.id]);

  const action = task ? primaryAction(task, viewer) : null;
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

  const footer = (
    <>
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
            disabled={actionsDisabled}
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
        </>
      ) : null}
    </>
  );

  return (
    <BottomSheet
      visible={visible}
      title={t("tasks.hk.sheet.detailTitle")}
      onClose={busy ? () => undefined : onClose}
      footer={action ? footer : undefined}
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

      {readOnlyKey ? (
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
