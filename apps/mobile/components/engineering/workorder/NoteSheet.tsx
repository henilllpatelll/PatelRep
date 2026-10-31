import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  /** Posts to the existing comments table; resolves when the server has stored it. */
  onSave: (text: string) => Promise<void>;
}

/** Add Note. The text stays in the box if the send fails or the sheet is dismissed; it clears only after the server stored it. */
export function NoteSheet({ visible, onClose, online, onSave }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const { busy, error, run } = useSheetSubmit();
  const trimmed = text.trim();

  async function save() {
    if (!trimmed) return;
    const ok = await run(() => onSave(trimmed));
    if (ok) {
      setText("");
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
        {error ? <InlineError>{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}
