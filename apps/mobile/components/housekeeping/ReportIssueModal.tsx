import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { createWorkOrder, type CreateWorkOrderPayload } from "@/lib/api/workOrders";

interface ReportIssueModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

export default function ReportIssueModal({
  visible,
  roomId,
  roomNumber,
  onClose,
}: ReportIssueModalProps) {
  const { t } = useTranslation();
  const isOnline = useAppStore((s) => s.isOnline);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset description when modal closes
  useEffect(() => {
    if (!visible) {
      setDescription("");
    }
  }, [visible]);

  async function handleSubmit() {
    if (!description.trim()) return;
    setSubmitting(true);
    const payload: CreateWorkOrderPayload = {
      room_id: roomId,
      title: `Issue in Room ${roomNumber}`,
      description: description.trim(),
      category: "general",
      priority: "normal",
    };
    try {
      if (isOnline) {
        await createWorkOrder(payload);
      } else {
        await enqueueAction("work_order", "create", payload);
      }
      setDescription("");
      onClose();
    } catch {
      // silent fail — keep modal open
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setDescription("");
    onClose();
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
          <Text style={styles.title}>{t("rooms.reportIssueTitle")}</Text>

          <TextInput
            style={styles.input}
            multiline
            placeholder={t("rooms.reportIssueDescription")}
            placeholderTextColor="#9CA3AF"
            value={description}
            onChangeText={setDescription}
            testID="description-input"
            numberOfLines={4}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={handleCancel}
              testID="cancel-button"
            >
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btn,
                styles.submitBtn,
                (!description.trim() || submitting) && styles.submitDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!description.trim() || submitting}
              testID="submit-button"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>Submit</Text>
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
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#111827",
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 16,
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
    backgroundColor: "#F3F4F6",
  },
  cancelText: {
    color: "#374151",
    fontSize: 15,
    fontWeight: "600",
  },
  submitBtn: {
    backgroundColor: "#1E40AF",
  },
  submitDisabled: {
    backgroundColor: "#93C5FD",
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
