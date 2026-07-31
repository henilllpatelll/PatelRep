import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { createWorkOrder, type CreateWorkOrderPayload } from "@/lib/api/workOrders";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";

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
  const { t } = useTranslation();
  const isOnline = useAppStore((s) => s.isOnline);
  const theme = useTheme();
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
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>{t("reportIssue.submit")}</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("reportIssue.roomLabel", { room: roomNumber })}</Text>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Issue title */}
            <Text style={[styles.label, { color: theme.textMuted }]}>
              {t("reportIssue.issueTitle")} <Text style={{ color: theme.status.dirty }}>*</Text>
            </Text>
            <TextInput
              testID="title-input"
              style={[styles.input, { borderColor: theme.border, color: theme.textPrimary, backgroundColor: theme.background }]}
              placeholder={t("reportIssue.titlePlaceholder")}
              placeholderTextColor={theme.textMuted}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />

            {/* Category */}
            <Text style={[styles.label, { color: theme.textMuted, marginTop: 14 }]}>
              {t("reportIssue.category")} <Text style={{ color: theme.status.dirty }}>*</Text>
            </Text>
            <TouchableOpacity
              testID="category-select"
              style={[styles.selectRow, { borderColor: theme.border, backgroundColor: theme.background }]}
              onPress={() => setCategoryOpen((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t("reportIssue.category")}
              accessibilityState={{ expanded: categoryOpen }}
            >
              <Text style={[styles.selectValue, { color: category ? theme.textPrimary : theme.textMuted }]}>
                {CATEGORIES.find((c) => c.value === category)?.label ?? "Select a category"}
              </Text>
              <Ionicons
                name={categoryOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.textMuted}
              />
            </TouchableOpacity>
            {categoryOpen && (
              <View style={[styles.dropdownList, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                {CATEGORIES.map((c, i) => (
                  <TouchableOpacity
                    testID={`category-option-${c.value}`}
                    key={c.value}
                    style={[
                      styles.dropdownItem,
                      i < CATEGORIES.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.borderSubtle },
                      c.value === category && { backgroundColor: theme.accentBrassSoft },
                    ]}
                    onPress={() => { setCategory(c.value); setCategoryOpen(false); }}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityLabel={c.label}
                    accessibilityState={{ selected: c.value === category }}
                  >
                    <Text style={[
                      styles.dropdownItemText,
                      { color: c.value === category ? theme.accentBrass : theme.textSecondary },
                      c.value === category && styles.dropdownItemTextActive,
                    ]}>
                      {c.label}
                    </Text>
                    {c.value === category && (
                      <Ionicons name="checkmark" size={15} color={theme.accentBrass} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Priority */}
            <Text style={[styles.label, { color: theme.textMuted, marginTop: 14 }]}>{t("reportIssue.priority")}</Text>
            <View style={styles.priorityRow}>
              {PRIORITIES.map((p) => {
                const isActive = priority === p.value;
                let activeBg: string | undefined;
                let activeFg: string | undefined;
                if (isActive) {
                  if (p.value === "urgent") {
                    activeBg = theme.status.dirty;
                    activeFg = theme.onDestructive;
                  } else if (p.value === "low") {
                    activeBg = theme.status.clean;
                    activeFg = theme.onPrimary;
                  } else {
                    activeBg = theme.primaryAction;
                    activeFg = theme.onPrimary;
                  }
                }
                return (
                  <TouchableOpacity
                    key={p.value}
                    style={[
                      styles.priorityBtn,
                      { borderColor: isActive ? activeBg : theme.border, backgroundColor: isActive ? activeBg : theme.background },
                    ]}
                    onPress={() => setPriority(p.value)}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityLabel={p.label}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[
                      styles.priorityText,
                      { color: isActive ? activeFg : theme.textSecondary },
                    ]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Details */}
            <Text style={[styles.label, { color: theme.textMuted, marginTop: 14 }]}>
              {t("reportIssue.details")} <Text style={{ color: theme.textMuted, fontWeight: "400" }}>{t("reportIssue.optional")}</Text>
            </Text>
            <TextInput
              testID="description-input"
              style={[styles.input, styles.textarea, { borderColor: theme.border, color: theme.textPrimary, backgroundColor: theme.background }]}
              placeholder={t("reportIssue.detailsPlaceholder")}
              placeholderTextColor={theme.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {error ? <Text style={[styles.errorText, { color: theme.status.dirty }]}>{error}</Text> : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Button
              label="Cancel"
              onPress={onClose}
              variant="secondary"
              style={styles.cancelBtn}
            />
            <Button
              testID="submit-button"
              label="Submit to Engineering"
              onPress={handleSubmit}
              variant="primary"
              loading={submitting}
              disabled={!title.trim() || !category || submitting}
              style={styles.submitBtn}
            />
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2, fontFamily: monoFont },

  body: { paddingHorizontal: 18, paddingTop: 16 },

  label: { fontSize: 12, fontWeight: "600", marginBottom: 6 },

  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textarea: { minHeight: 72, textAlignVertical: "top" },

  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  selectValue: { fontSize: 14 },
  dropdownList: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 44,
  },
  dropdownItemText: { fontSize: 14 },
  dropdownItemTextActive: { fontWeight: "600" },

  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  priorityText: { fontSize: 13, fontWeight: "600" },

  errorText: { fontSize: 12, marginTop: 8 },

  footer: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
  },
  submitBtn: {
    flex: 2,
    borderRadius: 12,
  },
});
