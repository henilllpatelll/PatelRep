import { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ShiftNoteModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await api.post("/logbook", {
        entry_type: "shift_note",
        content: text.trim(),
        is_private: false,
      });
      setText("");
      toast.success("Shift note logged.");
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to save note");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16, backgroundColor: theme.surface }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="book-outline" size={16} color={theme.status.clean} />
            <Text style={[styles.title, { color: theme.textPrimary }]}>{t("supervisorTools.shiftNoteTitle")}</Text>
          </View>
          <Text style={[styles.sub, { color: theme.textMuted }]}>{t("supervisorTools.shiftNoteSub")}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
            value={text}
            onChangeText={setText}
            placeholder="e.g. VIP arrival in 201, extra linen requested for floor 3..."
            placeholderTextColor={theme.textMuted}
            multiline
            numberOfLines={4}
            autoFocus
          />
          <View style={styles.actions}>
            <Button
              label="Log Note"
              onPress={submit}
              loading={loading}
              disabled={!text.trim()}
              icon="checkmark-circle-outline"
              style={styles.sendBtn}
            />
            <Button label="Cancel" onPress={onClose} variant="ghost" />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900" },
  sub: { fontSize: 12.5, marginTop: -6 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13.5,
    minHeight: 100,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1 },
});
