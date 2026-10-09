import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { CompletionState } from "@/lib/housekeeping/roomDetailState";
import { elapsedSeconds } from "@/lib/housekeeping/cleaningTimer";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  visible: boolean;
  roomNumber: string;
  reclean: boolean;
  completion: CompletionState | null;
  startedAt: string | null | undefined;
  /** "Departure" etc., already translated; null when the room has no clean type. */
  cleanType?: string | null;
  /** The finish request is in flight. */
  busy: boolean;
  /** Last attempt ended without an answer from the server. */
  unsure: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}

/**
 * Last look before submitting. It only restates what the checklist already says —
 * the server re-validates the required items regardless. The time shown is time on
 * the room so far (a courtesy); the recorded duration is calculated by the server.
 */
export function CompleteCleaningSheet({ visible, roomNumber, reclean, completion, startedAt, cleanType, busy, unsure, onConfirm, onKeep }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const seconds = elapsedSeconds(startedAt, Date.now());
  const minutes = seconds === null ? null : Math.max(1, Math.round(seconds / 60));
  const ready = Boolean(completion?.checklistComplete);

  return (
    <BottomSheet
      visible={visible}
      title={t(reclean ? "rooms.work.complete.titleReclean" : "rooms.work.complete.title", { room: roomNumber })}
      onClose={busy ? () => undefined : onKeep}
      testID="complete-sheet"
      footer={
        <>
          <Button
            label={t(reclean ? "rooms.work.complete.submitReclean" : "rooms.work.complete.submit")}
            onPress={onConfirm}
            loading={busy}
            disabled={!ready || busy}
            size="lg"
            testID="complete-confirm"
          />
          <Button label={t("rooms.work.complete.keep")} onPress={onKeep} variant="secondary" disabled={busy} testID="complete-keep" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t(reclean ? "rooms.work.complete.bodyReclean" : "rooms.work.complete.body")}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
        <View style={styles.row} accessible accessibilityLabel={`${t("rooms.work.complete.checklist")}: ${ready ? t("rooms.work.complete.allDone") : t("rooms.work.complete.open", { count: completion?.requiredRemaining ?? 0 })}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
            {t("rooms.work.complete.checklist")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: ready ? theme.status.ready : theme.status.dirty }]}>
            {ready ? t("rooms.work.complete.allDone") : t("rooms.work.complete.open", { count: completion?.requiredRemaining ?? 0 })}
          </Text>
        </View>
        {cleanType ? (
          <View style={styles.row} accessible accessibilityLabel={`${t("rooms.work.complete.cleanType")}: ${cleanType}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
              {t("rooms.work.complete.cleanType")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
              {cleanType}
            </Text>
          </View>
        ) : null}
        {minutes !== null ? (
          <View style={styles.row} accessible accessibilityLabel={`${t("rooms.work.complete.timeOnRoom")}: ${t("rooms.work.submitted.minutes", { minutes })}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
              {t("rooms.work.complete.timeOnRoom")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
              {t("rooms.work.submitted.minutes", { minutes })}
            </Text>
          </View>
        ) : null}
      </View>
      {unsure ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.unsure, { color: theme.status.pickup }]}>
          {t("rooms.work.complete.unsure")}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 14, fontWeight: "700" },
  value: { flexShrink: 1, fontSize: 15, fontWeight: "800", textAlign: "right" },
  unsure: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
