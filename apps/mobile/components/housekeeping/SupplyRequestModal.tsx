import { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
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
      toast.error("Pick at least one item to request.");
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
      toast.success("Your supervisor has been notified.");
      reset();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to send request");
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
            <Ionicons name="cube-outline" size={16} color={theme.primaryAction} />
            <Text style={[styles.title, { color: theme.textPrimary }]}>{t("supplies.request")}</Text>
          </View>
          <Text style={[styles.sub, { color: theme.textMuted }]}>{t("supplies.roomTapHint", { room: roomNumber })}</Text>
          <View style={styles.items}>
            {SUPPLY_ITEMS.map((item) => {
              const active = selected.has(item.key);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.item,
                    {
                      backgroundColor: active ? theme.primarySoft : theme.surfaceSubtle,
                      borderColor: active ? theme.primaryLine : theme.border,
                    },
                  ]}
                  onPress={() => toggle(item.key)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.check,
                      {
                        borderColor: active ? theme.primaryAction : theme.border,
                        backgroundColor: active ? theme.primaryAction : "transparent",
                      },
                    ]}
                  >
                    {active ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                  </View>
                  <Text
                    style={[
                      styles.itemLabel,
                      { color: active ? theme.primaryAction : theme.textSecondary, fontWeight: active ? "700" : "600" },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[styles.customInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary }]}
            value={customNote}
            onChangeText={setCustomNote}
            placeholder={t("supplies.otherPlaceholder")}
            placeholderTextColor={theme.textMuted}
          />
          <View style={styles.actions}>
            <Button
              label="Send Request"
              icon="send"
              onPress={submit}
              loading={loading}
              disabled={loading || (selected.size === 0 && !customNote.trim())}
              style={styles.sendBtn}
            />
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => { reset(); onClose(); }}
            />
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
  items: { gap: 8 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  itemLabel: { fontSize: 14 },
  customInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  sendBtn: { flex: 1, borderRadius: 12 },
});
