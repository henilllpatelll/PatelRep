import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { createWorkOrder } from "@/lib/api/workOrders";
import { C, R, monoFont } from "@/components/shared/tokens";

const CATEGORIES = [
  { key: "plumbing", label: "Plumbing" },
  { key: "electrical", label: "Electrical" },
  { key: "hvac", label: "HVAC" },
  { key: "furniture", label: "Furniture" },
  { key: "appliance", label: "Appliance" },
  { key: "structural", label: "Structural" },
  { key: "safety", label: "Safety" },
  { key: "doors_locks", label: "Doors & Locks" },
  { key: "painting", label: "Painting" },
  { key: "general", label: "General" },
] as const;

const PRIORITIES = [
  { key: "emergency" as const, label: "Emergency", color: "#CC0000" },
  { key: "urgent" as const, label: "Urgent", color: C.alert },
  { key: "normal" as const, label: "Normal", color: C.accent },
  { key: "low" as const, label: "Low", color: C.ink3 },
];

const SOURCES: { key: "guest" | "staff_patrol" | "pm" | "self"; label: string }[] = [
  { key: "guest", label: "Guest Report" },
  { key: "staff_patrol", label: "Staff Patrol" },
  { key: "pm", label: "PM Trigger" },
  { key: "self", label: "Internal" },
];

interface Props {
  visible: boolean;
  roomId?: string | null;
  roomNumber?: string | null;
  onClose: () => void;
  onCreated?: () => void;
}

export default function CreateWorkOrderModal({ visible, roomId, roomNumber, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState<"urgent" | "normal" | "low" | "emergency">("normal");
  const [source, setSource] = useState<"guest" | "staff_patrol" | "pm" | "self">("self");
  const [loading, setLoading] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setLocation("");
    setCategory("general");
    setPriority("normal");
    setSource("self");
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setLoading(true);
    try {
      await createWorkOrder({
        ...(roomId ? { room_id: roomId } : {}),
        title: trimmedTitle,
        description: description.trim() || undefined,
        category,
        priority,
        location_text: location.trim() || undefined,
        source,
      });
      reset();
      onCreated?.();
      const body = roomNumber ? `Submitted for room ${roomNumber}.` : "Work order submitted.";
      Alert.alert("Work Order Created", body, [{ text: "OK", onPress: onClose }]);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to create work order");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} activeOpacity={1}>
          <View style={styles.titleRow}>
            <Ionicons name="construct-outline" size={16} color={C.accent} />
            <Text style={styles.title}>New Work Order</Text>
            {roomNumber ? (
              <View style={styles.roomBadge}>
                <Text style={styles.roomBadgeText}>{roomNumber}</Text>
              </View>
            ) : null}
          </View>

          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What needs to be fixed?"
            placeholderTextColor={C.ink3}
            autoFocus
          />

          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={description}
            onChangeText={setDescription}
            placeholder="Details (optional)"
            placeholderTextColor={C.ink3}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          {!roomId ? (
            <>
              <Text style={styles.sectionLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Room number or area (e.g. 204, Lobby HVAC)"
                placeholderTextColor={C.ink3}
              />
            </>
          ) : null}

          <Text style={styles.sectionLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(cat.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => {
              const active = priority === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.priorityBtn,
                    active && { borderColor: p.color, backgroundColor: p.color + "1A" },
                  ]}
                  onPress={() => setPriority(p.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.priorityText, active && { color: p.color, fontWeight: "800" }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Reported By</Text>
          <View style={styles.sourceRow}>
            {SOURCES.map((s) => {
              const active = source === s.key;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.sourceBtn, active && styles.sourceBtnActive]}
                  onPress={() => setSource(s.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sourceText, active && styles.sourceTextActive]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.submitBtn, (!title.trim() || loading) && styles.submitBtnDisabled]}
              onPress={submit}
              disabled={!title.trim() || loading}
              activeOpacity={0.86}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="construct-outline" size={14} color="#fff" />
                  <Text style={styles.submitText}>Create Work Order</Text>
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
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900", color: C.ink, flex: 1 },
  roomBadge: {
    backgroundColor: C.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.accentLine,
  },
  roomBadgeText: { fontFamily: monoFont, fontSize: 13, fontWeight: "700", color: C.accent },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
    color: C.ink,
  },
  inputMulti: { minHeight: 60 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: C.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: -4,
  },
  chipRow: { gap: 7, paddingVertical: 2 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  chipText: { fontSize: 12, fontWeight: "700", color: C.ink3 },
  chipTextActive: { color: C.accent },
  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
  },
  priorityText: { fontSize: 13, fontWeight: "700", color: C.ink3 },
  sourceRow: { flexDirection: "row", gap: 6 },
  sourceBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
    paddingHorizontal: 4,
  },
  sourceBtnActive: { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  sourceText: { fontSize: 11, fontWeight: "700", color: C.ink3, textAlign: "center" },
  sourceTextActive: { color: C.accent },
  actions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.accent,
    borderRadius: 12,
    minHeight: 50,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  cancelText: { fontSize: 13, color: C.ink3, fontWeight: "700" },
});
