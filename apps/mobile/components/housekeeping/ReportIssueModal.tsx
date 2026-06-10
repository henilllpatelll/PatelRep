import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { createWorkOrder, type CreateWorkOrderPayload } from "@/lib/api/workOrders";
import { C, monoFont } from "@/components/shared/tokens";

const CATEGORIES = [
  { value: "appliance",   label: "Appliance" },
  { value: "electrical",  label: "Electrical" },
  { value: "furniture",   label: "Furniture" },
  { value: "general",     label: "General" },
  { value: "hvac",        label: "HVAC / A/C" },
  { value: "plumbing",    label: "Plumbing" },
  { value: "safety",      label: "Safety" },
  { value: "structural",  label: "Structural" },
];

const PRIORITIES: { value: "urgent" | "normal" | "low"; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "normal", label: "Normal" },
  { value: "low",    label: "Low" },
];

interface ReportIssueModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

export default function ReportIssueModal({ visible, roomId, roomNumber, onClose }: ReportIssueModalProps) {
  const isOnline = useAppStore((s) => s.isOnline);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<"urgent" | "normal" | "low">("normal");
  const [description, setDescription] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setTitle("");
      setCategory("");
      setPriority("normal");
      setDescription("");
      setCategoryOpen(false);
      setError(null);
    }
  }, [visible]);

  async function handleSubmit() {
    if (!title.trim() || !category) return;
    setSubmitting(true);
    setError(null);
    const payload: CreateWorkOrderPayload = {
      room_id: roomId,
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      priority,
    };
    try {
      if (isOnline) {
        await createWorkOrder(payload);
      } else {
        await enqueueAction("work_order", "create", payload);
      }
      onClose();
    } catch {
      setError("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Submit Work Order</Text>
            <Text style={styles.subtitle}>Room {roomNumber}</Text>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Issue title */}
            <Text style={styles.label}>Issue title <Text style={styles.required}>*</Text></Text>
            <TextInput
              testID="title-input"
              style={styles.input}
              placeholder="e.g. Toilet not flushing, A/C not cooling"
              placeholderTextColor={C.ink3}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />

            {/* Category */}
            <Text style={[styles.label, { marginTop: 14 }]}>Category <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity
              testID="category-select"
              style={styles.selectRow}
              onPress={() => setCategoryOpen((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.selectValue, !category && styles.selectPlaceholder]}>
                {CATEGORIES.find((c) => c.value === category)?.label ?? "Select a category"}
              </Text>
              <Ionicons
                name={categoryOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={C.ink3}
              />
            </TouchableOpacity>
            {categoryOpen && (
              <View style={styles.dropdownList}>
                {CATEGORIES.map((c, i) => (
                  <TouchableOpacity
                    testID={`category-option-${c.value}`}
                    key={c.value}
                    style={[
                      styles.dropdownItem,
                      i < CATEGORIES.length - 1 && styles.dropdownItemBorder,
                      c.value === category && styles.dropdownItemActive,
                    ]}
                    onPress={() => { setCategory(c.value); setCategoryOpen(false); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dropdownItemText, c.value === category && styles.dropdownItemTextActive]}>
                      {c.label}
                    </Text>
                    {c.value === category && (
                      <Ionicons name="checkmark" size={15} color={C.brass} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Priority */}
            <Text style={[styles.label, { marginTop: 14 }]}>Priority</Text>
            <View style={styles.priorityRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[
                    styles.priorityBtn,
                    priority === p.value && styles.priorityBtnActive,
                    priority === p.value && p.value === "urgent" && { backgroundColor: C.alert, borderColor: C.alert },
                    priority === p.value && p.value === "low" && { backgroundColor: C.info, borderColor: C.info },
                  ]}
                  onPress={() => setPriority(p.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[
                    styles.priorityText,
                    priority === p.value && styles.priorityTextActive,
                  ]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Details */}
            <Text style={[styles.label, { marginTop: 14 }]}>Details <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              testID="description-input"
              style={[styles.input, styles.textarea]}
              placeholder="Describe what you found…"
              placeholderTextColor={C.ink3}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity testID="cancel-button" style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="submit-button"
              style={[styles.submitBtn, (!title.trim() || !category || submitting) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!title.trim() || !category || submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitText}>Submit to Engineering</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  title: { fontSize: 17, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 12, color: C.ink3, marginTop: 2, fontFamily: monoFont },

  body: { paddingHorizontal: 18, paddingTop: 16 },

  label: { fontSize: 12, color: C.ink3, fontWeight: "600", marginBottom: 6 },
  required: { color: C.alert },
  optional: { color: C.ink3, fontWeight: "400" },

  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.ink,
    backgroundColor: C.paper,
  },
  textarea: { minHeight: 72, textAlignVertical: "top" },

  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.paper,
  },
  selectValue: { fontSize: 14, color: C.ink },
  selectPlaceholder: { color: C.ink3 },
  dropdownList: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    backgroundColor: C.surface,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  dropdownItemBorder: { borderBottomWidth: 1, borderBottomColor: C.line2 },
  dropdownItemActive: { backgroundColor: C.brassSoft },
  dropdownItemText: { fontSize: 14, color: C.ink2 },
  dropdownItemTextActive: { color: C.brass, fontWeight: "600" },

  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.paper,
  },
  priorityBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  priorityText: { fontSize: 13, fontWeight: "600", color: C.ink2 },
  priorityTextActive: { color: "#fff" },

  errorText: { fontSize: 12, color: C.alert, marginTop: 8 },

  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.paper,
  },
  cancelText: { fontSize: 14, fontWeight: "600", color: C.ink2 },
  submitBtn: {
    flex: 2,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.accent,
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});
