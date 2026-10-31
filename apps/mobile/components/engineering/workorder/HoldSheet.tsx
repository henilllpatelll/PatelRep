import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { HOLD_REASON_CODES, type HoldReasonCode } from "@/lib/engineering/workOrders";
import { ChoiceChips, FieldLabel, InlineError, Note, TextArea, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  label: string | null;
  /** The viewer has a running labor timer on this order. Holding does not stop it on the server, so we offer to. */
  laborRunning: boolean;
  onConfirm: (input: { reason: HoldReasonCode; note: string; pauseLabor: boolean }) => Promise<void>;
}

/** The API requires one of four structured reasons to hold an order; it is chosen, never guessed. */
export function HoldSheet({ visible, onClose, online, label, laborRunning, onConfirm }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [reason, setReason] = useState<HoldReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [pauseLabor, setPauseLabor] = useState(true);
  const { busy, error, run } = useSheetSubmit();

  async function confirm() {
    if (!reason) return;
    const ok = await run(() => onConfirm({ reason, note: note.trim(), pauseLabor: laborRunning && pauseLabor }));
    if (ok) {
      setReason(null);
      setNote("");
      onClose();
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.hold.title")}
      onClose={onClose}
      testID="hold-reason-sheet"
      footer={<Button label={t("workOrders.repair.hold.confirm")} onPress={confirm} loading={busy} disabled={!online || !reason || busy} size="lg" testID="wo-hold-confirm" />}
    >
      <View style={sheetStyles.stack}>
        {label ? <Text style={{ color: theme.textMuted, fontSize: 13, fontWeight: "700" }}>{label}</Text> : null}
        <FieldLabel required>{t("workOrders.repair.hold.reason")}</FieldLabel>
        <ChoiceChips
          options={HOLD_REASON_CODES.map((code) => ({ value: code, label: t(`workOrders.holdReason.${code}`) }))}
          value={reason}
          onChange={setReason}
          testIDPrefix="hold-reason"
          disabled={busy}
        />
        <FieldLabel>{t("workOrders.repair.hold.note")}</FieldLabel>
        <TextArea value={note} onChangeText={setNote} editable={!busy} testID="wo-hold-note" accessibilityLabel={t("workOrders.repair.hold.note")} />
        {laborRunning ? (
          <Pressable
            onPress={() => setPauseLabor((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: pauseLabor }}
            accessibilityLabel={t("workOrders.repair.hold.pauseLabor")}
            style={sheetStyles.row}
            testID="wo-hold-pause-labor"
          >
            <Ionicons name={pauseLabor ? "checkbox" : "square-outline"} size={24} color={theme.primaryAction} />
            <Text style={{ flex: 1, color: theme.textPrimary, fontSize: 14 }}>{t("workOrders.repair.hold.pauseLabor")}</Text>
          </Pressable>
        ) : null}
        {!online ? <Note>{t("workOrders.repair.needsConnection")}</Note> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}
