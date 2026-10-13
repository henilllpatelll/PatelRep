import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ActivityFeed } from "@/components/tasks/ActivityFeed";
import { useTheme } from "@/lib/theme/useTheme";
import { addTaskComment, TASK_NOTE_MAX, type Task } from "@/lib/api/tasks";
import { canAddNote, type Viewer } from "@/lib/tasks/taskActions";
import { shortPlace } from "@/lib/tasks/taskDisplay";
import { useTaskActivity } from "@/lib/tasks/useTaskActivity";

interface Props {
  visible: boolean;
  task: Task | null;
  viewer: Viewer;
  zone: string | null;
  language: string;
  now: Date;
  offline: boolean;
  onClose: () => void;
  /** The server's current copy of the task, so lists and the detail sheet stay in step. */
  onTaskRefreshed: (task: Task) => void;
}

function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * Persisted activity + notes for one task. A note appears in the feed only after the server stored
 * it; if posting fails the draft stays in the box, with a plain-language reason, for a retry.
 */
export function ActivityNotesSheet({ visible, task, viewer, zone, language, now, offline, onClose, onTaskRefreshed }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const taskId = visible && task ? task.id : null;
  const activity = useTaskActivity(taskId);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const fetched = activity.data?.task ?? null;
  useEffect(() => {
    if (fetched) onTaskRefreshed(fetched);
  }, [fetched]);

  // A draft belongs to one task.
  useEffect(() => {
    setDraft("");
    setError(null);
  }, [task?.id]);

  const effective = fetched ?? task;
  const writable = !!effective && canAddNote(effective, viewer) && !activity.gone;
  const trimmed = draft.trim();
  const tooLong = draft.length > TASK_NOTE_MAX;

  const post = useCallback(async () => {
    if (!task || lock.current) return;
    if (!trimmed) {
      setError(t("tasks.hk.sheet.notes.needText"));
      return;
    }
    if (tooLong || offline) return;
    lock.current = true;
    setPosting(true);
    setError(null);
    try {
      await addTaskComment(task.id, trimmed);
      setDraft("");
      await activity.reload();
    } catch (failure) {
      const status = httpStatus(failure);
      if (status === 403 || status === 404) {
        setError(t("tasks.hk.sheet.reason.unavailable"));
        void activity.reload();
      } else {
        setError(t("tasks.hk.sheet.notes.postFailed"));
      }
    } finally {
      lock.current = false;
      setPosting(false);
    }
  }, [task, trimmed, tooLong, offline, activity, t]);

  if (!task) return null;

  const place = shortPlace(task, t);
  const subtitle = place ? t("tasks.hk.sheet.notes.subtitle", { place, title: task.title }) : task.title;
  const events = activity.data?.events ?? [];
  const hasNotes = events.some((event) => event.kind === "comment");

  const footer = writable ? (
    <View style={styles.composer}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
        {t("tasks.hk.sheet.notes.addLabel")}
      </Text>
      <TextInput
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          if (error) setError(null);
        }}
        editable={!posting}
        multiline
        placeholder={t("tasks.hk.sheet.notes.placeholder")}
        placeholderTextColor={theme.textDisabled}
        accessibilityLabel={t("tasks.hk.sheet.notes.inputA11y")}
        style={[
          styles.input,
          { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: tooLong ? theme.status.dirty : theme.borderSubtle },
        ]}
        testID="note-input"
      />
      {tooLong ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.hk.sheet.notes.tooLong", { max: TASK_NOTE_MAX })}
        </Text>
      ) : null}
      {offline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.hk.sheet.reason.offline")}
        </Text>
      ) : null}
      {error ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert" testID="note-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t("tasks.hk.sheet.notes.post")}
        onPress={() => void post()}
        loading={posting}
        disabled={posting || offline || tooLong}
        icon="send"
        testID="note-post"
      />
    </View>
  ) : undefined;

  return (
    <BottomSheet
      visible={visible}
      title={t("tasks.hk.sheet.activityTitle")}
      onClose={posting ? () => undefined : onClose}
      footer={footer}
      grabber
      tall
      testID="activity-notes-sheet"
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]} testID="activity-subtitle">
        {subtitle}
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
          <Pressable onPress={() => void activity.reload()} accessibilityRole="button" accessibilityLabel={t("common.retry")} style={styles.retry}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryText, { color: theme.primaryAction }]}>
              {t("common.retry")}
            </Text>
          </Pressable>
        </View>
      ) : activity.gone ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.hk.sheet.reason.unavailable")}
        </Text>
      ) : (
        <>
          {activity.stale ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("tasks.hk.sheet.activityStale")}
            </Text>
          ) : null}
          {activity.data?.truncated ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("tasks.hk.sheet.activityTruncated")}
            </Text>
          ) : null}
          {events.length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="activity-empty">
              {t("tasks.hk.sheet.notes.empty")}
            </Text>
          ) : (
            <>
              {!hasNotes ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="notes-empty">
                  {t("tasks.hk.sheet.notes.emptyNotes")}
                </Text>
              ) : null}
              <ActivityFeed events={events} viewer={viewer} zone={zone} language={language} now={now} grouped />
            </>
          )}
        </>
      )}
      {!writable && activity.status === "ready" && !activity.gone ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="notes-readonly">
          {t("tasks.hk.sheet.notes.readOnly")}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  muted: { fontSize: 13.5, lineHeight: 19 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  retry: { minHeight: 44, justifyContent: "center" },
  retryText: { fontSize: 14, fontWeight: "700" },
  composer: { gap: 8, paddingBottom: 4 },
  label: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  input: { minHeight: 72, maxHeight: 140, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: "top" },
  hint: { fontSize: 12.5, fontWeight: "600" },
});
