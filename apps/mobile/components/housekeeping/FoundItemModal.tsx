import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { createLostFoundItem, uploadLostFoundPhoto } from "@/lib/api/lostFound";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

interface FoundItemModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

export default function FoundItemModal({
  visible,
  roomId,
  roomNumber,
  onClose,
}: FoundItemModalProps) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const theme = useTheme();
  const toast = useToast();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setPhotoUri(null);
    setDescription("");
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      toast.error(t("foundItem.cameraPermissionMessage"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  function showPhotoOptions() {
    // Genuine 3-way choice (take photo / choose gallery / cancel) — stays a
    // blocking native alert per 08-03-PLAN.md alert_classification; do not
    // convert to Toast.
    Alert.alert(t("foundItem.addPhoto"), undefined, [
      { text: t("foundItem.takePhoto"), onPress: () => void pickFromCamera() },
      { text: t("foundItem.chooseGallery"), onPress: () => void pickFromGallery() },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function uploadPhoto(uri: string): Promise<string | null> {
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
    );
    return uploadLostFoundPhoto(manipResult.uri);
  }

  async function handleSubmit() {
    if (!description.trim()) return;
    if (!isOnline) {
      toast.error(t("foundItem.offlineError"));
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        const url = await uploadPhoto(photoUri);
        if (url) photoUrl = url;
      }

      await createLostFoundItem({
        description: description.trim(),
        room_id: roomId,
        location_found: `Room ${roomNumber}`,
        photo_url: photoUrl,
      });

      resetForm();
      onClose();
    } catch {
      // keep modal open on error
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{t("foundItem.title")}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t("foundItem.room", { room: roomNumber })}
          </Text>

          {/* Displays either an image preview or an icon+text placeholder —
              kept as a themed TouchableOpacity rather than <Button> because
              the Button primitive has no Image/children slot for the photo
              preview (would drop the preview feature). */}
          <TouchableOpacity
            style={[styles.photoBox, { borderColor: theme.border }]}
            onPress={showPhotoOptions}
          >
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.photoPlaceholder, { backgroundColor: theme.surfaceSubtle }]}>
                <Ionicons name="camera-outline" size={28} color={theme.textMuted} />
                <Text style={[styles.photoPlaceholderText, { color: theme.textMuted }]}>
                  {t("foundItem.addPhoto")}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.textPrimary, backgroundColor: theme.surface }]}
            multiline
            placeholder={t("foundItem.descriptionPlaceholder")}
            placeholderTextColor={theme.textMuted}
            value={description}
            onChangeText={setDescription}
            numberOfLines={3}
          />

          <View style={styles.buttons}>
            <Button
              label={t("common.cancel")}
              variant="secondary"
              onPress={handleCancel}
              style={styles.btn}
            />
            <Button
              label={t("foundItem.submit")}
              variant="primary"
              onPress={() => void handleSubmit()}
              loading={submitting}
              disabled={!description.trim() || submitting}
              style={styles.btn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 36,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 14,
  },
  photoBox: {
    height: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    overflow: "hidden",
    marginBottom: 12,
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  photoPlaceholderText: {
    fontSize: 13,
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    flex: 1,
    borderRadius: 10,
  },
});
