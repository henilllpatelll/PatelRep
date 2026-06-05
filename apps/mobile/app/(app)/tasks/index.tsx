import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { C, R, displayFont } from "@/components/shared/tokens";
import {
  AILabel,
  CopilotHero,
  HeroButton,
  IconButton,
  Pill,
  SectionLabel,
} from "@/components/shared/mobileHandoff";

type Task = {
  id: string;
  title: string;
  task_type?: string;
  status?: string;
  priority?: string;
  room_number?: string | null;
  due_label?: string | null;
  source?: string | null;
  ai_suggested?: boolean | null;
};

type TaskGroup = {
  when: string;
  tone: "accent" | "caution" | "info";
  items: Array<{
    id: string;
    label: string;
    meta: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    tone?: "accent" | "caution" | "info";
    ai?: boolean;
  }>;
};

const FALLBACK_GROUPS: TaskGroup[] = [
  {
    when: "Now",
    tone: "accent",
    items: [
      {
        id: "fallback-cart",
        label: "Restock cart - floor 2",
        meta: "Linens low - 6 rooms left",
        icon: "cube-outline",
        tone: "accent",
      },
    ],
  },
  {
    when: "Before 12:00",
    tone: "caution",
    items: [
      {
        id: "fallback-towels",
        label: "Deliver 2 extra towels to 214",
        meta: "Guest request - GR-438",
        icon: "bed-outline",
        tone: "caution",
        ai: true,
      },
      {
        id: "fallback-strip",
        label: "Strip and flip 118",
        meta: "Early checkout cleared",
        icon: "bed-outline",
      },
    ],
  },
  {
    when: "This afternoon",
    tone: "info",
    items: [
      {
        id: "fallback-fridge",
        label: "Deep-clean fridge - 122",
        meta: "Long stay - day 9",
        icon: "water-outline",
      },
      {
        id: "fallback-vip",
        label: "Photo audit 115 before VIP",
        meta: "Inspector will fast-track",
        icon: "camera-outline",
        ai: true,
      },
    ],
  },
];

function unwrapTasks(response: { data?: Task[] } | Task[]): Task[] {
  return Array.isArray(response) ? response : response.data ?? [];
}

function normalizeTask(task: Task) {
  const room = task.room_number ? `Room ${task.room_number}` : task.task_type ?? "Shift task";
  const priority = task.priority ? task.priority.toUpperCase() : "P2";
  return {
    id: task.id,
    label: task.title,
    meta: `${room} - ${priority}`,
    icon: task.source === "guest" ? ("bed-outline" as const) : ("cube-outline" as const),
    tone: task.priority === "urgent" || task.priority === "high" ? ("accent" as const) : undefined,
    ai: Boolean(task.ai_suggested),
  };
}

function groupTasks(tasks: Task[]): TaskGroup[] {
  if (tasks.length === 0) return FALLBACK_GROUPS;

  const now = tasks.filter((task) => task.due_label === "now" || task.priority === "urgent");
  const midday = tasks.filter(
    (task) => !now.includes(task) && (task.due_label === "before_noon" || task.source === "guest")
  );
  const afternoon = tasks.filter((task) => !now.includes(task) && !midday.includes(task));

  return [
    { when: "Now", tone: "accent" as const, items: now.map(normalizeTask) },
    { when: "Before 12:00", tone: "caution" as const, items: midday.map(normalizeTask) },
    { when: "This afternoon", tone: "info" as const, items: afternoon.map(normalizeTask) },
  ].filter((group) => group.items.length > 0);
}

export default function TasksScreen() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    api
      .get<{ data: Task[] } | Task[]>("/tasks?my_tasks=true")
      .then((response) => {
        if (mounted) setTasks(unwrapTasks(response));
      })
      .catch(() => {
        if (mounted) setTasks([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const completeTask = useCallback((taskId: string) => {
    if (taskId.startsWith("fallback-")) return;
    setCompleting((prev) => new Set(prev).add(taskId));
    api
      .patch(`/tasks/${taskId}`, { status: "done", completed_at: new Date().toISOString() })
      .then(() => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      })
      .catch(() => {
        setCompleting((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      });
  }, []);

  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const openCount = tasks.length || FALLBACK_GROUPS.reduce((sum, group) => sum + group.items.length, 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <IconButton icon="filter-outline" />
        <Text style={styles.headerMeta}>{t("tasks.headerMeta", { count: openCount })}</Text>
        <Text style={styles.title}>{t("tasks.title")}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <CopilotHero
          tone="violet"
          kicker={t("tasks.copilotKicker")}
          actions={
            <HeroButton onDark={false} icon="checkmark" primary>
              {t("tasks.reorderBtn")}
            </HeroButton>
          }
        >
          <Text>
            The towel drop for <Text style={styles.heroStrong}>214</Text> is on your way to 218 - knock that out next and save a trip.
          </Text>
        </CopilotHero>

        {groups.map((group) => (
          <View key={group.when}>
            <View style={styles.groupHeader}>
              <View style={[styles.groupDot, { backgroundColor: C[group.tone] }]} />
              <Text style={styles.groupTitle}>{group.when}</Text>
              <View style={styles.groupLine} />
            </View>

            <View style={styles.taskStack}>
              {group.items.map((item) => {
                const done = completing.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.taskCard, (pressed || done) && styles.taskCardPressed]}
                    onPress={() => completeTask(item.id)}
                  >
                    <View style={[styles.checkbox, done && styles.checkboxDone]}>
                      {done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    </View>
                    <View style={styles.taskBody}>
                      <View style={styles.taskTitleRow}>
                        <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{item.label}</Text>
                        {item.ai ? <AILabel>AI</AILabel> : null}
                      </View>
                      <Text style={styles.taskMeta}>{item.meta}</Text>
                    </View>
                    <IconButton icon={item.icon} tone={item.tone} size={34} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footerHint}>
          <Ionicons name="sparkles-outline" size={13} color={C.ink4} />
          <Text style={styles.footerText}>Copilot keeps this ordered around your route.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.paper,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.paper,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: C.paper,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  headerMeta: {
    marginTop: 8,
    color: C.ink3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: C.ink,
    fontSize: 30,
    lineHeight: 34,
    fontFamily: displayFont,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 16,
  },
  heroStrong: {
    fontStyle: "normal",
    fontWeight: "700",
    color: C.ink,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 9,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupTitle: {
    color: C.ink2,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  groupLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.line2,
  },
  taskStack: {
    gap: 8,
    paddingLeft: 4,
  },
  taskCard: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  taskCardPressed: {
    opacity: 0.7,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDone: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  taskTitleDone: {
    textDecorationLine: "line-through",
    color: C.ink3,
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  taskTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  taskTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  taskMeta: {
    color: C.ink3,
    fontSize: 11.5,
    marginTop: 3,
  },
  footerHint: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 7,
    marginTop: 2,
  },
  footerText: {
    color: C.ink4,
    fontSize: 12,
  },
});
