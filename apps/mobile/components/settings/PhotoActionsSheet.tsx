import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";

interface PhotoActionsSheetProps {
  visible: boolean;
  hasPhoto: boolean;
  onChooseLibrary: () => void;
  onTakePhoto: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Profile photo actions. Choosing a photo closes the sheet first, then runs. Removing asks first, in this same
 * sheet (a second modal opened while this one dismisses can fail to present on iOS), and only the confirm runs it.
 */
export function PhotoActionsSheet({ visible, hasPhoto, onChooseLibrary, onTakePhoto, onRemove, onClose }: PhotoActionsSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Always reopen on the actions, never on a stale confirmation.
  useEffect(() => {
    if (!visible) setConfirmingRemove(false);
  }, [visible]);

  if (confirmingRemove) {
    return (
      <BottomSheet visible={visible} title={t("settings.personal.removeTitle")} onClose={onClose} testID="photo-remove-sheet">
        <Text maxFontSizeMultiplier={1.4} style={[styles.body, { color: theme.textSecondary }]}>
          {t("settings.personal.removeBody")}
        </Text>
        <View style={styles.actions}>
          <Button label={t("settings.personal.removeConfirm")} icon="trash-outline" variant="destructive" onPress={onRemove} testID="photo-remove-confirm" />
          <Button label={t("settings.personal.keepPhoto")} variant="secondary" onPress={() => setConfirmingRemove(false)} testID="photo-remove-keep" />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} title={t("settings.personal.changePhoto")} onClose={onClose} testID="photo-actions">
      <View style={styles.actions}>
        <Button
          label={t("settings.personal.chooseFromLibrary")}
          icon="images-outline"
          variant="secondary"
          onPress={onChooseLibrary}
          testID="photo-library"
        />
        <Button
          label={t("settings.personal.takePhoto")}
          icon="camera-outline"
          variant="secondary"
          onPress={onTakePhoto}
          testID="photo-camera"
        />
        {hasPhoto ? (
          <Button
            label={t("settings.personal.removePhoto")}
            icon="trash-outline"
            variant="destructive"
            onPress={() => setConfirmingRemove(true)}
            testID="photo-remove"
          />
        ) : null}
        <Button label={t("common.cancel")} variant="ghost" onPress={onClose} testID="photo-cancel" />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
});
