import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { confirmAITasks, parseTaskWithAI, type TaskPreview } from "@/lib/ai/tasks";

/* Interim "Add task" surface. It keeps the existing, working plain-language flow (parse -> review ->
   create, with the same validation and error handling) behind a single entry point; the redesigned
   creation experience replaces it in a later phase. */

interface AddTaskSheetProps {
  visible: boolean;
  isOnline: boolean;
  onClose: () => void;
  /** Called after the server created the task(s), so the lists can reconcile. */
  onCreated: () => void;
}

function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

export function AddTaskSheet({ visible, isOnline, onClose, onCreated }: AddTaskSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [previews, setPreviews] = useState<TaskPreview[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const reset = useCallback(() => {
    setText("");
    setPreviews([]);
    setMessage(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const submit = useCallback(async () => {
    const value = text.trim();
    if (!value || parsing) return;
    setParsing(true);
    setMessage(null);
    setPreviews([]);
    try {
      const parsed = await parseTaskWithAI(value);
      if (parsed.previews.length > 0) {
        setPreviews(parsed.previews);
        setText("");
      } else {
        setMessage(parsed.message || t("tasks.aiNoTask"));
      }
    } catch {
      setMessage(t("tasks.aiUnavailable"));
    } finally {
      setParsing(false);
    }
  }, [text, parsing, t]);

  const create = useCallback(async () => {
    if (previews.length === 0 || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      await confirmAITasks(previews);
      reset();
      onCreated();
      onClose();
    } catch (error) {
      const status = httpStatus(error);
      setMessage(status !== null && status >= 400 && status < 500 ? t("tasks.aiRejected") : t("tasks.aiUnavailable"));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [previews, reset, onCreated, onClose, t]);

  const sendDisabled = !text.trim() || parsing || !isOnline;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel={t("tasks.hk.add.close")} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.shell.bg, borderColor: theme.shell.line, paddingBottom: insets.bottom + 14 },
          ]}
          testID="add-task-sheet"
        >
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.shell.ink }]}>
              {t("tasks.hk.add.sheetTitle")}
            </Text>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t("tasks.hk.add.close")}
              hitSlop={8}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={theme.shell.ink2} />
            </Pressable>
          </View>

          {previews.length > 0 ? (
            <View
              style={[styles.previewCard, { backgroundColor: theme.shell.surface, borderColor: theme.ai.line }]}
              testID="ai-task-preview"
            >
              <View style={styles.previewHeader}>
                <Ionicons name="sparkles" size={12} color={theme.ai.primary} />
                <Text style={[styles.previewLabel, { color: theme.ai.primary }]}>{t("tasks.aiPreviewLabel")}</Text>
              </View>
              {previews.map((preview, index) => (
                <View key={`${preview.title}-${index}`} style={styles.previewItem}>
                  <Text style={[styles.previewTitle, { color: theme.shell.ink }]}>{preview.title}</Text>
                  <View style={styles.previewMetaRow}>
                    {preview.room_number_display ? (
                      <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>
                        {preview.room_id
                          ? t("tasks.roomLabel", { room: preview.room_number_display })
                          : t("tasks.locationLabel", { place: preview.room_number_display })}
                      </Text>
                    ) : null}
                    <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>{preview.priority.toUpperCase()}</Text>
                    <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>{preview.task_type}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={[styles.previewBtn, { backgroundColor: theme.primaryAction }, creating && styles.disabled]}
                  onPress={() => void create()}
                  disabled={creating || !isOnline}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t("copilot.create")}
                  accessibilityState={{ disabled: creating || !isOnline, busy: creating }}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={theme.onPrimary} />
                  ) : (
                    <Text style={[styles.previewBtnText, { color: theme.onPrimary }]}>{t("copilot.create")}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.previewBtn, styles.outlined, { borderColor: theme.shell.line }]}
                  onPress={() => setPreviews([])}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t("copilot.dismiss")}
                >
                  <Text style={[styles.previewBtnText, { color: theme.shell.ink2 }]}>{t("copilot.dismiss")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {message ? (
            <Text style={[styles.message, { color: theme.shell.ink2 }]} accessibilityRole="alert">
              {message}
            </Text>
          ) : null}

          <View style={styles.composerRow}>
            <TextInput
              style={[styles.input, { borderColor: theme.shell.line, backgroundColor: theme.shell.surface, color: theme.shell.ink }]}
              value={text}
              onChangeText={setText}
              placeholder={isOnline ? t("tasks.addPlaceholder") : t("common.offline")}
              placeholderTextColor={theme.textDisabled}
              editable={isOnline && !parsing}
              maxLength={300}
              onSubmitEditing={() => void submit()}
              returnKeyType="send"
              accessibilityLabel={t("tasks.hk.add.sheetTitle")}
            />
            <TouchableOpacity
              accessibilityLabel={t("tasks.addWithAI")}
              accessibilityRole="button"
              style={[styles.send, { backgroundColor: theme.ai.primary }, sendDisabled && styles.disabled]}
              onPress={() => void submit()}
              disabled={sendDisabled}
              activeOpacity={0.85}
              accessibilityState={{ disabled: sendDisabled, busy: parsing }}
            >
              {parsing ? (
                <ActivityIndicator size="small" color={theme.onAi} />
              ) : (
                <Ionicons name="sparkles" size={18} color={theme.onAi} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  input: { flex: 1, minHeight: 48, maxHeight: 90, borderRadius: 13, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  send: { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
  message: { fontSize: 13 },
  previewCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 8 },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  previewLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  previewItem: { gap: 4 },
  previewTitle: { fontSize: 14.5, fontWeight: "700" },
  previewMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  previewMeta: { fontSize: 11.5, fontFamily: monoFont },
  previewActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  previewBtn: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  outlined: { borderWidth: 1 },
  previewBtnText: { fontSize: 13.5, fontWeight: "800" },
});
