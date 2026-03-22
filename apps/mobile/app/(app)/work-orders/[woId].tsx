import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";

type WorkOrder = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  room_number?: string;
  location_detail?: string;
  photos: string[];
};

export default function WorkOrderDetailScreen() {
  const { woId } = useLocalSearchParams<{ woId: string }>();
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [completionNotes, setCompletionNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    api
      .get<WorkOrder>(`/work-orders/${woId}`)
      .then((wo) => {
        setWorkOrder(wo);
        setPhotos(wo.photos ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [woId]);

  async function pickAndUploadPhoto() {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );

      const filename = `wo_${woId}_${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("work-order-photos")
        .upload(filename, {
          uri: compressed.uri,
          type: "image/jpeg",
          name: filename,
        } as unknown as Blob);

      if (error) throw error;

      const {
        data: { publicUrl },
      } = supabase.storage.from("work-order-photos").getPublicUrl(filename);

      setPhotos((prev) => [...prev, publicUrl]);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function completeWorkOrder() {
    if (!workOrder) return;
    setCompleting(true);
    try {
      if (isOnline) {
        await api.post(`/work-orders/${workOrder.id}/complete`, {
          completion_notes: completionNotes,
          photo_urls: photos,
        });
        Alert.alert("Done!", "Work order completed.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        await enqueueAction(
          "work_order",
          "complete",
          { completion_notes: completionNotes },
          workOrder.id
        );
        setWorkOrder({ ...workOrder, status: "completed" });
        Alert.alert(t("common.offline") ?? "Saved offline", "Will sync when back online.");
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1E40AF" />
      </View>
    );
  }

  if (!workOrder) {
    return (
      <View style={styles.center}>
        <Text>{t("common.error")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1E40AF" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={2}>
          {workOrder.title}
        </Text>
      </View>

      {workOrder.description && (
        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.body}>{workOrder.description}</Text>
        </View>
      )}

      {workOrder.room_number && (
        <View style={styles.section}>
          <Text style={styles.label}>Location</Text>
          <Text style={styles.body}>
            Room {workOrder.room_number}
            {workOrder.location_detail ? ` — ${workOrder.location_detail}` : ""}
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>{t("workOrders.addPhoto")}</Text>
        <View style={styles.photoGrid}>
          {photos.map((uri, idx) => (
            <Image key={idx} source={{ uri }} style={styles.photo} />
          ))}
          <TouchableOpacity style={styles.addPhotoBtn} onPress={pickAndUploadPhoto}>
            {uploading ? (
              <ActivityIndicator color="#1E40AF" />
            ) : (
              <Ionicons name="camera" size={28} color="#1E40AF" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {workOrder.status === "in_progress" && (
        <View style={styles.section}>
          <Text style={styles.label}>{t("workOrders.notes")}</Text>
          <TextInput
            testID="completion-notes"
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            placeholder="Describe what was done..."
            value={completionNotes}
            onChangeText={setCompletionNotes}
          />
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={completeWorkOrder}
            disabled={completing}
          >
            {completing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.completeText}>{t("workOrders.complete")}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#E5E7EB",
    gap: 8,
  },
  backBtn: { marginTop: 2 },
  title: { fontSize: 18, fontWeight: "700", color: "#111827", flex: 1 },
  section: {
    backgroundColor: "#fff",
    padding: 16,
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  label: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 8,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  body: { fontSize: 15, color: "#374151", lineHeight: 22 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 80, height: 80, borderRadius: 8 },
  addPhotoBtn: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#1E40AF",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  notesInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: "#374151",
    minHeight: 100,
    textAlignVertical: "top",
  },
  completeBtn: {
    backgroundColor: "#10B981",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  completeText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
