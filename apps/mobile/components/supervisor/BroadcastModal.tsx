import { useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { C } from "@/components/shared/tokens";

const QUICK_MESSAGES = [
  "Break time — 15 minutes",
  "Shift ending in 30 minutes — wrap up your current room",
  "Please check your room assignments for updates",
  "VIP guest on floor — extra care please",
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function BroadcastModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setLoading(true);
    try {
      await api.post("/tasks", {
        title: `📢 Supervisor: ${text.slice(0, 60)}`,
        description: text,
        task_type: "housekeeping",
        priority: "normal",
        broadcast: true,
      });
      setMessage("");
      Alert.alert("Sent", "Message queued for all housekeeping staff.", [{ text: "OK", onPress: onClose }]);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to send broadcast");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="megaphone-outline" size={16} color={C.caution} />
            <Text style={styles.title}>Message Team</Text>
          </View>
          <Text style={styles.sub}>Sends to all housekeeping staff on shift</Text>
          <View style={styles.quickRow}>
            {QUICK_MESSAGES.map((msg) => (
              <TouchableOpacity
                key={msg}
                style={[styles.quickChip, message === msg && styles.quickChipActive]}
                onPress={() => setMessage(msg)}
                activeOpacity={0.8}
              >
                <Text style={[styles.quickText, message === msg && styles.quickTextActive]} numberOfLines={2}>{msg}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Or type a custom message..."
            placeholderTextColor={C.ink3}
            multiline
            numberOfLines={3}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.sendBtn, (!message.trim() || loading) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!message.trim() || loading}
              activeOpacity={0.86}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="megaphone-outline" size={14} color="#fff" />
                  <Text style={styles.sendText}>Send</Text>
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
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900", color: C.ink },
  sub: { fontSize: 12.5, color: C.ink3, marginTop: -4 },
  quickRow: { gap: 7 },
  quickChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quickChipActive: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  quickText: { fontSize: 13, fontWeight: "600", color: C.ink2 },
  quickTextActive: { color: C.caution, fontWeight: "700" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
    color: C.ink,
    minHeight: 72,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.caution, borderRadius: 12, minHeight: 50 },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  cancelText: { fontSize: 13, color: C.ink3, fontWeight: "700" },
});
