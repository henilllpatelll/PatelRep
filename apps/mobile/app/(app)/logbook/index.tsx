import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type LogbookEntry = {
  id: string;
  title: string;
  body: string;
  department_name: string | null;
  author_name: string;
  is_urgent: boolean;
  created_at: string;
};

type AISummary = {
  date: string;
  summary: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function groupByDate(entries: LogbookEntry[]) {
  const groups: Record<string, LogbookEntry[]> = {};
  for (const e of entries) {
    const day = e.created_at.slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(e);
  }
  return groups;
}

export default function LogbookScreen() {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEntries = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const [entriesRes, summaryRes] = await Promise.allSettled([
        api.get<{ data: LogbookEntry[] }>("/logbook/entries?per_page=30"),
        api.get<{ data: AISummary }>("/logbook/shift-summary"),
      ]);
      if (entriesRes.status === "fulfilled") setEntries(entriesRes.value.data ?? []);
      if (summaryRes.status === "fulfilled") setSummary(summaryRes.value.data ?? null);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  }, [loadEntries]);

  const grouped = groupByDate(entries);
  const days = Object.keys(grouped).sort().reverse();

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
        <Text style={styles.title}>{t("logbook.title")}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/(app)/logbook/new")}
          activeOpacity={0.75}
        >
          <Ionicons name="add" size={18} color={C.surface} />
          <Text style={styles.addBtnLabel}>{t("logbook.newEntry")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {summary ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <Ionicons name="sparkles" size={14} color={C.ai} />
              <Text style={styles.summaryLabel}>{t("logbook.aiSummary")}</Text>
              <Text style={styles.summaryDate}>{summary.date}</Text>
            </View>
            <Text style={styles.summaryText}>{summary.summary}</Text>
          </View>
        ) : null}

        {days.map((day) => (
          <View key={day}>
            <SectionLabel hint={`${grouped[day].length} ${t("logbook.entries")}`}>
              {new Date(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </SectionLabel>
            {grouped[day].map((entry) => (
              <View key={entry.id} style={[styles.entryCard, entry.is_urgent && styles.entryCardUrgent]}>
                <View style={styles.entryTop}>
                  <Text style={styles.entryTitle}>{entry.title}</Text>
                  {entry.is_urgent ? <Pill tone="alert">{t("logbook.urgent")}</Pill> : null}
                  {entry.department_name ? <Pill tone="neutral">{entry.department_name}</Pill> : null}
                </View>
                <Text style={styles.entryBody} numberOfLines={3}>{entry.body}</Text>
                <View style={styles.entryFooter}>
                  <Text style={styles.entryAuthor}>{entry.author_name}</Text>
                  <Text style={styles.entryTime}>{formatDate(entry.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="book-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("logbook.noEntries")}</Text>
            <Text style={styles.emptyText}>{t("logbook.noEntriesHint")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addBtnLabel: { fontSize: 13, fontWeight: "600", color: C.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  summaryCard: {
    backgroundColor: C.aiSoft,
    borderWidth: 1,
    borderColor: C.aiLine,
    borderRadius: R.lg,
    padding: 14,
    gap: 8,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { flex: 1, fontSize: 12, fontWeight: "700", color: C.ai },
  summaryDate: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  summaryText: { fontSize: 13, color: C.ink2, lineHeight: 19 },
  entryCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: R.lg, padding: 14, gap: 6,
  },
  entryCardUrgent: { borderColor: C.alertLine, backgroundColor: C.alertSoft },
  entryTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  entryTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: C.ink },
  entryBody: { fontSize: 13, color: C.ink2, lineHeight: 18 },
  entryFooter: { flexDirection: "row", justifyContent: "space-between" },
  entryAuthor: { fontSize: 11, color: C.ink3, fontWeight: "600" },
  entryTime: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3, textAlign: "center" },
});
