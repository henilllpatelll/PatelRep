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

// expo-speech-recognition is a native module — unavailable in Expo Go.
// Provide no-op stubs so the screen loads without crashing.
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
  const [isRecording, setIsRecording] = useState(false);

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

  const handleMicPressOut = () => {
    _speechModule?.stop();
  };

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
                  <Ionicons name={action.icon} size={20} color="#c8b8e3" />
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
        {_speechModule && (
          <TouchableOpacity
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            style={[styles.micBtn, isRecording && styles.micBtnActive]}
          >
            <Ionicons name="mic" size={20} color={isRecording ? "#a6263c" : "#807a70"} />
          </TouchableOpacity>
        )}
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
  container: { flex: 1, backgroundColor: "#0f0e0c" },
  messages: { padding: 12, gap: 8 },
  emptyFlex: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: "#ece4f8", marginBottom: 24 },
  quickActions: { gap: 10, width: "100%" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#221f1b",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#322d26",
  },
  quickActionText: { color: "#c8b8e3", fontSize: 14, fontWeight: "500" },
  bubble: { maxWidth: "80%", borderRadius: 14, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1a1815", borderWidth: 1, borderColor: "#322d26" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#221f1b", borderWidth: 1, borderColor: "#322d26" },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: "#f1ede4" },
  aiText: { color: "#c5beaf" },
  taskPreview: {
    backgroundColor: "#221f1b",
    margin: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#c8b8e3",
  },
  taskPreviewTitle: { fontSize: 12, color: "#918a7e", marginBottom: 4 },
  taskPreviewName: { fontSize: 15, fontWeight: "600", color: "#f1ede4" },
  taskPreviewActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  confirmBtn: {
    flex: 1,
    backgroundColor: "#b8431c",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  confirmText: { color: "#fff", fontWeight: "600" },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#322d26",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  editText: { color: "#c5beaf" },
  inputRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: "#1a1815",
    borderTopWidth: 1,
    borderColor: "#322d26",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#322d26",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
    color: "#f1ede4",
    backgroundColor: "#221f1b",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#b8431c",
    justifyContent: "center",
    alignItems: "center",
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#221f1b",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#322d26",
  },
  micBtnActive: {
    backgroundColor: "#2e1e16",
  },
});
