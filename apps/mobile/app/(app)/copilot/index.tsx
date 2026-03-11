import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  task_preview?: {
    title: string;
    task_type: string;
    priority: string;
    room_number?: string;
  };
};

type CopilotResponse = {
  message: string;
  intent: string;
  task_preview?: Message["task_preview"];
};

const QUICK_ACTIONS = [
  { key: "reportIssue", icon: "warning" as const },
  { key: "requestSupplies", icon: "cube" as const },
  { key: "roomStatus", icon: "bed" as const },
  { key: "guestRequest", icon: "person" as const },
];

export default function CopilotScreen() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingTask, setPendingTask] = useState<Message["task_preview"] | null>(null);
  const flatListRef = useRef<FlatList>(null);

  async function sendMessage(text: string) {
    if (!text.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await api.post<CopilotResponse>("/ai/copilot/chat", {
        message: text,
        context: { platform: "mobile" },
      });

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.message,
        task_preview: response.task_preview,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (response.task_preview) {
        setPendingTask(response.task_preview);
      }
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

  async function confirmTask() {
    if (!pendingTask) return;
    try {
      await api.post("/tasks", { ...pendingTask, use_ai: true });
      setPendingTask(null);
      Alert.alert("", t("copilot.taskCreated"));
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
          <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
            <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.aiText]}>
              {item.content}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>{t("copilot.title")}</Text>
            <View style={styles.quickActions}>
              {QUICK_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  style={styles.quickAction}
                  onPress={() => sendMessage(t(`copilot.quickActions.${action.key}`))}
                >
                  <Ionicons name={action.icon} size={20} color="#1E40AF" />
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

      {pendingTask && (
        <View style={styles.taskPreview}>
          <Text style={styles.taskPreviewTitle}>{t("copilot.confirmTask")}</Text>
          <Text style={styles.taskPreviewName}>{pendingTask.title}</Text>
          <View style={styles.taskPreviewActions}>
            <TouchableOpacity style={styles.confirmBtn} onPress={confirmTask}>
              <Text style={styles.confirmText}>{t("copilot.confirm")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editBtn} onPress={() => setPendingTask(null)}>
              <Text style={styles.editText}>{t("copilot.edit")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t("copilot.placeholder")}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  messages: { padding: 12, gap: 8 },
  emptyFlex: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: "#1E40AF", marginBottom: 24 },
  quickActions: { gap: 10, width: "100%" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    padding: 14,
  },
  quickActionText: { color: "#1E40AF", fontSize: 14, fontWeight: "500" },
  bubble: { maxWidth: "80%", borderRadius: 14, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1E40AF" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#fff", elevation: 1 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: "#fff" },
  aiText: { color: "#111827" },
  taskPreview: {
    backgroundColor: "#fff",
    margin: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E40AF",
  },
  taskPreviewTitle: { fontSize: 12, color: "#6B7280", marginBottom: 4 },
  taskPreviewName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  taskPreviewActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  confirmBtn: {
    flex: 1,
    backgroundColor: "#1E40AF",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  confirmText: { color: "#fff", fontWeight: "600" },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  editText: { color: "#374151" },
  inputRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#E5E7EB",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E40AF",
    justifyContent: "center",
    alignItems: "center",
  },
});
