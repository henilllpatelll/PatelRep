import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { formatBlockerTimeInput } from "@/lib/housekeeping/roomBlockers";
import {
  EMPTY_EXCEPTION_DRAFT,
  EXCEPTION_NOTE_MAX,
  EXCEPTION_REASONS,
  isExceptionDirty,
  planException,
  returnTimePresets,
  type ExceptionDraft,
  type ExceptionError,
  type ExceptionPlan,
  type ExceptionReason,
} from "@/lib/housekeeping/serviceException";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";
import { Chip, FieldError, FieldLabel, RadioOption, StatusText, TextArea } from "./FormBits";

interface Props {
  visible: boolean;
  room: Room;
  isOnline: boolean;
  timeZone: string | null;
  /** True while a server write for this room is in flight. */
  busy: boolean;
  /** Persist the plan; resolves true only when the server confirmed it. */
  onSubmit: (plan: ExceptionPlan) => Promise<boolean>;
  /** Server-backed "guest answered / clear DND" for a room that is currently on DND. */
  onClearDnd: () => Promise<void>;
  /** Server-backed "restore service" for a room whose service is currently declined. */
  onRestoreService: () => Promise<void>;
  onClose: () => void;
}

/**
 * Can't enter / service exception. Everything here happens BEFORE entry, so it
 * records to the service-attempt log (or Service Declined) and nothing else:
 * no clean session is created and the room's status does not move.
 */
export function ServiceExceptionSheet({ visible, room, isOnline, timeZone, busy, onSubmit, onClearDnd, onRestoreService, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState<ExceptionDraft>(EMPTY_EXCEPTION_DRAFT);
  const [error, setError] = useState<ExceptionError | null>(null);
  const [saving, setSaving] = useState(false);

  const working = saving || busy;
  const requestClose = useDiscardGuard({
    dirty: isExceptionDirty(draft),
    busy: working,
    onClose,
    onDiscard: () => {
      setDraft(EMPTY_EXCEPTION_DRAFT);
      setError(null);
    },
  });

  function update(patch: Partial<ExceptionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  async function submit() {
    if (working) return;
    const planned = planException(draft, timeZone);
    if (!planned.ok) {
      setError(planned.error);
      return;
    }
    setSaving(true);
    try {
      if (await onSubmit(planned.plan)) {
        setDraft(EMPTY_EXCEPTION_DRAFT);
        setError(null);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  const reason = draft.reason;
  const showTime = reason === "come_back_later";
  const noteRequired = reason === "other";
  const errorText = (field: ExceptionError["field"]): string | null =>
    error?.field === field ? t(`rooms.work.exception.errors.${field}.${error.code}`) : null;

  return (
    <BottomSheet
      visible={visible}
      title={t("rooms.work.exception.title", { room: room.room_number })}
      onClose={requestClose}
      scrollKey={reason ? `${reason}|${error ? `${error.field}.${error.code}` : ""}` : null}
      testID="exception-sheet"
      footer={
        <>
          {!isOnline ? <StatusText tone="warn" message={t("rooms.work.exception.needsConnection")} testID="exception-offline" /> : null}
          <Button
            label={t("rooms.work.exception.submit")}
            onPress={() => void submit()}
            loading={saving}
            disabled={working || !isOnline || !reason}
            size="lg"
            testID="exception-submit"
          />
          <Button label={t("rooms.detailActions.cancel")} onPress={requestClose} variant="secondary" disabled={working} testID="exception-cancel" />
        </>
      }
    >
      {room.dnd_flag || room.do_not_service ? (
        <View style={[styles.current, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.currentText, { color: theme.textPrimary }]}>
            {t(room.dnd_flag ? "rooms.work.exception.currentDnd" : "rooms.work.exception.currentDeclined")}
          </Text>
          <Button
            label={t(room.dnd_flag ? "rooms.work.exception.clearDnd" : "rooms.work.exception.restoreService")}
            onPress={() => void (room.dnd_flag ? onClearDnd() : onRestoreService())}
            variant="secondary"
            size="sm"
            disabled={working || !isOnline}
            testID={room.dnd_flag ? "exception-clear-dnd" : "exception-restore-service"}
          />
        </View>
      ) : null}

      <FieldLabel>{t("rooms.work.exception.question")}</FieldLabel>
      <View accessibilityRole="radiogroup" style={styles.group}>
        {EXCEPTION_REASONS.map((value: ExceptionReason) => (
          <RadioOption
            key={value}
            label={t(`rooms.work.exception.reasons.${value}.label`)}
            hint={t(`rooms.work.exception.reasons.${value}.hint`)}
            selected={reason === value}
            onPress={() => update({ reason: value })}
            disabled={working}
            testID={`exception-reason-${value}`}
          />
        ))}
      </View>
      <FieldError message={errorText("reason")} testID="exception-error-reason" />

      {showTime ? (
        <View style={styles.group} testID="exception-time">
          <FieldLabel required>{t("rooms.work.exception.returnWhen")}</FieldLabel>
          <View style={styles.chips}>
            {returnTimePresets().map((preset) => (
              <Chip key={preset} label={preset} selected={draft.returnText === preset} onPress={() => update({ returnText: preset })} disabled={working} />
            ))}
          </View>
          <TextInput
            value={draft.returnText}
            onChangeText={(returnText) => update({ returnText })}
            onEndEditing={() => update({ returnText: formatBlockerTimeInput(draft.returnText) })}
            placeholder={t("blockers.timePlaceholder")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("rooms.work.exception.returnWhen")}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!working}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[
              styles.timeInput,
              { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: error?.field === "time" ? theme.status.dirty : theme.border },
            ]}
            testID="exception-time-input"
          />
          <StatusText message={t("rooms.work.exception.hotelTime")} />
          <FieldError message={errorText("time")} testID="exception-error-time" />
        </View>
      ) : null}

      {reason && reason !== "guest_declined" ? (
        <View style={styles.group}>
          <FieldLabel required={noteRequired}>
            {t(noteRequired ? "rooms.work.exception.noteRequired" : "rooms.work.exception.noteOptional")}
          </FieldLabel>
          <TextArea
            label={t("rooms.work.exception.noteLabel")}
            value={draft.note}
            onChangeText={(note) => update({ note })}
            max={EXCEPTION_NOTE_MAX}
            placeholder={t("rooms.work.exception.notePlaceholder")}
            editable={!working}
            invalid={error?.field === "note"}
            testID="exception-note"
          />
          <FieldError message={errorText("note")} testID="exception-error-note" />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  current: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 10 },
  currentText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeInput: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
});
