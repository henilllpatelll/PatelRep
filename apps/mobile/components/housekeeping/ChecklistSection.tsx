import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { createWorkOrder, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { LOST_FOUND_CHECK_KEY } from "@/lib/housekeeping/roomWorkflow";
import type { Room } from "@/stores/appStore";

type Theme = ReturnType<typeof useTheme>;

interface Props {
  room: Room;
  checklist: readonly string[];
  checkedItems: Record<string, boolean>;
  onCheck: (key: string, newVal: boolean) => void;
  linenOut: number;
  linenIn: number;
  onLinenOut: (n: number) => void;
  onLinenIn: (n: number) => void;
  onReportFoundItem: () => void;
}

function LinenStepper({
  label,
  value,
  onChange,
  theme,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  theme: Theme;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
          onPress={() => onChange(Math.max(0, value - 1))}
          activeOpacity={0.8}
          hitSlop={8}
        >
          <Text style={[styles.stepBtnText, { color: theme.textPrimary }]}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.stepCount, { color: theme.textPrimary }]}>{value}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
          onPress={() => onChange(value + 1)}
          activeOpacity={0.8}
          hitSlop={8}
        >
          <Text style={[styles.stepBtnText, { color: theme.textPrimary }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChecklistSection({
  room,
  checklist,
  checkedItems,
  onCheck,
  linenOut,
  linenIn,
  onLinenOut,
  onLinenIn,
  onReportFoundItem,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [damageBannerDismissed, setDamageBannerDismissed] = useState(false);
  const [damageUploading, setDamageUploading] = useState(false);

  const isDep = room.clean_type === "DEP";
  const showDamageBanner = isDep && !damageBannerDismissed;

  const checkedCount = checklist.filter((item) => checkedItems[item]).length;

  async function handleDamagePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(t("foundItem.cameraPermissionTitle"), t("foundItem.cameraPermissionMessage"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    setDamageUploading(true);
    try {
      const uri = result.assets[0].uri;
      const woId = await createWorkOrder({
        room_id: room.id,
        title: `Damage report — Room ${room.room_number}`,
        description: "Pre-existing damage documented before cleaning",
        category: "damage_report",
        priority: "low",
      });
      if (woId) {
        await uploadWorkOrderPhoto(woId, uri);
      }
      setDamageBannerDismissed(true);
    } catch {
      Alert.alert(t("common.error"), t("rooms.detail.damageBanner.uploadError"));
    } finally {
      setDamageUploading(false);
    }
  }

  return (
    <>
      {showDamageBanner ? (
        <View style={[styles.damageBanner, { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }]}>
          <Ionicons name="camera-outline" size={16} color={theme.accentBrass} />
          <Text style={[styles.damageBannerText, { color: theme.accentBrass }]}>{t("rooms.detail.damageBanner.text")}</Text>
          <View style={styles.damageBannerBtns}>
            <TouchableOpacity
              style={[styles.damagePhotoBtn, { backgroundColor: theme.accentBrass }, damageUploading && styles.damagePhotoBtnDisabled]}
              onPress={() => void handleDamagePhoto()}
              disabled={damageUploading}
              activeOpacity={0.82}
            >
              {damageUploading ? (
                <ActivityIndicator size="small" color={theme.accentBrass} />
              ) : (
                <Text style={styles.damagePhotoBtnText}>{t("rooms.detail.damageBanner.addPhoto")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDamageBannerDismissed(true)} activeOpacity={0.8}>
              <Text style={[styles.damageSkipText, { color: theme.textMuted }]}>{t("rooms.detail.damageBanner.skip")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.checklistHeader}>
          <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t("rooms.detail.cleaningChecklist")}</Text>
          <Text style={[styles.checklistCount, { color: theme.textMuted }]}>
            {checkedCount}/{checklist.length}
          </Text>
        </View>
        <View style={styles.checklist}>
          {checklist.map((item) => {
            const checked = Boolean(checkedItems[item]);
            const isLostFound = item === LOST_FOUND_CHECK_KEY;
            const isLocked = isLostFound && checked;

            return (
              <View key={item}>
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => {
                    if (isLocked) return;
                    onCheck(item, !checked);
                  }}
                  activeOpacity={isLocked ? 1 : 0.78}
                >
                  <View
                    style={[
                      styles.checkBox,
                      { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                      checked && { backgroundColor: theme.status.ready, borderColor: theme.status.ready },
                    ]}
                  >
                    {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.checkText, { color: theme.textPrimary }, checked && { color: theme.textMuted, textDecorationLine: "line-through" }]}>{t(item)}</Text>
                </TouchableOpacity>

                {isLostFound && checked ? (
                  <TouchableOpacity
                    style={styles.lostFoundLink}
                    onPress={onReportFoundItem}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="bag-outline" size={13} color={theme.status.pickup} />
                    <Text style={[styles.lostFoundLinkText, { color: theme.status.pickup }]}>{t("rooms.detail.lostFoundLink")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      {isDep ? (
        <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t("rooms.detail.linen.title")}</Text>
          <LinenStepper
            label={t("rooms.detail.linen.dirtyOut")}
            value={linenOut}
            onChange={onLinenOut}
            theme={theme}
          />
          <LinenStepper
            label={t("rooms.detail.linen.cleanIn")}
            value={linenIn}
            onChange={onLinenIn}
            theme={theme}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  checklistHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  checklistCount: {
    fontFamily: monoFont,
    fontSize: 12,
    fontWeight: "800",
  },
  checklist: { gap: 4 },
  checkRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 20 },

  lostFoundLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: 34,
    marginBottom: 4,
  },
  lostFoundLinkText: {
    fontSize: 12.5,
    fontWeight: "800",
    textDecorationLine: "underline",
  },

  damageBanner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  damageBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  damageBannerBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    width: "100%",
  },
  damagePhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 38,
  },
  damagePhotoBtnDisabled: { opacity: 0.55 },
  damagePhotoBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  damageSkipText: { fontSize: 13, fontWeight: "700" },

  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  stepperLabel: { fontSize: 14, fontWeight: "600", flex: 1 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { fontSize: 20, fontWeight: "700", lineHeight: 24 },
  stepCount: {
    fontFamily: monoFont,
    fontSize: 18,
    fontWeight: "800",
    minWidth: 28,
    textAlign: "center",
  },
});
