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
import { sendDirectMessage } from "@/lib/api/housekeepingSupervisor";

interface Props {
  visible: boolean;
  recipientId: string | null;
  recipientName: string | null;
  onClose: () => void;
}

export default function DirectMessageModal({ visible, recipientId, recipientName, onClose }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!recipientId || !text.trim() || sending) return;
    setSending(true);
    try {
      await sendDirectMessage(recipientId, text.trim());
      setText("");
      onClose();
    } catch {
      Alert.alert(t("directMessage.sendError"));
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setText("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t("directMessage.title", { name: recipientName ?? "—" })}</Text>
          <Text style={styles.hint}>{t("directMessage.hint")}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t("directMessage.placeholder")}
            placeholderTextColor={C.ink4}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.dimmed]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              <Text style={styles.sendText}>{sending ? t("directMessage.sending") : t("directMessage.send")}</Text>
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
  title: { fontSize: 18, fontWeight: "700", color: C.ink, marginBottom: 4 },
  hint: { fontSize: 12.5, color: C.ink3, marginBottom: 14 },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: C.ink,
    minHeight: 90,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1, minHeight: 46, borderRadius: R.md, borderWidth: 1, borderColor: C.line,
    alignItems: "center", justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.ink3 },
  sendBtn: { flex: 2, minHeight: 46, borderRadius: R.md, backgroundColor: C.info, alignItems: "center", justifyContent: "center" },
  sendText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dimmed: { opacity: 0.5 },
});
