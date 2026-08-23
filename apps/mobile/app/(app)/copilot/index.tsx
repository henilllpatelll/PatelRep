import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { darkTheme } from "@/components/shared/tokens";
import { IconButton } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/lib/theme/useToast";
import { speechModule as _speechModule, useSpeechRecognitionEvent } from "@/lib/voice/speechModule";
import {
  sendCopilotMessage,
  confirmTask as confirmTaskRequest,
  confirmWorkOrder as confirmWorkOrderRequest,
  confirmGuestRequest as confirmGuestRequestRequest,
  type ChatMessage as Message,
  type TaskPreview,
  type WorkOrderPreview,
  type GuestRequestPreview,
} from "@/lib/ai/copilotChat";

const HISTORY_KEY = "@patelrep/copilot_history";
const MAX_HISTORY = 20;

const QUICK_ACTIONS = [
  { key: "reportIssue", icon: "warning" as const },
  { key: "requestSupplies", icon: "cube" as const },
  { key: "roomStatus", icon: "bed" as const },
  { key: "guestRequest", icon: "person" as const },
  { key: "searchSOPs", icon: "book-outline" as const },
];

export default function CopilotScreen() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const toast = useToast();
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const sentPrefillRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingTaskMsgId, setPendingTaskMsgId] = useState<string | null>(null);
  const [pendingWOMsgId, setPendingWOMsgId] = useState<string | null>(null);
  const [pendingGRMsgId, setPendingGRMsgId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const [isRecording, setIsRecording] = useState(false);

  // Load persisted history on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((stored) => {
        if (stored) {
          try {
            setMessages(JSON.parse(stored) as Message[]);
          } catch {
            // ignore corrupt storage
          }
        }
      })
      .catch(() => {});
  }, []);

  // Persist last MAX_HISTORY messages whenever they change
  useEffect(() => {
    if (messages.length === 0) return;
    const trimmed = messages.slice(-MAX_HISTORY);
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed)).catch(() => {});
  }, [messages]);

  // Deep-linked from the corner-card overlay's action buttons/chips — send
  // the tapped label as the opening message exactly once per screen visit.
  useEffect(() => {
    if (prefill && !sentPrefillRef.current) {
      sentPrefillRef.current = true;
      sendMessage(prefill);
    }
  }, [prefill]);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    setInput(transcript);
    setIsRecording(false);
  });
  useSpeechRecognitionEvent("error", () => setIsRecording(false));

  const handleMicPressIn = () => {
    if (!_speechModule) return;
    setIsRecording(true);
    _speechModule.start({ lang: "en-US", continuous: false, interimResults: false });
  };
  const handleMicPressOut = () => { _speechModule?.stop(); };

  async function sendMessage(text: string) {
    if (!text.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await sendCopilotMessage(text, user?.role);

      const msgId = (Date.now() + 1).toString();
      const assistantMsg: Message = {
        id: msgId,
        role: "assistant",
        content: response.message,
        task_preview: response.task_preview,
        work_order_preview: response.work_order_preview,
        guest_request_preview: response.guest_request_preview,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (response.task_preview) setPendingTaskMsgId(msgId);
      if (response.work_order_preview) setPendingWOMsgId(msgId);
      if (response.guest_request_preview) setPendingGRMsgId(msgId);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: t("common.error") },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd(), 100);
    }
  }

  async function confirmTask(preview: TaskPreview) {
    try {
      await confirmTaskRequest(preview);
      setPendingTaskMsgId(null);
      toast.success(t("copilot.taskCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function confirmWorkOrder(preview: WorkOrderPreview) {
    try {
      await confirmWorkOrderRequest(preview);
      setPendingWOMsgId(null);
      toast.success(t("copilot.workOrderCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function confirmGuestRequest(preview: GuestRequestPreview) {
    try {
      await confirmGuestRequestRequest(preview);
      setPendingGRMsgId(null);
      toast.success(t("copilot.guestRequestCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View>
            <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
              <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.aiText]}>
                {item.content}
              </Text>
            </View>
            {item.task_preview && pendingTaskMsgId === item.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardLabel}>{t("copilot.createTask")}</Text>
                <Text style={styles.confirmCardTitle}>{item.task_preview.title}</Text>
                <View style={styles.confirmCardActions}>
                  <Button
                    label={t("copilot.create")}
                    onPress={() => confirmTask(item.task_preview!)}
                    size="sm"
                    style={styles.confirmBtn}
                  />
                  <Button
                    label={t("copilot.dismiss")}
                    onPress={() => setPendingTaskMsgId(null)}
                    size="sm"
                    style={styles.dismissBtn}
                  />
                </View>
              </View>
            ) : null}
            {item.work_order_preview && pendingWOMsgId === item.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardLabel}>{t("copilot.createWorkOrder")}</Text>
                <Text style={styles.confirmCardTitle}>{item.work_order_preview.title}</Text>
                <View style={styles.confirmCardActions}>
                  <Button
                    label={t("copilot.create")}
                    onPress={() => confirmWorkOrder(item.work_order_preview!)}
                    size="sm"
                    style={styles.confirmBtn}
                  />
                  <Button
                    label={t("copilot.dismiss")}
                    onPress={() => setPendingWOMsgId(null)}
                    size="sm"
                    style={styles.dismissBtn}
                  />
                </View>
              </View>
            ) : null}
            {item.guest_request_preview && pendingGRMsgId === item.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardLabel}>{t("copilot.createGuestRequest")}</Text>
                <Text style={styles.confirmCardTitle}>{item.guest_request_preview.description}</Text>
                <View style={styles.confirmCardActions}>
                  <Button
                    label={t("copilot.create")}
                    onPress={() => confirmGuestRequest(item.guest_request_preview!)}
                    size="sm"
                    style={styles.confirmBtn}
                  />
                  <Button
                    label={t("copilot.dismiss")}
                    onPress={() => setPendingGRMsgId(null)}
                    size="sm"
                    style={styles.dismissBtn}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles" size={22} color={darkTheme.ai.primary} />
            </View>
            <Text style={styles.emptyTitle}>{t("copilot.title")}</Text>
            <View style={styles.quickActions}>
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.key}
                  label={t(`copilot.quickActions.${action.key}`)}
                  icon={action.icon}
                  onPress={() => sendMessage(t(`copilot.quickActions.${action.key}`))}
                  style={styles.quickAction}
                />
              ))}
            </View>
          </View>
        }
        contentContainerStyle={messages.length === 0 ? styles.emptyFlex : styles.messages}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      {loading ? (
        <View style={styles.typingRow}>
          <ActivityIndicator color={darkTheme.ai.primary} size="small" />
          <Text style={styles.typingText}>{t("copilot.thinking")}</Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        {_speechModule ? (
          <Pressable
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            accessibilityRole="button"
            style={[styles.iconControl, isRecording && styles.micBtnActive]}
          >
            <IconButton icon="mic" tone={isRecording ? "alert" : "ai"} size={40} />
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder={t("copilot.placeholder")}
          placeholderTextColor={darkTheme.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.iconControl, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          <IconButton icon="send" tone="ai" size={40} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: darkTheme.background },
  messages: { padding: 12, gap: 8 },
  emptyFlex: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkTheme.ai.soft,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: darkTheme.textPrimary, marginBottom: 24 },
  quickActions: { gap: 10, width: "100%" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    backgroundColor: darkTheme.surfaceElevated,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: darkTheme.glassBorder,
  },
  bubble: { maxWidth: "80%", borderRadius: 14, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: "flex-end", backgroundColor: darkTheme.surface, borderWidth: 1, borderColor: darkTheme.border },
  aiBubble: { alignSelf: "flex-start", backgroundColor: darkTheme.surfaceElevated, borderWidth: 1, borderColor: darkTheme.ai.line },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: darkTheme.textPrimary },
  aiText: { color: darkTheme.textSecondary },
  confirmCard: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: darkTheme.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    alignSelf: "flex-start",
    maxWidth: "85%",
  },
  confirmCardLabel: { fontSize: 11, color: darkTheme.textMuted, marginBottom: 4, fontWeight: "600", textTransform: "uppercase" },
  confirmCardTitle: { fontSize: 15, fontWeight: "600", color: darkTheme.textPrimary, marginBottom: 10 },
  confirmCardActions: { flexDirection: "row", gap: 8 },
  confirmBtn: {
    flex: 1,
    backgroundColor: darkTheme.primaryAction,
    borderRadius: 8,
    paddingVertical: 9,
  },
  dismissBtn: {
    flex: 1,
    backgroundColor: darkTheme.surfaceElevated,
    borderWidth: 1,
    borderColor: darkTheme.border,
    borderRadius: 8,
    paddingVertical: 9,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: darkTheme.background,
  },
  typingText: { fontSize: 12, color: darkTheme.textMuted, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: darkTheme.surface,
    borderTopWidth: 1,
    borderColor: darkTheme.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: darkTheme.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
    color: darkTheme.textPrimary,
    backgroundColor: darkTheme.surfaceElevated,
  },
  iconControl: {
    width: 40,
    height: 40,
  },
  sendBtnDisabled: { opacity: 0.4 },
  micBtnActive: {
    borderWidth: 2,
    borderRadius: 12,
    borderColor: darkTheme.status.dirty,
  },
});
