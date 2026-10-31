import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { pickPhoto, prepareForUpload, type PhotoPick, type PhotoSource } from "@/lib/housekeeping/photo";
import type { PmEvidenceRef } from "@/lib/engineering/pmChecklist";

type Failure = Extract<PhotoPick, { ok: false }>["reason"];

interface Props {
  photos: readonly PmEvidenceRef[];
  /** An upload for this slot is in flight. */
  uploading: boolean;
  online: boolean;
  /** Uploads one prepared photo and resolves once the server holds it; honours `signal`. */
  onAdd: (uri: string, signal: AbortSignal) => Promise<void>;
  onRemove: (evidenceId: string) => void;
  testID: string;
}

/**
 * Photo evidence for one slot. A photo is uploaded the moment it is chosen and only counts once the server has returned
 * its evidence record id - a failed upload leaves nothing attached, shows why, and can simply be retried. Uploading
 * needs a connection (a file cannot be queued safely), and a slot takes one upload at a time.
 */
export function PmPhotoField({ photos, uploading, online, onAdd, onRemove, testID }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [pickFailure, setPickFailure] = useState<Failure | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function add(source: PhotoSource) {
    if (uploading) return;
    setPickFailure(null);
    setUploadError(false);
    const picked = await pickPhoto(source);
    if (!picked.ok) {
      if (picked.reason !== "cancelled") setPickFailure(picked.reason);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    try {
      await onAdd(await prepareForUpload(picked.uri), controller.signal);
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== "AbortError") setUploadError(true);
    } finally {
      abort.current = null;
    }
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.thumbs}>
        {photos.map((photo) => (
          <View key={photo.id} style={[styles.thumb, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
            {photo.uri ? (
              <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel={t("pm.photo.attached")} />
            ) : (
              <Ionicons name="image-outline" size={22} color={theme.textMuted} accessibilityLabel={t("pm.photo.attached")} />
            )}
            <Pressable
              onPress={() => onRemove(photo.id)}
              style={[styles.remove, { backgroundColor: theme.surface, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={t("pm.photo.remove")}
              hitSlop={10}
              testID={`${testID}-remove-${photo.id}`}
            >
              <Ionicons name="close" size={14} color={theme.textPrimary} />
            </Pressable>
          </View>
        ))}
        {uploading ? (
          <View style={[styles.thumb, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} accessibilityLabel={t("pm.photo.uploading")}>
            <ActivityIndicator color={theme.primaryAction} />
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void add("camera")}
          disabled={!online || uploading}
          style={[styles.action, { borderColor: theme.border, opacity: !online || uploading ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={t("workOrders.repair.evidence.takePhoto")}
          testID={`${testID}-camera`}
        >
          <Ionicons name="camera-outline" size={18} color={theme.primaryAction} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
            {t("workOrders.repair.evidence.takePhoto")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void add("gallery")}
          disabled={!online || uploading}
          style={[styles.action, { borderColor: theme.border, opacity: !online || uploading ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={t("workOrders.repair.evidence.library")}
          testID={`${testID}-library`}
        >
          <Ionicons name="images-outline" size={18} color={theme.primaryAction} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
            {t("pm.photo.library")}
          </Text>
        </Pressable>
      </View>
      {!online ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.pickup }]}>
          {t("workOrders.repair.evidence.needsConnection")}
        </Text>
      ) : null}
      {pickFailure ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
          {t(`workOrders.repair.evidence.pick.${pickFailure}`, { defaultValue: t("pm.photo.failed") })}
        </Text>
      ) : null}
      {uploadError ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {t("pm.photo.uploadFailed")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: 64, height: 64 },
  remove: { position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  actionText: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 13 },
});
