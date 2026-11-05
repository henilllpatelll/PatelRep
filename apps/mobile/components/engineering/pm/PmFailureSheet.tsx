import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import type { PmEvidenceRef } from "@/lib/engineering/pmChecklist";
import { PmPhotoField } from "./PmPhotoField";

interface Props {
  visible: boolean;
  equipmentName: string | null;
  /** The failed checklist step. */
  stepLabel: string;
  note: string;
  evidence: readonly PmEvidenceRef[];
  uploading: boolean;
  online: boolean;
  onNote: (note: string) => void;
  onAddPhoto: (uri: string, signal: AbortSignal) => Promise<void>;
  onRemovePhoto: (evidenceId: string) => void;
  onClose: () => void;
}

/**
 * Where a technician describes what failed. The text is written straight into the local draft as they type, so closing
 * the sheet (backdrop, back button or Save) never loses it, and the step stays marked Failed either way. Saving a finding
 * records nothing on the server and alerts nobody: the work order is opened when the whole inspection is completed, and
 * the sheet says so, along with where an immediate danger must be reported.
 */
export function PmFailureSheet({ visible, equipmentName, stepLabel, note, evidence, uploading, online, onNote, onAddPhoto, onRemovePhoto, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (visible) setAttempted(false);
  }, [visible]);

  const missing = !note.trim();
  const save = () => {
    if (missing) {
      setAttempted(true);
      return;
    }
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      title={t("pm.failure.title")}
      onClose={onClose}
      testID="pm-failure-sheet"
      scrollKey={attempted && missing ? "error" : null}
      footer={<Button label={t("pm.failure.save")} onPress={save} size="lg" testID="pm-failure-save" />}
    >
      <View style={styles.stack}>
        {equipmentName ? (
          <View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, x.label, { color: theme.textMuted }]}>
              {t("pm.failure.equipment")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
              {equipmentName}
            </Text>
          </View>
        ) : null}
        <View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, x.label, { color: theme.textMuted }]}>
            {t("pm.failure.check")}
          </Text>
          <View style={styles.checkRow}>
            <Ionicons name="close-circle" size={20} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.grow, { color: theme.textPrimary }]} testID="pm-failure-step">
              {stepLabel}
            </Text>
          </View>
        </View>

        <View style={[styles.guidance, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} testID="pm-failure-guidance">
          <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, styles.grow, { color: theme.textPrimary }]}>
            {t("pm.failure.guidance")}
          </Text>
        </View>

        <View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, x.label, { color: theme.textMuted }]}>
            {t("pm.failure.what")}
          </Text>
          <TextInput
            value={note}
            onChangeText={onNote}
            placeholder={t("pm.failure.placeholder")}
            placeholderTextColor={theme.textDisabled}
            multiline
            style={[styles.input, { color: theme.textPrimary, borderColor: attempted && missing ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}
            accessibilityLabel={t("pm.failure.what")}
            testID="pm-failure-note"
          />
          {attempted && missing ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityLiveRegion="polite" testID="pm-failure-error">
              {t("pm.failure.required")}
            </Text>
          ) : null}
        </View>

        <View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, x.label, { color: theme.textMuted }]}>
            {t("pm.failure.photo")}
          </Text>
          <PmPhotoField photos={evidence} uploading={uploading} online={online} onAdd={onAddPhoto} onRemove={onRemovePhoto} testID="pm-failure-photos" />
        </View>

        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.failure.afterComplete")}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  grow: { flex: 1 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 },
  value: { fontSize: 15, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  guidance: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 15, textAlignVertical: "top" },
});
