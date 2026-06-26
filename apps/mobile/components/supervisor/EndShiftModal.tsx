import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { C, R } from "@/components/shared/tokens";
import { api } from "@/lib/api/client";
import type { FloorSnapshot } from "@/lib/housekeeping/supervisor";

interface Props {
  visible: boolean;
  snapshot: FloorSnapshot;
  onClose: () => void;
}

export default function EndShiftModal({ visible, snapshot, onClose }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post("/housekeeping/end-shift-summary", {
        rooms_completed: snapshot.ready,
        rooms_inspected: snapshot.ready,
        rooms_failed: 0,
        rooms_ooo: snapshot.ooo,
        supervisor_notes: notes.trim() || undefined,
      });
      setNotes("");
      onClose();
    } catch {
      Alert.alert(t("endShift.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t("endShift.title")}</Text>
          <Text style={styles.subtitle}>{t("endShift.subtitle")}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{snapshot.ready}</Text>
              <Text style={styles.statLabel}>{t("endShift.statReady")}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{snapshot.submitted}</Text>
              <Text style={styles.statLabel}>{t("endShift.statSubmitted")}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{snapshot.ooo}</Text>
              <Text style={styles.statLabel}>{t("endShift.statOoo")}</Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>{t("endShift.notesLabel")}</Text>
          <TextInput
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder={t("endShift.notesPlaceholder")}
            placeholderTextColor={C.ink4}
            multiline
            maxLength={500}
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.dimmed]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.submitText}>{submitting ? t("endShift.submitting") : t("endShift.submit")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: C.paper,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
  },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "700", color: C.ink, marginBottom: 4 },
  subtitle: { fontSize: 12.5, color: C.ink3, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: R.md, padding: 12, alignItems: "center",
  },
  statNum: { fontSize: 24, fontWeight: "700", color: C.ink },
  statLabel: { fontSize: 10.5, color: C.ink3, marginTop: 2, textAlign: "center" },
  fieldLabel: {
    fontSize: 11, fontWeight: "800", color: C.ink3,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
  },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.ink,
    minHeight: 84, textAlignVertical: "top", marginBottom: 16,
  },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1, minHeight: 46, borderRadius: R.md, borderWidth: 1, borderColor: C.line,
    alignItems: "center", justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.ink3 },
  submitBtn: { flex: 2, minHeight: 46, borderRadius: R.md, backgroundColor: C.ready, alignItems: "center", justifyContent: "center" },
  submitText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dimmed: { opacity: 0.5 },
});
