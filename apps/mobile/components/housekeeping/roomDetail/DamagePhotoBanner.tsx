import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { createWorkOrder, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import type { Room } from "@/stores/appStore";
import { MAX_FONT_SCALE } from "./BottomSheet";

/** Departure cleans: prompt to photograph pre-existing damage before cleaning over it. */
export function DamagePhotoBanner({ room }: { room: Room }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (dismissed) return null;

  async function addPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(t("foundItem.cameraPermissionTitle"), t("foundItem.cameraPermissionMessage"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const woId = await createWorkOrder({
        room_id: room.id,
        title: `Damage report — Room ${room.room_number}`,
        description: "Pre-existing damage documented before cleaning",
        category: "damage_report",
        priority: "low",
      });
      if (woId) await uploadWorkOrderPhoto(woId, result.assets[0].uri);
      setDismissed(true);
    } catch {
      Alert.alert(t("common.error"), t("rooms.detail.damageBanner.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }]} testID="damage-banner">
      <View style={styles.top}>
        <Ionicons name="camera-outline" size={18} color={theme.accentBrass} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.accentBrass }]}>
          {t("rooms.detail.damageBanner.text")}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.photoBtn, { backgroundColor: theme.primaryAction }, uploading && styles.dim]}
          onPress={() => void addPhoto()}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={t("rooms.detail.damageBanner.addPhoto")}
          accessibilityState={{ disabled: uploading, busy: uploading }}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={theme.onPrimary} />
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.photoText, { color: theme.onPrimary }]}>
              {t("rooms.detail.damageBanner.addPhoto")}
            </Text>
          )}
        </Pressable>
        <Pressable
          style={styles.skip}
          onPress={() => setDismissed(true)}
          accessibilityRole="button"
          accessibilityLabel={t("rooms.detail.damageBanner.skip")}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.skipText, { color: theme.textMuted }]}>
            {t("rooms.detail.damageBanner.skip")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 10 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  text: { flex: 1, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  photoBtn: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  photoText: { fontSize: 14, fontWeight: "800" },
  dim: { opacity: 0.55 },
  skip: { minHeight: 44, justifyContent: "center" },
  skipText: { fontSize: 14, fontWeight: "700" },
});
