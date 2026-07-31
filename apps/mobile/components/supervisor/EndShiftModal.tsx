import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { R } from "@/components/shared/tokens";
import { api } from "@/lib/api/client";
import type { FloorSnapshot } from "@/lib/housekeeping/supervisor";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

interface Props {
  visible: boolean;
  snapshot: FloorSnapshot;
  onClose: () => void;
}

export default function EndShiftModal({ visible, snapshot, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
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
      toast.error(t("endShift.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>{t("endShift.title")}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("endShift.subtitle")}</Text>

          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.statNum, { color: theme.textPrimary }]}>{snapshot.ready}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>{t("endShift.statReady")}</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.statNum, { color: theme.textPrimary }]}>{snapshot.submitted}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>{t("endShift.statSubmitted")}</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.statNum, { color: theme.textPrimary }]}>{snapshot.ooo}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>{t("endShift.statOoo")}</Text>
            </View>
          </View>

          <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t("endShift.notesLabel")}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t("endShift.notesPlaceholder")}
            placeholderTextColor={theme.textDisabled}
            multiline
            maxLength={500}
          />

          <View style={styles.actions}>
            <Button label={t("common.cancel")} onPress={onClose} variant="secondary" style={styles.cancelBtn} />
            <Button label={t("endShift.submit")} onPress={handleSubmit} loading={submitting} style={styles.submitBtn} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
  },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 12.5, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1, borderWidth: 1,
    borderRadius: R.md, padding: 12, alignItems: "center",
  },
  statNum: { fontSize: 24, fontWeight: "700" },
  statLabel: { fontSize: 10.5, marginTop: 2, textAlign: "center" },
  fieldLabel: {
    fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderRadius: R.md,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    minHeight: 84, textAlignVertical: "top", marginBottom: 16,
  },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1,
  },
  submitBtn: { flex: 2 },
});
