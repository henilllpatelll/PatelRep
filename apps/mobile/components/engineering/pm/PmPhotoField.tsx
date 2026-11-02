import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { pickPhoto, prepareForUpload, type PhotoPick, type PhotoSource } from "@/lib/housekeeping/photo";
import { isLocalPhoto, type PmEvidenceRef } from "@/lib/engineering/pmChecklist";

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
 * Photo evidence for one slot. Online, a photo is uploaded the moment it is chosen and is marked "Uploaded" once the
 * server returned its evidence record id. Offline, it is copied into the app's own folder and marked "Saved on this
 * phone" - in words, never with the green check reserved for the server - and is uploaded later by the sync. A failure
 * to keep or upload a photo attaches nothing, says why, and keeps the prepared photo so it can be retried. A slot takes
 * one photo at a time.
 */
export function PmPhotoField({ photos, uploading, online, onAdd, onRemove, testID }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [pickFailure, setPickFailure] = useState<Failure | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  /** Why a photo could not be kept on this phone (full storage, too large, ...), when that is what failed. */
  const [localFailure, setLocalFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<PmEvidenceRef | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function upload(uri: string) {
    const controller = new AbortController();
    abort.current = controller;
    try {
      await onAdd(uri, controller.signal);
      setFailedUri(null);
      setLocalFailure(null);
      AccessibilityInfo.announceForAccessibility(t("pm.photo.announceUploaded"));
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== "AbortError") {
        setFailedUri(uri);
        setLocalFailure((err as { reason?: string } | null)?.reason ?? null);
        AccessibilityInfo.announceForAccessibility(t("pm.photo.announceFailed"));
      }
    } finally {
      abort.current = null;
    }
  }

  async function add(source: PhotoSource) {
    if (uploading) return;
    setPickFailure(null);
    setFailedUri(null);
    const picked = await pickPhoto(source);
    if (!picked.ok) {
      if (picked.reason !== "cancelled") setPickFailure(picked.reason);
      return;
    }
    await upload(await prepareForUpload(picked.uri));
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.thumbs}>
        {photos.map((photo) => (
          <View key={photo.id} style={[styles.thumb, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
            <Pressable
              onPress={() => setPreview(photo)}
              style={styles.thumbPress}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${t("pm.photo.preview")}. ${isLocalPhoto(photo) ? t("pm.photo.savedOnPhone") : t("pm.photo.uploaded")}`}
              testID={`${testID}-preview-${photo.id}`}
            >
              {photo.uri ? <Image source={{ uri: photo.uri }} style={styles.image} /> : <Ionicons name="image-outline" size={22} color={theme.textMuted} />}
            </Pressable>
            <View
              style={[styles.badge, { backgroundColor: isLocalPhoto(photo) ? theme.status.pickup : theme.status.ready }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Ionicons name={isLocalPhoto(photo) ? "phone-portrait-outline" : "checkmark"} size={11} color={theme.surface} />
            </View>
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
          <View style={[styles.thumb, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} accessibilityLabel={t("pm.photo.uploading")} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.primaryAction} />
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void add("camera")}
          disabled={uploading}
          style={[styles.action, { borderColor: theme.border, opacity: uploading ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: uploading }}
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
          disabled={uploading}
          style={[styles.action, { borderColor: theme.border, opacity: uploading ? 0.5 : 1 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: uploading }}
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
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.pickup }]} testID={`${testID}-offline-note`}>
          {t("pm.photo.offlineNote")}
        </Text>
      ) : null}
      {pickFailure ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
          {t(`workOrders.repair.evidence.pick.${pickFailure}`, { defaultValue: t("pm.photo.failed") })}
        </Text>
      ) : null}
      {failedUri ? (
        <View style={styles.retryRow} testID={`${testID}-error`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, styles.retryText, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
            {localFailure ? t(`pm.photo.local.${localFailure}`, { defaultValue: t("pm.photo.local.save_failed") }) : t("pm.photo.uploadFailed")}
          </Text>
          <Pressable
            onPress={() => void upload(failedUri)}
            disabled={uploading}
            style={[styles.action, { borderColor: theme.status.dirty, opacity: uploading ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={t("pm.photo.retry")}
            testID={`${testID}-retry`}
          >
            <Ionicons name="refresh" size={18} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.status.dirty }]}>
              {t("pm.photo.retry")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={preview != null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBackdrop}>
          {preview?.uri ? <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="contain" accessibilityLabel={t("pm.photo.attached")} /> : null}
          {preview && !preview.uri ? <Ionicons name="image-outline" size={64} color="#fff" /> : null}
          <Pressable onPress={() => setPreview(null)} style={styles.previewClose} accessibilityRole="button" accessibilityLabel={t("pm.photo.previewClose")} testID={`${testID}-preview-close`}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbPress: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  image: { width: 64, height: 64 },
  badge: { position: "absolute", bottom: 3, left: 3, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  remove: { position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  actionText: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 13 },
  retryRow: { gap: 8 },
  retryText: { flexShrink: 1 },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  previewImage: { width: "100%", height: "80%" },
  previewClose: { position: "absolute", top: 56, right: 20, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
});
