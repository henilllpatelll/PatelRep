import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { useTextDraft } from "@/lib/engineering/useWorkOrderDrafts";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  wo: Pick<WorkOrder, "id" | "status" | "priority">;
  /** Moves the order to `escalated` through the transition endpoint; the note is stored on the audit event. */
  onConfirm: (note: string) => Promise<void>;
}

/**
 * Escalation is a status (`escalated`), not a priority change. The API takes no structured reason for it, so
 * the note is the only record of why — required here so a handover is never blank.
 */
export function EscalationSheet({ visible, onClose, online, wo, onConfirm }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { text: note, setText: setNote, clear, saved } = useTextDraft(wo.id, "escalate");
  const { busy, error, run } = useSheetSubmit();
  const trimmed = note.trim();

  async function confirm() {
    if (!trimmed) return;
    const ok = await run(() => onConfirm(trimmed));
    if (ok) {
      clear();
      onClose();
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.escalate.title")}
      onClose={onClose}
      testID="wo-escalate-sheet"
      footer={<Button label={t("workOrders.repair.escalate.confirm")} variant="destructive" onPress={confirm} loading={busy} disabled={!online || !trimmed || busy} size="lg" testID="wo-escalate-confirm" />}
    >
      <View style={sheetStyles.stack}>
        <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}>
          {t("workOrders.repair.escalate.explain", { priority: t(`workOrders.repair.priority.${wo.priority}`) })}
        </Text>
        <FieldLabel required>{t("workOrders.repair.escalate.reason")}</FieldLabel>
        <TextArea value={note} onChangeText={setNote} placeholder={t("workOrders.repair.escalate.placeholder")} editable={!busy} testID="wo-escalate-note" accessibilityLabel={t("workOrders.repair.escalate.reason")} />
        {!online ? <Note>{t("workOrders.repair.needsConnection")}</Note> : null}
        {saved && note.trim() ? <Note>{t("workOrders.repair.draftSaved")}</Note> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}
