import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { formatBlockerTimeInput, type RoomBlocker } from "@/lib/housekeeping/roomBlockers";
import type { useRoomReports } from "@/lib/housekeeping/useRoomReports";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";

export type ReportTarget = "issue" | "found" | "supplies";

interface Props {
  visible: boolean;
  room: Room;
  /** Quick blockers for this room (guest inside, DND on door, come back later, ...). */
  blockers: RoomBlocker[];
  blockersTitle: string;
  reports: ReturnType<typeof useRoomReports>;
  showDnd: boolean;
  showDecline: boolean;
  onClose: () => void;
  /** Open one of the existing report modals (the screen sequences the hand-off). */
  onOpenTarget: (target: ReportTarget) => void;
}

interface RowProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  tint: string;
  busy?: boolean;
  disabled?: boolean;
  selected?: boolean;
  testID: string;
}

function Row({ icon, label, onPress, tint, busy, disabled, selected, testID }: RowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy), selected: Boolean(selected) }}
      style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: selected ? theme.primaryLine : theme.border }, disabled && styles.dim]}
      testID={testID}
    >
      {busy ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name={icon} size={20} color={tint} />}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );
}

/**
 * One entry point for everything a housekeeper can report from a room. Nothing is
 * new here: these are the note, work-order, lost & found, supplies, DND and
 * declined-service actions and the quick blockers that used to sit inline on the
 * screen. The sheet-by-sheet redesign of each flow is a later phase.
 */
