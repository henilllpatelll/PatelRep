import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { createLostFoundItem } from "@/lib/api/lostFound";

interface FoundItemModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = globalThis.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export default function FoundItemModal({
  visible,
  roomId,
  roomNumber,
  onClose,
}: FoundItemModalProps) {
  const { t } = useTranslation();
  const { isOnline, user } = useAppStore();
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
      Alert.alert(
        t("foundItem.cameraPermissionTitle"),
        t("foundItem.cameraPermissionMessage")
      );
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
    Alert.alert(t("foundItem.addPhoto"), undefined, [
      { text: t("foundItem.takePhoto"), onPress: () => void pickFromCamera() },
      { text: t("foundItem.chooseGallery"), onPress: () => void pickFromGallery() },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function uploadPhoto(uri: string): Promise<string | null> {
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );

      const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const arrayBuffer = base64ToArrayBuffer(base64);
      const hotelId = user?.hotel_id ?? "unknown";
      const path = `${hotelId}/${Date.now()}.jpg`;

      const { data, error } = await supabase.storage
        .from("lost-found-photos")
        .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });

      if (error || !data) return null;

      const { data: urlData } = supabase.storage
        .from("lost-found-photos")
        .getPublicUrl(data.path);

      return urlData.publicUrl;
    } catch {
      return null;
    }
  }

  async function handleSubmit() {
    if (!description.trim()) return;
    if (!isOnline) {
      Alert.alert(t("common.error"), t("foundItem.offlineError"));
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
        <View style={styles.card}>
          <Text style={styles.title}>{t("foundItem.title")}</Text>
          <Text style={styles.subtitle}>
            {t("foundItem.room", { room: roomNumber })}
          </Text>

          <TouchableOpacity style={styles.photoBox} onPress={showPhotoOptions}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="camera-outline" size={28} color="#807a70" />
                <Text style={styles.photoPlaceholderText}>
                  {t("foundItem.addPhoto")}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            multiline
            placeholder={t("foundItem.descriptionPlaceholder")}
            placeholderTextColor="#9CA3AF"
            value={description}
            onChangeText={setDescription}
            numberOfLines={3}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={handleCancel}
            >
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                styles.submitBtn,
                (!description.trim() || submitting) && styles.submitDisabled,
              ]}
              onPress={() => void handleSubmit()}
              disabled={!description.trim() || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>{t("foundItem.submit")}</Text>
              )}
            </TouchableOpacity>
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
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 36,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: "#807a70",
    marginBottom: 14,
  },
  photoBox: {
    height: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e6dfd1",
    borderStyle: "dashed",
    overflow: "hidden",
    marginBottom: 12,
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f7f4ee",
  },
  photoPlaceholderText: {
    fontSize: 13,
    color: "#807a70",
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e6dfd1",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#111827",
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
    backgroundColor: "#fdfbf8",
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: "#f3f4f6",
  },
  cancelText: {
    color: "#374151",
    fontSize: 15,
    fontWeight: "600",
  },
  submitBtn: {
    backgroundColor: "#b8431c",
  },
  submitDisabled: {
    backgroundColor: "#e0a896",
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
