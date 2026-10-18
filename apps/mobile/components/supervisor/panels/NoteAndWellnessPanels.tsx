import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { InfoCard } from "@/components/supervisor/panels/PanelParts";
import { ROOM_NOTE_MAX_LENGTH } from "@/lib/housekeeping/roomNote";
import type { NoteController } from "@/lib/housekeeping/useRoomNote";
import type { WellnessController } from "@/lib/housekeeping/useRoomWellness";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Add note ──────────────────────────────────────────────────────────────
   Visibility is stated as it is: every authorised staff member of the hotel can read a room note. */

export function NotePanel({ roomNumber, controller, t, onCancel }: { roomNumber: string; controller: NoteController; t: Translate; onCancel: () => void }) {
  const theme = useTheme();
  const { draft, error, busy, needsCheck } = controller;
  const showCount = draft.length > ROOM_NOTE_MAX_LENGTH * 0.8;
  return (
    <View style={styles.stack} testID="room-note-panel">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{t("roomBoard.panel.note.visibility")}</Text>
      <TextInput
        value={draft}
        onChangeText={controller.setDraft}
        editable={!busy && !needsCheck}
        multiline
        maxLength={ROOM_NOTE_MAX_LENGTH}
        placeholder={t("roomBoard.panel.note.placeholder")}
        placeholderTextColor={theme.textDisabled}
        accessibilityLabel={t("roomBoard.panel.note.inputLabel", { room: roomNumber })}
        style={[styles.input, { backgroundColor: theme.surface, borderColor: error ? theme.status.dirty : theme.border, color: theme.textPrimary }]}
        testID="room-note-input"
      />
      {showCount ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]} testID="room-note-count">
          {t("roomBoard.panel.note.remaining", { count: ROOM_NOTE_MAX_LENGTH - draft.length })}
        </Text>
      ) : null}
      {error ? (
        <InfoCard tone="warn" testID="room-note-error">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.body, { color: theme.textPrimary }]}>
            {t(`roomBoard.panel.note.error.${error}`)}
          </Text>
        </InfoCard>
      ) : null}
      <Button
        label={needsCheck ? t("roomBoard.panel.note.check") : t("roomBoard.panel.note.save")}
        icon={needsCheck ? "refresh" : "checkmark"}
        onPress={() => void controller.save()}
        loading={busy}
        disabled={!controller.canSave}
        testID="room-note-save"
      />
      <Button label={t("common.cancel")} variant="secondary" onPress={onCancel} disabled={busy} testID="room-note-cancel" />
    </View>
  );
}

/* ─── DND wellness check ────────────────────────────────────────────────────
   Never "override": the request creates a task and notifies; it does not end DND or authorise entry. */

export function WellnessPanel({ controller, t, onDone, onCancel }: { controller: WellnessController; t: Translate; onDone: () => void; onCancel: () => void }) {
  const theme = useTheme();
  const { phase, error, eligible } = controller;
  if (phase === "done") {
    return (
      <View style={styles.stack} testID="room-wellness-done">
        <InfoCard>
          <Ionicons name="checkmark-circle-outline" size={22} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.strong, { color: theme.textPrimary }]}>
            {t(controller.alreadyRequested ? "roomBoard.panel.wellness.already" : "roomBoard.panel.wellness.requested")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{t("roomBoard.panel.wellness.stillOn")}</Text>
        </InfoCard>
        <Button label={t("roomBoard.panel.done")} onPress={onDone} testID="room-wellness-finish" />
      </View>
    );
  }
  return (
    <View style={styles.stack} testID="room-wellness-panel">
      <InfoCard>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]} testID="room-wellness-state">
          {t(eligible ? "roomBoard.panel.wellness.active" : "roomBoard.panel.wellness.notActive")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{t("roomBoard.panel.wellness.policy")}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{t("roomBoard.panel.wellness.effect")}</Text>
      </InfoCard>
      {error ? (
        <InfoCard tone="warn" testID="room-wellness-error">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.body, { color: theme.textPrimary }]}>
            {t(`roomBoard.panel.wellness.error.${error}`)}
          </Text>
        </InfoCard>
      ) : null}
      <Button
        label={error === "uncertain" ? t("roomBoard.panel.wellness.tryAgain") : t("roomBoard.panel.wellness.request")}
        icon="alert-circle-outline"
        onPress={() => void controller.submit()}
        loading={controller.busy}
        disabled={!controller.canSubmit}
        testID="room-wellness-request"
      />
      <Button label={t("common.cancel")} variant="secondary" onPress={onCancel} disabled={controller.busy} testID="room-wellness-cancel" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  body: { fontSize: 13.5, lineHeight: 19 },
  strong: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 110, maxHeight: 220, textAlignVertical: "top" },
  count: { fontSize: 12, textAlign: "right" },
});
