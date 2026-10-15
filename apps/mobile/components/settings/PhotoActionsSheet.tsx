import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";

interface PhotoActionsSheetProps {
  visible: boolean;
  hasPhoto: boolean;
  onChooseLibrary: () => void;
  onTakePhoto: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Profile photo actions. Each action closes the sheet first, then runs. */
export function PhotoActionsSheet({ visible, hasPhoto, onChooseLibrary, onTakePhoto, onRemove, onClose }: PhotoActionsSheetProps) {
  const { t } = useTranslation();
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
            onPress={onRemove}
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
});
