import { useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { C } from "@/components/shared/tokens";

const SUPPLY_ITEMS = [
  { key: "towels", label: "Extra towels" },
  { key: "pillowcases", label: "Pillowcases / sheets" },
  { key: "toiletries", label: "Toiletries (shampoo, soap)" },
  { key: "trash_bags", label: "Trash bags" },
  { key: "amenities", label: "Amenities kit" },
] as const;

interface Props {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

export default function SupplyRequestModal({ visible, roomId, roomNumber, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customNote, setCustomNote] = useState("");
  const [loading, setLoading] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reset() {
    setSelected(new Set());
    setCustomNote("");
  }

  async function submit() {
    const items = SUPPLY_ITEMS.filter((item) => selected.has(item.key)).map((item) => item.label);
    const allItems = customNote.trim() ? [...items, customNote.trim()] : items;
    if (allItems.length === 0) {
      Alert.alert("Nothing selected", "Pick at least one item to request.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/tasks", {
        title: `Supply request — Room ${roomNumber}`,
        description: `Room ${roomNumber} needs: ${allItems.join(", ")}.`,
        task_type: "housekeeping",
        priority: "normal",
        room_id: roomId,
      });
      Alert.alert("Requested", "Your supervisor has been notified.", [
        { text: "OK", onPress: () => { reset(); onClose(); } },
      ]);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to send request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="cube-outline" size={16} color={C.accent} />
            <Text style={styles.title}>Request Supplies</Text>
          </View>
          <Text style={styles.sub}>Room {roomNumber} — tap what you need</Text>
          <View style={styles.items}>
            {SUPPLY_ITEMS.map((item) => {
              const active = selected.has(item.key);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.item, active && styles.itemActive]}
                  onPress={() => toggle(item.key)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.check, active && styles.checkActive]}>
                    {active ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={styles.customInput}
            value={customNote}
            onChangeText={setCustomNote}
            placeholder="Other (e.g. extra pillow, folding cot...)"
            placeholderTextColor={C.ink3}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.sendBtn, (loading || (selected.size === 0 && !customNote.trim())) && styles.sendBtnDisabled]}
              onPress={submit}
              disabled={loading || (selected.size === 0 && !customNote.trim())}
              activeOpacity={0.86}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="send" size={13} color="#fff" />
                  <Text style={styles.sendText}>Send Request</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
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
  items: { gap: 8 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  itemActive: { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  checkActive: { backgroundColor: C.accent, borderColor: C.accent },
  itemLabel: { fontSize: 14, fontWeight: "600", color: C.ink2 },
  itemLabelActive: { color: C.accent, fontWeight: "700" },
  customInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
    color: C.ink,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.accent, borderRadius: 12, minHeight: 50 },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  cancelText: { fontSize: 13, color: C.ink3, fontWeight: "700" },
});