export function ReportMoreSheet({ visible, room, blockers, blockersTitle, reports, showDnd, showDecline, onClose, onOpenTarget }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [timeKey, setTimeKey] = useState<string | null>(null);
  const [timeText, setTimeText] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNoteOpen(false);
      setNoteText("");
      setTimeKey(null);
      setTimeText("");
      setDone(null);
    }
  }, [visible]);

  const busy = reports.noteLoading || reports.blockerBusy != null;
  const activeBlocker = timeKey ? blockers.find((blocker) => blocker.key === timeKey) : undefined;

  async function saveNote() {
    if (await reports.submitNote(noteText)) {
      setNoteText("");
      setNoteOpen(false);
      setDone("note");
    }
  }

  async function sendBlocker(blocker: RoomBlocker, time?: string) {
    if (await reports.submitBlocker(blocker, time)) {
      setTimeKey(null);
      setTimeText("");
      setDone(blocker.key);
    }
  }

  return (
    <BottomSheet visible={visible} title={t("rooms.work.more.title", { room: room.room_number })} onClose={onClose} testID="report-more-sheet">
      {done ? (
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.saved, { color: theme.status.ready }]} testID="report-saved">
          {done === "note" ? t("rooms.detailActions.noteSaved") : t("rooms.work.more.reported")}
        </Text>
      ) : null}

      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.textMuted }]}>
        {t("rooms.detailActions.title")}
      </Text>

      <Row icon="chatbubble-outline" label={t("rooms.detailActions.addNote")} onPress={() => setNoteOpen((open) => !open)} tint={theme.status.clean} selected={noteOpen} testID="more-note" />
      {noteOpen ? (
        <View style={[styles.form, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <TextInput
            style={[styles.input, { color: theme.textPrimary }]}
            value={noteText}
            onChangeText={setNoteText}
            placeholder={t("rooms.detailActions.notePlaceholder")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("rooms.detailActions.addNote")}
            multiline
            numberOfLines={3}
            autoFocus
            testID="more-note-input"
          />
          <View style={[styles.formActions, { borderTopColor: theme.borderSubtle }]}>
            <Button
              label={t("rooms.detailActions.saveNote")}
              icon="send"
              onPress={() => void saveNote()}
              loading={reports.noteLoading}
              disabled={!noteText.trim() || busy}
              size="sm"
              testID="more-note-save"
            />
            <Button label={t("rooms.detailActions.cancel")} onPress={() => setNoteOpen(false)} variant="ghost" size="sm" />
          </View>
        </View>
      ) : null}

      <Row icon="build-outline" label={t("rooms.detailActions.workOrder")} onPress={() => onOpenTarget("issue")} tint={theme.accentBrass} testID="more-issue" />
      <Row icon="bag-outline" label={t("rooms.detailActions.lostFound")} onPress={() => onOpenTarget("found")} tint={theme.status.pickup} testID="more-found" />
      <Row icon="cube-outline" label={t("rooms.detailActions.supplies")} onPress={() => onOpenTarget("supplies")} tint={theme.primaryAction} testID="more-supplies" />

      {showDnd ? (
        <Row
          icon={room.dnd_flag ? "close-circle-outline" : "hand-left-outline"}
          label={room.dnd_flag ? t("rooms.detailActions.clearDnd") : t("rooms.detailActions.skipDnd")}
          onPress={() => void reports.toggleDnd()}
          tint={room.dnd_flag ? theme.status.dirty : theme.textMuted}
          busy={reports.dndLoading}
          selected={room.dnd_flag}
          testID="more-dnd"
        />
      ) : null}
      {showDecline ? (
        <Row
          icon={room.do_not_service ? "refresh-outline" : "close-outline"}
          label={room.do_not_service ? t("rooms.detailActions.restoreService") : t("rooms.detailActions.declineService")}
          onPress={() => void reports.toggleDeclineService()}
          tint={room.do_not_service ? theme.status.dirty : theme.textMuted}
          busy={reports.declineLoading}
          selected={room.do_not_service}
          testID="more-decline"
        />
      ) : null}

      {blockers.length > 0 ? (
        <>
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.textMuted }]}>
            {blockersTitle}
          </Text>
          {blockers.map((blocker) => (
            <Row
              key={blocker.key}
              icon="alert-circle-outline"
              label={t(blocker.labelKey)}
              onPress={() => {
                if (blocker.needsTime) {
                  setTimeKey(timeKey === blocker.key ? null : blocker.key);
                  setTimeText("");
                  return;
                }
                void sendBlocker(blocker);
              }}
              tint={theme.status.pickup}
              busy={reports.blockerBusy === blocker.key}
              disabled={busy && reports.blockerBusy !== blocker.key}
              selected={timeKey === blocker.key}
              testID={`more-blocker-${blocker.key}`}
            />
          ))}
        </>
      ) : null}

      {activeBlocker ? (
        <View style={[styles.form, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} testID="more-time-entry">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.timeLabel, { color: theme.textSecondary }]}>
            {t("blockers.timePrompt")}
          </Text>
          <View style={styles.chips}>
            {(activeBlocker.timePresets ?? []).map((preset) => (
              <Pressable
                key={preset}
                onPress={() => setTimeText(preset)}
                accessibilityRole="button"
                accessibilityLabel={preset}
                accessibilityState={{ selected: timeText === preset }}
                style={[styles.chip, { backgroundColor: timeText === preset ? theme.primarySoft : theme.surface, borderColor: timeText === preset ? theme.primaryLine : theme.border }]}
              >
                <Text style={[styles.chipText, { color: timeText === preset ? theme.primaryAction : theme.textSecondary }]}>{preset}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.timeInput, { borderColor: theme.border, backgroundColor: theme.surface, color: theme.textPrimary }]}
            value={timeText}
            onChangeText={setTimeText}
            onEndEditing={() => setTimeText(formatBlockerTimeInput(timeText))}
            placeholder={t("blockers.timePlaceholder")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("blockers.timePrompt")}
            testID="more-time-input"
          />
          <Button
            label={t("blockers.report")}
            onPress={() => void sendBlocker(activeBlocker, timeText)}
            loading={reports.blockerBusy === activeBlocker.key}
            disabled={!timeText.trim() || busy}
            size="md"
            testID="more-time-submit"
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 4 },
  saved: { fontSize: 14, fontWeight: "800" },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  dim: { opacity: 0.5 },
  form: { borderWidth: 1, borderRadius: 14, overflow: "hidden", padding: 12, gap: 10 },
  input: { minHeight: 72, fontSize: 15, textAlignVertical: "top" },
  formActions: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  timeLabel: { fontSize: 13, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  timeInput: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
});
