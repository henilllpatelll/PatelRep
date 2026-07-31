import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import type { AssignableStaff, TeamLoad } from "@/lib/housekeeping/supervisor";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";

/* ─── Housekeeper picker — bottom sheet used by Board and Assignments ───────
   Shows each assignable staff member with today's live load so the
   supervisor can see who has room for one more. */

export function HousekeeperPicker({
  visible,
  roomNumber,
  customTitle,
  staff,
  loads,
  saving,
  onSelect,
  onClose,
}: {
  visible: boolean;
  roomNumber: string | null;
  customTitle?: string | null;
  staff: AssignableStaff[];
  loads: TeamLoad[];
  saving: boolean;
  onSelect: (member: AssignableStaff) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const loadById = new Map(loads.map((load) => [load.housekeeperId, load]));
  const [savedId, setSavedId] = useState<string | null>(null);
  const prevSaving = useRef(false);

  useEffect(() => {
    if (prevSaving.current && !saving && savedId) {
      if (Platform.OS === "android") {
        ToastAndroid.show(t("picker.saved"), ToastAndroid.SHORT);
      }
      const timer = setTimeout(() => setSavedId(null), 600);
      return () => clearTimeout(timer);
    }
    prevSaving.current = saving;
  }, [saving, savedId, t]);

  const handleSelect = (member: AssignableStaff) => {
    setSavedId(member.userId);
    onSelect(member);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(28, insets.bottom + 14), backgroundColor: theme.background }]}>
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          {customTitle ?? (roomNumber ? t("picker.title", { room: roomNumber }) : t("picker.titleGeneric"))}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("picker.subtitle")}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {staff.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t("picker.noStaff")}</Text>
          ) : (
            staff.map((member) => {
              const load = loadById.get(member.userId);
              return (
                <Pressable
                  key={member.userId}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                    saving && styles.rowDimmed,
                    pressed && !saving && styles.rowPressed,
                  ]}
                  onPress={() => handleSelect(member)}
                  disabled={saving}
                  testID={`picker-${member.userId}`}
                >
                  <Avatar name={member.name} size={38} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowName, { color: theme.textPrimary }]} numberOfLines={1}>{member.name}</Text>
                    <Text style={[styles.rowLoad, { color: theme.textMuted }]}>
                      {load
                        ? t("picker.load", { count: load.total, minutes: load.minutesLeft })
                        : t("picker.noRooms")}
                    </Text>
                  </View>
                  {savedId === member.userId ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.status.ready} />
                  ) : (
                    <Ionicons name="person-add-outline" size={17} color={theme.primaryAction} />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <Button
          label={t("common.cancel")}
          onPress={onClose}
          variant="secondary"
          loading={saving}
          style={styles.cancelBtn}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "70%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12.5, marginTop: 3, marginBottom: 13 },
  list: { flexGrow: 0 },
  listContent: { gap: 7 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  rowDimmed: { opacity: 0.55 },
  rowPressed: { opacity: 0.8 },
  rowBody: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { fontSize: 14, fontWeight: "700" },
  rowLoad: { fontSize: 11.5 },
  emptyText: { fontSize: 13, textAlign: "center", paddingVertical: 18 },
  cancelBtn: { marginTop: 12 },
});
