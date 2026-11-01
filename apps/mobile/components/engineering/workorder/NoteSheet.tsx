import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTextDraft } from "@/lib/engineering/useWorkOrderDrafts";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  /** The work order the note is for; the unsent text is kept on this phone under it. */
  workOrderId?: string;
  /** Posts to the existing comments table; resolves when the server has stored it. */
  onSave: (text: string) => Promise<void>;
}

/** Add Note. The text stays in the box if the send fails or the sheet is dismissed; it clears only after the server stored it. */
export function NoteSheet({ visible, onClose, online, workOrderId, onSave }: Props) {
  const { t } = useTranslation();
  const { text, setText, clear, saved } = useTextDraft(workOrderId, "note");
  const { busy, error, run } = useSheetSubmit();
  const trimmed = text.trim();

  async function save() {
    if (!trimmed) return;
    const ok = await run(() => onSave(trimmed));
    if (ok) {
      clear();
      onClose();
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.note.title")}
      onClose={onClose}
      testID="wo-note-sheet"
      footer={<Button label={t("workOrders.repair.note.save")} onPress={save} loading={busy} disabled={!online || !trimmed || busy} size="lg" testID="wo-note-save" />}
    >
      <View style={sheetStyles.stack}>
        <FieldLabel>{t("workOrders.repair.note.label")}</FieldLabel>
        <TextArea value={text} onChangeText={setText} placeholder={t("workOrders.commentPlaceholder")} editable={!busy} testID="wo-comment-input" accessibilityLabel={t("workOrders.repair.note.label")} />
        {!online ? <Note>{t("workOrders.repair.needsConnection")}</Note> : null}
        {saved && text.trim() ? <Note>{t("workOrders.repair.draftSaved")}</Note> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}
