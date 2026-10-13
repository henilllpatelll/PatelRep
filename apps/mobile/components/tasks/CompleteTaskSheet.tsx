import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import { TASK_NOTE_MAX, type Task } from "@/lib/api/tasks";
import { shortPlace } from "@/lib/tasks/taskDisplay";

export type CompletePhase = "confirm" | "noteFailed";

interface Props {
  visible: boolean;
  task: Task | null;
  phase: CompletePhase;
  note: string;
  onNoteChange: (value: string) => void;
  /** The request is in flight; the sheet can not be dismissed meanwhile. */
  busy: boolean;
  offline: boolean;
  /** Offline, and this completion can be saved on the device to sync later (the screen checked the rules). */
  canSaveOffline?: boolean;
  /** Plain-language reason the last attempt failed; the note is kept so it can be retried. */
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
  /** noteFailed phase: try saving the note again / give up on it. */
  onRetryNote: () => void;
  onSkipNote: () => void;
}

/**
 * Last look before a task is marked done. Nothing here changes the task: only "Confirm complete"
 * sends the request, and success is shown only after the server answers. If the task was completed
 * but its optional note could not be stored, the sheet says so and keeps the note for a retry.
 */
export function CompleteTaskSheet({
  visible,
  task,
  phase,
  note,
  onNoteChange,
  busy,
  offline,
  canSaveOffline = false,
  error,
  onConfirm,
  onBack,
  onRetryNote,
  onSkipNote,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!task) return null;

  const place = shortPlace(task, t);
  const identity = place ? `${place} · ${task.title}` : task.title;
  const tooLong = note.length > TASK_NOTE_MAX;
  const saving = offline && canSaveOffline;
  const blocked = busy || (offline && !canSaveOffline) || tooLong;
  const failedPhase = phase === "noteFailed";

  return (
    <BottomSheet
      visible={visible}
      title={t(failedPhase ? "tasks.hk.sheet.complete.noteFailedTitle" : saving ? "tasks.hk.offline.complete.title" : "tasks.hk.sheet.completeTitle")}
      onClose={busy ? () => undefined : failedPhase ? onSkipNote : onBack}
      grabber
      testID="complete-task-sheet"
      footer={
        failedPhase ? (
          <>
            <Button
              label={t("tasks.hk.sheet.complete.saveNote")}
              onPress={onRetryNote}
              loading={busy}
              disabled={blocked || note.trim().length === 0}
              size="lg"
              icon="chatbubble-ellipses-outline"
              testID="complete-retry-note"
            />
            <Button label={t("tasks.hk.sheet.complete.skipNote")} onPress={onSkipNote} variant="secondary" disabled={busy} testID="complete-skip-note" />
          </>
        ) : (
          <>
            <Button
              label={t(saving ? "tasks.hk.offline.complete.saveOffline" : "tasks.hk.sheet.complete.confirm")}
              onPress={onConfirm}
              loading={busy}
              disabled={blocked}
              size="lg"
              icon={saving ? "save-outline" : "checkmark"}
              testID="complete-confirm"
            />
            <Button label={t("tasks.hk.sheet.complete.back")} onPress={onBack} variant="secondary" disabled={busy} testID="complete-back" />
          </>
        )
      }
    >
      <View style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}>
          <Ionicons name={failedPhase ? "alert-circle-outline" : "checkmark-circle-outline"} size={28} color={theme.status.clean} />
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.identity, { color: theme.textPrimary }]} testID="complete-identity">
          {identity}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t(failedPhase ? "tasks.hk.sheet.complete.noteFailedBody" : saving ? "tasks.hk.offline.complete.body" : "tasks.hk.sheet.complete.body")}
        </Text>
      </View>

      <View style={styles.field}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
          {t("tasks.hk.sheet.complete.noteLabel")}
        </Text>
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          editable={!busy}
          multiline
          placeholder={t("tasks.hk.sheet.complete.notePlaceholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("tasks.hk.sheet.complete.noteA11y")}
          style={[
            styles.input,
            { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: tooLong ? theme.status.dirty : theme.borderSubtle },
          ]}
          testID="complete-note"
        />
        {tooLong ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert">
            {t("tasks.hk.sheet.complete.tooLong", { max: TASK_NOTE_MAX })}
          </Text>
        ) : note.length > TASK_NOTE_MAX * 0.8 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("tasks.hk.sheet.complete.count", { count: note.length, max: TASK_NOTE_MAX })}
          </Text>
        ) : null}
      </View>

      {offline && !canSaveOffline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.hk.sheet.reason.offline")}
        </Text>
      ) : null}
      {error ? (
        <View style={[styles.error, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert" testID="complete-error">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.errorText, { color: theme.status.dirty }]}>
            {error}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingVertical: 4 },
  badge: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  identity: { fontSize: 16, fontWeight: "700", textAlign: "center", lineHeight: 22 },
  body: { fontSize: 14.5, textAlign: "center", lineHeight: 20 },
  field: { gap: 6 },
  label: { fontSize: 12.5, fontWeight: "700" },
  input: { minHeight: 96, maxHeight: 180, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: "top" },
  hint: { fontSize: 12.5, fontWeight: "600" },
  error: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
});
