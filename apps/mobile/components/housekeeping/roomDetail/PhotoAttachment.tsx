import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { pickPhoto, type PhotoSource } from "@/lib/housekeeping/photo";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  uri: string | null;
  onChange: (uri: string | null) => void;
  disabled?: boolean;
  /** Overrides the "photo" nouns, e.g. for Lost & Found. */
  testIDPrefix?: string;
}

/**
 * Camera and gallery as two visible, labelled choices (no hidden native alert),
 * a preview, and Remove / Replace. A denied camera permission is explained next
 * to the buttons, and the gallery still works.
 */
export function PhotoAttachment({ uri, onChange, disabled, testIDPrefix = "photo" }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [message, setMessage] = useState<string | null>(null);

  async function choose(source: PhotoSource) {
    setMessage(null);
    const result = await pickPhoto(source);
    if (result.ok) {
      onChange(result.uri);
    } else if (result.reason === "permission_denied") {
      setMessage(t("rooms.work.sheets.photo.cameraDenied"));
    } else if (result.reason === "failed") {
      setMessage(t("rooms.work.sheets.photo.failed"));
    }
  }

  return (
    <View style={styles.root}>
      {uri ? (
        <View style={[styles.previewWrap, { borderColor: theme.border }]}>
          <Image
            source={{ uri }}
            style={styles.preview}
            resizeMode="cover"
            accessible
            accessibilityRole="image"
            accessibilityLabel={t("rooms.work.sheets.photo.previewLabel")}
            testID={`${testIDPrefix}-preview`}
          />
        </View>
      ) : null}
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button
            label={t(uri ? "rooms.work.sheets.photo.retake" : "rooms.work.sheets.photo.take")}
            icon="camera-outline"
            variant="secondary"
            onPress={() => void choose("camera")}
            disabled={disabled}
            testID={`${testIDPrefix}-camera`}
          />
        </View>
        <View style={styles.flex}>
          <Button
            label={t("rooms.work.sheets.photo.gallery")}
            icon="images-outline"
            variant="secondary"
            onPress={() => void choose("gallery")}
            disabled={disabled}
            testID={`${testIDPrefix}-gallery`}
          />
        </View>
      </View>
      {uri ? (
        <Button
          label={t("rooms.work.sheets.photo.remove")}
          icon="trash-outline"
          variant="ghost"
          size="sm"
          onPress={() => onChange(null)}
          disabled={disabled}
          testID={`${testIDPrefix}-remove`}
        />
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.message, { color: theme.status.dirty }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  previewWrap: { borderWidth: 1, borderRadius: 12, overflow: "hidden", height: 160 },
  preview: { width: "100%", height: "100%" },
  buttons: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  message: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
