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
import { sendDirectMessage } from "@/lib/api/housekeepingSupervisor";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";

interface Props {
  visible: boolean;
  recipientId: string | null;
  recipientName: string | null;
  onClose: () => void;
}

export default function DirectMessageModal({ visible, recipientId, recipientName, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
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
      toast.error(t("directMessage.sendError"));
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
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>{t("directMessage.title", { name: recipientName ?? "—" })}</Text>
          <Text style={[styles.hint, { color: theme.textMuted }]}>{t("directMessage.hint")}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
            value={text}
            onChangeText={setText}
            placeholder={t("directMessage.placeholder")}
            placeholderTextColor={theme.textDisabled}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.actions}>
            <Button label={t("common.cancel")} onPress={handleClose} variant="secondary" style={styles.cancelBtn} />
            <Button
              label={t("directMessage.send")}
              onPress={handleSend}
              disabled={!text.trim()}
              loading={sending}
              style={styles.sendBtn}
            />
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
  title: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  hint: { fontSize: 12.5, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1,
  },
  sendBtn: { flex: 2 },
});
