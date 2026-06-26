import { useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { C } from "@/components/shared/tokens";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ShiftNoteModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
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
      Alert.alert("Saved", "Shift note logged.", [{ text: "OK", onPress: onClose }]);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to save note");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="book-outline" size={16} color={C.info} />
            <Text style={styles.title}>Shift Note</Text>
          </View>
          <Text style={styles.sub}>Logged to the shift logbook — visible to all supervisors</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. VIP arrival in 201, extra linen requested for floor 3..."
            placeholderTextColor={C.ink3}
            multiline
            numberOfLines={4}
            autoFocus
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || loading) && styles.sendBtnDisabled]}
              onPress={submit}
              disabled={!text.trim() || loading}
              activeOpacity={0.86}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
                  <Text style={styles.sendText}>Log Note</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900", color: C.ink },
  sub: { fontSize: 12.5, color: C.ink3, marginTop: -6 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13.5,
    color: C.ink,
    minHeight: 100,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.info, borderRadius: 12, minHeight: 50 },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  cancelText: { fontSize: 13, color: C.ink3, fontWeight: "700" },
});
