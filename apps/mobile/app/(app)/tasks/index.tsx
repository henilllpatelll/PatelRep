import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { StateBlock } from "@/components/ui/StateBlock";
import { AIBriefingCard, SectionHeader } from "@/components/shared/evening";
import { TaskCard } from "@/components/tasks/TaskCard";
import {
  buildTaskBriefing,
  buildTaskQueue,
  confirmAITask,
  parseTaskWithAI,
  type Task,
  type TaskBucket,
  type TaskPreview,
  type TaskQueueEntry,
} from "@/lib/ai/tasks";

const BUCKET_TITLES: Record<TaskBucket, string> = {
  overdue: "tasks.groupOverdue",
  now: "tasks.groupNow",
  today: "tasks.groupToday",
};

function unwrapTasks(response: { data?: Task[] } | Task[]): Task[] {
  return Array.isArray(response) ? response : response.data ?? [];
}

function dayLabel(locale: string) {
  return new Date().toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
}

export default function TasksScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { isOnline, user } = useAppStore();
  const locale = user?.language_pref === "es" ? "es-MX" : "en-US";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneToday, setDoneToday] = useState(0);

  // AI composer state
  const [composerText, setComposerText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiPreview, setAiPreview] = useState<TaskPreview | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiCreating, setAiCreating] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const response = await api.get<{ data: Task[] } | Task[]>("/tasks?my_tasks=true");
      setTasks(unwrapTasks(response));
    } catch {
      setTasks([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  }, [loadTasks]);

  const completeTask = useCallback(
    (taskId: string) => {
      setConfirmingId(null);
      setBusyId(taskId);
      api
        .patch(`/tasks/${taskId}`, { status: "completed", completed_at: new Date().toISOString() })
        .then(() => {
          setTasks((prev) => prev.filter((task) => task.id !== taskId));
          setDoneToday((count) => count + 1);
        })
        .catch(() => {})
        .finally(() => setBusyId(null));
    },
    [],
  );

  const submitToAI = useCallback(async () => {
    const text = composerText.trim();
    if (!text || aiParsing) return;
    setAiParsing(true);
    setAiMessage(null);
    setAiPreview(null);
    try {
      const response = await parseTaskWithAI(text);
      if (response.task_preview) {
        setAiPreview(response.task_preview);
        setComposerText("");
      } else {
        setAiMessage(response.message || t("tasks.aiNoTask"));
      }
    } catch {
      setAiMessage(t("tasks.aiUnavailable"));
    } finally {
      setAiParsing(false);
    }
  }, [composerText, aiParsing, t]);

  const createFromPreview = useCallback(async () => {
    if (!aiPreview || aiCreating) return;
    setAiCreating(true);
    try {
      await confirmAITask(aiPreview);
      setAiPreview(null);
      setAiMessage(t("tasks.aiCreated"));
      await loadTasks();
    } catch {
      setAiMessage(t("tasks.aiUnavailable"));
    } finally {
      setAiCreating(false);
    }
  }, [aiPreview, aiCreating, loadTasks, t]);

  const queue = useMemo(() => buildTaskQueue(tasks), [tasks]);
  const briefing = useMemo(() => buildTaskBriefing(queue, t), [queue, t]);

  const sections = useMemo(() => {
    const byBucket: Record<TaskBucket, TaskQueueEntry[]> = { overdue: [], now: [], today: [] };
    queue.forEach((entry) => byBucket[entry.bucket].push(entry));
    return (Object.keys(byBucket) as TaskBucket[])
      .map((bucket) => ({ bucket, entries: byBucket[bucket] }))
      .filter((section) => section.entries.length > 0);
  }, [queue]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Evening Lobby shell header */}
      <View
        style={[
          styles.shellHeader,
          { paddingTop: insets.top + 12, backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line },
        ]}
      >
        <View style={styles.shellTopRow}>
          <View style={styles.shellTitleBlock}>
            <Text style={[styles.shellTitle, { color: theme.shell.ink }]}>{t("tasks.title")}</Text>
            <Text style={[styles.shellDate, { color: theme.shell.ink3 }]}>{dayLabel(locale)}</Text>
          </View>
          <View style={styles.shellCountBlock}>
            <Text style={[styles.shellCountValue, { color: theme.shell.ink }]}>{queue.length}</Text>
            <Text style={[styles.shellCountLabel, { color: theme.shell.ink3 }]}>{t("tasks.openLabel")}</Text>
            {doneToday > 0 ? (
              <Text style={[styles.shellDoneLabel, { color: theme.status.ready }]}>
                {t("tasks.doneToday", { count: doneToday })}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />
        }
      >
        <AIBriefingCard
          kicker={t("tasks.aiKicker")}
          headline={briefing.headline}
          watchouts={briefing.watchouts}
          footNote={t("ai.briefing.sourceLocal")}
        />

        {queue.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="checkmark-circle-outline"
            emptyTitle={t("tasks.emptyTitle")}
            emptyBody={t("tasks.emptyAiHint")}
          />
        ) : (
          sections.map((section) => (
            <View key={section.bucket} style={styles.section}>
              <SectionHeader title={t(BUCKET_TITLES[section.bucket])} hint={String(section.entries.length)} />
              <View style={styles.taskStack}>
                {section.entries.map((entry) => (
                  <TaskCard
                    key={entry.task.id}
                    entry={entry}
                    locale={locale}
                    confirming={confirmingId === entry.task.id}
                    busy={busyId === entry.task.id}
                    onRequestComplete={() => setConfirmingId(entry.task.id)}
                    onConfirm={() => completeTask(entry.task.id)}
                    onCancel={() => setConfirmingId(null)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* AI quick-add composer */}
      <View
        style={[
          styles.composerWrap,
          { paddingBottom: insets.bottom + 10, borderTopColor: theme.shell.line, backgroundColor: theme.shell.bg },
        ]}
      >
        {aiPreview ? (
          <View
            style={[styles.previewCard, { backgroundColor: theme.shell.surface, borderColor: theme.ai.line }]}
            testID="ai-task-preview"
          >
            <View style={styles.previewHeader}>
              <Ionicons name="sparkles" size={12} color={theme.ai.primary} />
              <Text style={[styles.previewLabel, { color: theme.ai.primary }]}>{t("tasks.aiPreviewLabel")}</Text>
            </View>
            <Text style={[styles.previewTitle, { color: theme.shell.ink }]}>{aiPreview.title}</Text>
            <View style={styles.previewMetaRow}>
              {aiPreview.room_number ? (
                <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>
                  {t("tasks.roomLabel", { room: aiPreview.room_number })}
                </Text>
              ) : null}
              <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>{aiPreview.priority?.toUpperCase()}</Text>
              <Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>{aiPreview.task_type}</Text>
            </View>
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={[
                  styles.previewCreateBtn,
                  { backgroundColor: theme.primaryAction },
                  aiCreating && styles.btnDisabled,
                ]}
                onPress={() => void createFromPreview()}
                disabled={aiCreating}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("copilot.create")}
                accessibilityState={{ disabled: aiCreating, busy: aiCreating }}
              >
                {aiCreating ? (
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                ) : (
                  <Text style={[styles.previewCreateText, { color: theme.onPrimary }]}>{t("copilot.create")}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewDismissBtn, { borderColor: theme.shell.line }]}
                onPress={() => setAiPreview(null)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("copilot.dismiss")}
              >
                <Text style={[styles.previewDismissText, { color: theme.shell.ink2 }]}>{t("copilot.dismiss")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {aiMessage ? <Text style={[styles.aiMessage, { color: theme.shell.ink2 }]}>{aiMessage}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            style={[styles.composerInput, { borderColor: theme.shell.line, backgroundColor: theme.shell.surface, color: theme.shell.ink }]}
            value={composerText}
            onChangeText={setComposerText}
            placeholder={isOnline ? t("tasks.addPlaceholder") : t("common.offline")}
            placeholderTextColor={theme.textDisabled}
            editable={isOnline && !aiParsing}
            maxLength={300}
            onSubmitEditing={() => void submitToAI()}
            returnKeyType="send"
          />
          <TouchableOpacity
            accessibilityLabel={t("tasks.addWithAI")}
            accessibilityRole="button"
            style={[
              styles.composerSend,
              { backgroundColor: theme.ai.primary, shadowColor: theme.ai.primary },
              (!composerText.trim() || aiParsing || !isOnline) && styles.btnDisabled,
            ]}
            onPress={() => void submitToAI()}
            disabled={!composerText.trim() || aiParsing || !isOnline}
            activeOpacity={0.85}
            accessibilityState={{
              disabled: !composerText.trim() || aiParsing || !isOnline,
              busy: aiParsing,
            }}
          >
            {aiParsing ? (
              <ActivityIndicator size="small" color={theme.onAi} />
            ) : (
              <Ionicons name="sparkles" size={17} color={theme.onAi} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, gap: 18 },

  shellHeader: {
    borderBottomWidth: 1,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  shellTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 14 },
  shellTitleBlock: { flex: 1, minWidth: 0 },
  shellTitle: { fontSize: 28, fontWeight: "700", lineHeight: 33 },
  shellDate: { fontSize: 12.5, marginTop: 2 },
  shellCountBlock: { alignItems: "flex-end" },
  shellCountValue: { fontFamily: monoFont, fontSize: 24, fontWeight: "800" },
  shellCountLabel: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  shellDoneLabel: { fontFamily: monoFont, fontSize: 10.5, marginTop: 2 },

  section: { gap: 9 },
  taskStack: { gap: 9 },

  composerWrap: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 9,
  },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 90,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
  },
  composerSend: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  btnDisabled: { opacity: 0.45 },
  aiMessage: { fontSize: 12, paddingHorizontal: 2 },

  previewCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    gap: 7,
  },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  previewLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  previewTitle: { fontSize: 14.5, fontWeight: "700" },
  previewMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  previewMeta: { fontSize: 11.5, fontFamily: monoFont },
  previewActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  previewCreateBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCreateText: { fontSize: 13, fontWeight: "800" },
  previewDismissBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewDismissText: { fontSize: 13, fontWeight: "700" },
});
