import { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

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
  const theme = useTheme();
  const toast = useToast();
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
      toast.success("Message queued for all housekeeping staff.");
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to send broadcast");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16, backgroundColor: theme.surface }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="megaphone-outline" size={16} color={theme.status.pickup} />
            <Text style={[styles.title, { color: theme.textPrimary }]}>Message Team</Text>
          </View>
          <Text style={[styles.sub, { color: theme.textMuted }]}>Sends to all housekeeping staff on shift</Text>
          <View style={styles.quickRow}>
            {QUICK_MESSAGES.map((msg) => (
              <TouchableOpacity
                key={msg}
                style={[
                  styles.quickChip,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                  message === msg && { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
                ]}
                onPress={() => setMessage(msg)}
                activeOpacity={0.8}
              >
                <Text style={[styles.quickText, { color: theme.textSecondary }, message === msg && { color: theme.status.pickup, fontWeight: "700" }]} numberOfLines={2}>{msg}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Or type a custom message..."
            placeholderTextColor={theme.textMuted}
            multiline
            numberOfLines={3}
          />
          <View style={styles.actions}>
            <Button
              label="Send"
              onPress={send}
              loading={loading}
              disabled={!message.trim()}
              icon="megaphone-outline"
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
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900" },
  sub: { fontSize: 12.5, marginTop: -4 },
  quickRow: { gap: 7 },
  quickChip: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quickText: { fontSize: 13, fontWeight: "600" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
    minHeight: 72,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1 },
});
