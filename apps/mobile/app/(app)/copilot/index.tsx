import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, darkTheme } from "@/components/shared/tokens";

const HISTORY_KEY = "@patelrep/copilot_history";
const MAX_HISTORY = 20;

// expo-speech-recognition is a native module — unavailable in Expo Go.
type SpeechEventHandler = (e: { results: Array<{ transcript: string }> }) => void;
let _speechModule: { start: (opts: Record<string, unknown>) => void; stop: () => void } | null = null;
let useSpeechRecognitionEvent: (event: string, handler: SpeechEventHandler | (() => void)) => void = () => {};
try {
  const mod = require("expo-speech-recognition");
  _speechModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch {
  // Not available in Expo Go — mic button will be hidden
}

type TaskPreview = { title: string; task_type: string; priority: string; room_number?: string };
type WorkOrderPreview = { title: string; category: string; priority: string; room_number?: string };
type GuestRequestPreview = { request_type: string; description: string; room_number?: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  task_preview?: TaskPreview;
  work_order_preview?: WorkOrderPreview;
  guest_request_preview?: GuestRequestPreview;
};

type CopilotResponse = {
  message: string;
  intent: string;
  task_preview?: TaskPreview;
  work_order_preview?: WorkOrderPreview;
  guest_request_preview?: GuestRequestPreview;
};

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
      // context must be an object — the API validates Optional[dict] and reads
      // intent_hint from it; a bare string fails validation with a 422.
      const response = await api.post<CopilotResponse>("/ai/copilot/chat", {
        message: text,
        context: { source: "mobile", role: user?.role ?? null },
      });

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
      // Endpoint takes a list; room resolves via room_number_display only
      await api.post("/ai/tasks/confirm", [
        {
          title: preview.title,
          task_type: preview.task_type,
          priority: preview.priority,
          room_number_display: preview.room_number ?? undefined,
        },
      ]);
      setPendingTaskMsgId(null);
      Alert.alert("", t("copilot.taskCreated"));
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    }
  }

  async function confirmWorkOrder(preview: WorkOrderPreview) {
    try {
      await api.post("/work-orders", { ...preview });
      setPendingWOMsgId(null);
      Alert.alert("", t("copilot.workOrderCreated"));
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    }
  }

  async function confirmGuestRequest(preview: GuestRequestPreview) {
    try {
      await api.post("/ai/guest-requests/confirm", { ...preview });
      setPendingGRMsgId(null);
      Alert.alert("", t("copilot.guestRequestCreated"));
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
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
                  <TouchableOpacity style={styles.confirmBtn} onPress={() => confirmTask(item.task_preview!)}>
                    <Text style={styles.confirmText}>{t("copilot.create")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissBtn} onPress={() => setPendingTaskMsgId(null)}>
                    <Text style={styles.dismissText}>{t("copilot.dismiss")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {item.work_order_preview && pendingWOMsgId === item.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardLabel}>{t("copilot.createWorkOrder")}</Text>
                <Text style={styles.confirmCardTitle}>{item.work_order_preview.title}</Text>
                <View style={styles.confirmCardActions}>
                  <TouchableOpacity style={styles.confirmBtn} onPress={() => confirmWorkOrder(item.work_order_preview!)}>
                    <Text style={styles.confirmText}>{t("copilot.create")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissBtn} onPress={() => setPendingWOMsgId(null)}>
                    <Text style={styles.dismissText}>{t("copilot.dismiss")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {item.guest_request_preview && pendingGRMsgId === item.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardLabel}>{t("copilot.createGuestRequest")}</Text>
                <Text style={styles.confirmCardTitle}>{item.guest_request_preview.description}</Text>
                <View style={styles.confirmCardActions}>
                  <TouchableOpacity style={styles.confirmBtn} onPress={() => confirmGuestRequest(item.guest_request_preview!)}>
                    <Text style={styles.confirmText}>{t("copilot.create")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissBtn} onPress={() => setPendingGRMsgId(null)}>
                    <Text style={styles.dismissText}>{t("copilot.dismiss")}</Text>
                  </TouchableOpacity>
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
                <TouchableOpacity
                  key={action.key}
                  style={styles.quickAction}
                  onPress={() => sendMessage(t(`copilot.quickActions.${action.key}`))}
                >
                  <Ionicons name={action.icon} size={20} color={darkTheme.ai.primary} />
                  <Text style={styles.quickActionText}>
                    {t(`copilot.quickActions.${action.key}`)}
                  </Text>
                </TouchableOpacity>
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
          <TouchableOpacity
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            style={[styles.micBtn, isRecording && styles.micBtnActive]}
          >
            <Ionicons name="mic" size={20} color={isRecording ? C.alert : darkTheme.textMuted} />
          </TouchableOpacity>
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
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
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
    gap: 10,
    backgroundColor: darkTheme.surfaceElevated,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: darkTheme.glassBorder,
  },
  quickActionText: { color: darkTheme.ai.primary, fontSize: 14, fontWeight: "500" },
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
    alignItems: "center",
  },
  confirmText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  dismissBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: darkTheme.border,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  dismissText: { color: darkTheme.textSecondary, fontSize: 13 },
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
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: darkTheme.ai.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: darkTheme.surfaceElevated,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: darkTheme.border,
  },
  micBtnActive: { backgroundColor: darkTheme.ai.soft },
});
