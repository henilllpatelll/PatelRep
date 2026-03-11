import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";

type Task = {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  room_number?: string;
};

const STATUS_COLORS: Record<string, string> = {
  open: "#EF4444",
  in_progress: "#F59E0B",
  completed: "#10B981",
  cancelled: "#9CA3AF",
};

export default function TasksScreen() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Task[]>("/tasks?my_tasks=true")
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#1E40AF" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={tasks}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLORS[item.status] ?? "#9CA3AF" }]} />
          <View style={styles.content}>
            <Text style={styles.title}>{item.title}</Text>
            {item.room_number && (
              <Text style={styles.meta}>Room {item.room_number}</Text>
            )}
          </View>
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No tasks assigned</Text>
        </View>
      }
      contentContainerStyle={tasks.length === 0 ? styles.emptyFlex : undefined}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyFlex: { flex: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    margin: 8,
    marginHorizontal: 16,
    borderRadius: 10,
    padding: 14,
    gap: 10,
    elevation: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: "500", color: "#111827" },
  meta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  emptyText: { color: "#9CA3AF", fontSize: 15 },
});
