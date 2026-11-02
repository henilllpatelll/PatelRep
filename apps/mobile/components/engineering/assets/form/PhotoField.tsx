import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { InlineError, Note } from "@/components/engineering/workorder/sheetKit";
import { useTheme } from "@/lib/theme/useTheme";
import { pickPhoto, type PhotoPick, type PhotoSource } from "@/lib/housekeeping/photo";
import type { PhotoChange } from "@/lib/engineering/useAssetEditor";

type Failure = Extract<PhotoPick, { ok: false }>["reason"];

interface Props {
  /** The photograph already on the record (a short-lived signed URL), if any. */
  existingUrl?: string | null;
  change: PhotoChange;
  onChange: (next: PhotoChange) => void;
  disabled?: boolean;
  isOnline: boolean;
}

/**
 * The equipment identity photograph: take one, choose one, preview it, replace it or remove it. It is only chosen here;
 * it uploads when the form is saved, after the record exists, and a failed upload never loses the equipment.
 */
export function PhotoField({ existingUrl, change, onChange, disabled, isOnline }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [failure, setFailure] = useState<Failure | null>(null);

  const shownUri = change.kind === "new" ? change.uri : change.kind === "remove" ? null : (existingUrl ?? null);

  async function pick(source: PhotoSource) {
    setFailure(null);
    const result = await pickPhoto(source);
    if (result.ok) onChange({ kind: "new", uri: result.uri });
    else if (result.reason !== "cancelled") setFailure(result.reason);
  }

  return (
    <View style={styles.stack} testID="asset-photo-field">
      {shownUri ? (
        <Image source={{ uri: shownUri }} style={[styles.preview, { backgroundColor: theme.surfaceMuted }]} accessibilityLabel={t("assets.photo.previewLabel")} testID="asset-photo-preview" />
      ) : (
        <View style={[styles.placeholder, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Ionicons name="camera-outline" size={26} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.placeholderText, { color: theme.textMuted }]}>
            {change.kind === "remove" ? t("assets.photo.willRemove") : t("assets.photo.none")}
          </Text>
        </View>
      )}
      <View style={styles.actions}>
        <Button label={t("assets.photo.take")} icon="camera-outline" variant="secondary" size="sm" onPress={() => void pick("camera")} disabled={disabled} style={styles.action} testID="asset-photo-take" />
        <Button label={t("assets.photo.choose")} icon="images-outline" variant="secondary" size="sm" onPress={() => void pick("gallery")} disabled={disabled} style={styles.action} testID="asset-photo-choose" />
      </View>
      {shownUri ? (
        <Pressable onPress={() => onChange(change.kind === "new" ? { kind: "keep" } : { kind: "remove" })} disabled={disabled} accessibilityRole="button" style={styles.remove} testID="asset-photo-remove">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.status.dirty, fontSize: 14, fontWeight: "600" }}>
            {change.kind === "new" && existingUrl ? t("assets.photo.keepCurrent") : t("assets.photo.remove")}
          </Text>
        </Pressable>
      ) : change.kind === "remove" ? (
        <Pressable onPress={() => onChange({ kind: "keep" })} accessibilityRole="button" style={styles.remove} testID="asset-photo-undo-remove">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primaryAction, fontSize: 14, fontWeight: "600" }}>
            {t("assets.photo.keepCurrent")}
          </Text>
        </Pressable>
      ) : null}
      {failure ? (
        <View style={styles.stack}>
          <InlineError testID="asset-photo-error">{t(`assets.photo.errors.${failure}`)}</InlineError>
          {failure === "permission_denied" ? (
            <Button label={t("assets.photo.openSettings")} variant="ghost" size="sm" onPress={() => void Linking.openSettings()} testID="asset-photo-settings" />
          ) : null}
        </View>
      ) : null}
      {!isOnline && change.kind !== "keep" ? <Note tone="warn">{t("assets.photo.needsConnection")}</Note> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  preview: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12 },
  placeholder: { height: 110, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 6 },
  placeholderText: { fontSize: 13 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1 },
  remove: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
