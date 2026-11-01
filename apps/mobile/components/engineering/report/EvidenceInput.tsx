import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { InlineError, LineInput, Note } from "@/components/engineering/workorder/sheetKit";
import { pickPhoto, type PhotoPick, type PhotoSource } from "@/lib/housekeeping/photo";
import { MAX_REPORT_PHOTOS, type ReportPhoto } from "@/lib/engineering/reportIssue";

type Failure = Extract<PhotoPick, { ok: false }>["reason"];

interface Props {
  photos: readonly ReportPhoto[];
  isOnline: boolean;
  disabled?: boolean;
  onAdd: (uri: string) => boolean;
  onRemove: (id: string) => void;
  onCaption: (id: string, caption: string) => void;
}

/**
 * Photos for a new report. They are only chosen and previewed here; they upload after the work order exists and
 * are never queued for later, so offline the person is told plainly that they will not be saved.
 */
export function EvidenceInput({ photos, isOnline, disabled, onAdd, onRemove, onCaption }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [failure, setFailure] = useState<Failure | null>(null);
  const full = photos.length >= MAX_REPORT_PHOTOS;

  async function pick(source: PhotoSource) {
    setFailure(null);
    const result = await pickPhoto(source);
    if (result.ok) onAdd(result.uri);
    else if (result.reason !== "cancelled") setFailure(result.reason);
  }

  return (
    <View style={styles.stack} testID="report-evidence">
      {photos.length > 0 ? (
        <View style={styles.stack}>
          {photos.map((photo, index) => (
            <View key={photo.id} style={[styles.photo, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              <Image source={{ uri: photo.uri }} style={[styles.thumb, { backgroundColor: theme.surfaceMuted }]} accessibilityLabel={t("report.evidence.previewLabel", { n: index + 1 })} />
              <View style={styles.photoBody}>
                <LineInput
                  value={photo.caption}
                  onChangeText={(text) => onCaption(photo.id, text)}
                  editable={!disabled}
                  maxLength={300}
                  placeholder={t("report.evidence.caption")}
                  accessibilityLabel={t("report.evidence.captionLabel", { n: index + 1 })}
                  testID={`report-photo-caption-${index}`}
                />
              </View>
              <Pressable
                onPress={() => onRemove(photo.id)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={t("report.evidence.removeLabel", { n: index + 1 })}
                hitSlop={8}
                style={styles.remove}
                testID={`report-photo-remove-${index}`}
              >
                <Ionicons name="close-circle" size={24} color={theme.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.buttons}>
        <Button label={t("report.evidence.take")} icon="camera-outline" variant="secondary" onPress={() => void pick("camera")} disabled={disabled || full} style={styles.button} testID="report-photo-camera" />
        <Button label={t("report.evidence.choose")} icon="images-outline" variant="secondary" onPress={() => void pick("gallery")} disabled={disabled || full} style={styles.button} testID="report-photo-library" />
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]}>
        {full ? t("report.evidence.full", { max: MAX_REPORT_PHOTOS }) : t("report.evidence.count", { count: photos.length, max: MAX_REPORT_PHOTOS })}
      </Text>
      {!isOnline && photos.length > 0 ? <Note tone="warn" testID="report-photo-offline">{t("report.evidence.offline")}</Note> : null}
      {failure ? <InlineError>{t(`workOrders.repair.evidence.pick.${failure}`)}</InlineError> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  photo: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 8 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  photoBody: { flex: 1, minWidth: 0 },
  remove: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  buttons: { flexDirection: "row", gap: 10 },
  button: { flex: 1 },
  count: { fontSize: 12.5 },
});
