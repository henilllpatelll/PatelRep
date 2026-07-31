import { useState } from "react";
import {
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
import { useTranslation } from "react-i18next";
import { createWorkOrder } from "@/lib/api/workOrders";
import { monoFont, R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

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

/** Priority color is resolved from `theme.*` at render time (see PRIORITY_COLOR
 * below) rather than baked into this list, so it stays theme-reactive. */
const PRIORITIES: { key: "emergency" | "urgent" | "normal" | "low"; label: string }[] = [
  { key: "emergency", label: "Emergency" },
  { key: "urgent", label: "Urgent" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState<"urgent" | "normal" | "low" | "emergency">("normal");
  const [source, setSource] = useState<"guest" | "staff_patrol" | "pm" | "self">("self");
  const [loading, setLoading] = useState(false);

  // Emergency keeps its own distinct hardcoded red (pre-existing, not a status
  // token) — the other three route through theme per the migration map.
  function priorityColor(key: "emergency" | "urgent" | "normal" | "low"): string {
    if (key === "emergency") return "#CC0000";
    if (key === "urgent") return theme.status.dirty;
    if (key === "low") return theme.textMuted;
    return theme.primaryAction;
  }

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
      toast.success(body);
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to create work order");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }]}
          activeOpacity={1}
        >
          <View style={styles.titleRow}>
            <Ionicons name="construct-outline" size={16} color={theme.primaryAction} />
            <Text style={[styles.title, { color: theme.textPrimary }]}>{t("workOrders.newWorkOrder")}</Text>
            {roomNumber ? (
              <View style={[styles.roomBadge, { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine }]}>
                <Text style={[styles.roomBadgeText, { color: theme.primaryAction }]}>{roomNumber}</Text>
              </View>
            ) : null}
          </View>

          <TextInput
            style={[styles.input, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary }]}
            value={title}
            onChangeText={setTitle}
            placeholder={t("workOrders.whatNeedsFixing")}
            placeholderTextColor={theme.textMuted}
            autoFocus
          />

          <TextInput
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder={t("workOrders.detailsOptionalPlaceholder")}
            placeholderTextColor={theme.textMuted}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          {!roomId ? (
            <>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{t("workOrders.location")}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary }]}
                value={location}
                onChangeText={setLocation}
                placeholder={t("workOrders.locationPlaceholder")}
                placeholderTextColor={theme.textMuted}
              />
            </>
          ) : null}

          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{t("workOrders.categoryLabel")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.primaryLine : theme.border,
                      backgroundColor: active ? theme.primarySoft : theme.surfaceSubtle,
                    },
                  ]}
                  onPress={() => setCategory(cat.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, { color: active ? theme.primaryAction : theme.textMuted }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{t("workOrders.priority")}</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => {
              const active = priority === p.key;
              const color = priorityColor(p.key);
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.priorityBtn,
                    { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                    active && { borderColor: color, backgroundColor: color + "1A" },
                  ]}
                  onPress={() => setPriority(p.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.priorityText,
                      { color: theme.textMuted },
                      active && { color, fontWeight: "800" },
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{t("workOrders.reportedBy")}</Text>
          <View style={styles.sourceRow}>
            {SOURCES.map((s) => {
              const active = source === s.key;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[
                    styles.sourceBtn,
                    { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                    active && { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine },
                  ]}
                  onPress={() => setSource(s.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.sourceText,
                      { color: theme.textMuted },
                      active && { color: theme.primaryAction },
                    ]}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Button
              label="Create Work Order"
              icon="construct-outline"
              onPress={submit}
              loading={loading}
              disabled={!title.trim() || loading}
              style={styles.submitBtn}
            />
            <Button label="Cancel" variant="ghost" size="sm" onPress={onClose} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "900", flex: 1 },
  roomBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
  },
  roomBadgeText: { fontFamily: monoFont, fontSize: 13, fontWeight: "700" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
  },
  inputMulti: { minHeight: 60 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: -4,
  },
  chipRow: { gap: 7, paddingVertical: 2 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  priorityRow: { flexDirection: "row", gap: 8 },
  priorityBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderRadius: R.md,
    borderWidth: 1,
  },
  priorityText: { fontSize: 13, fontWeight: "700" },
  sourceRow: { flexDirection: "row", gap: 6 },
  sourceBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: R.md,
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  sourceText: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  submitBtn: { flex: 1, borderRadius: 12 },
});
