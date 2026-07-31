import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

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
  const theme = useTheme();
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
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background },
        ]}
      >
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("logbook.title")}</Text>
        <Button
          label={t("logbook.newEntry")}
          icon="add"
          size="sm"
          style={styles.addBtn}
          onPress={() => router.push("/(app)/logbook/new")}
          testID="logbook-new-entry-button"
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primaryAction}
          />
        }
      >
        {summary ? (
          <Card
            style={[
              styles.summaryCard,
              { backgroundColor: theme.ai.soft, borderColor: theme.ai.line },
            ]}
          >
            <View style={styles.summaryHeader}>
              <Ionicons name="sparkles" size={14} color={theme.ai.primary} />
              <Text style={[styles.summaryLabel, { color: theme.ai.primary }]}>
                {t("logbook.aiSummary")}
              </Text>
              <Text style={[styles.summaryDate, { color: theme.textDisabled }]}>
                {summary.date}
              </Text>
            </View>
            <Text style={[styles.summaryText, { color: theme.textSecondary }]}>
              {summary.summary}
            </Text>
          </Card>
        ) : null}

        {days.map((day) => (
          <View key={day}>
            <SectionLabel hint={`${grouped[day].length} ${t("logbook.entries")}`}>
              {new Date(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </SectionLabel>
            {grouped[day].map((entry) => (
              <Card
                key={entry.id}
                style={[
                  styles.entryCard,
                  entry.is_urgent && {
                    borderColor: theme.status.dirtyLine,
                    backgroundColor: theme.status.dirtySoft,
                  },
                ]}
              >
                <View style={styles.entryTop}>
                  <Text style={[styles.entryTitle, { color: theme.textPrimary }]}>
                    {entry.title}
                  </Text>
                  {entry.is_urgent ? (
                    <StatusBadge statusKey="urgent" label={t("logbook.urgent")} />
                  ) : null}
                  {entry.department_name ? <Pill tone="neutral">{entry.department_name}</Pill> : null}
                </View>
                <Text
                  style={[styles.entryBody, { color: theme.textSecondary }]}
                  numberOfLines={3}
                >
                  {entry.body}
                </Text>
                <View style={styles.entryFooter}>
                  <Text style={[styles.entryAuthor, { color: theme.textMuted }]}>
                    {entry.author_name}
                  </Text>
                  <Text style={[styles.entryTime, { color: theme.textDisabled }]}>
                    {formatDate(entry.created_at)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        ))}

        {entries.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="book-outline"
            emptyTitle={t("logbook.noEntries")}
            emptyBody={t("logbook.noEntriesHint")}
            style={styles.emptyCard}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontWeight: "700" },
  addBtn: { flexShrink: 0 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  summaryCard: {
    padding: 14,
    gap: 8,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { flex: 1, fontSize: 12, fontWeight: "700" },
  summaryDate: { fontSize: 11, fontFamily: monoFont },
  summaryText: { fontSize: 13, lineHeight: 19 },
  entryCard: { padding: 14, gap: 6 },
  entryTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  entryTitle: { flex: 1, fontSize: 14, fontWeight: "700" },
  entryBody: { fontSize: 13, lineHeight: 18 },
  entryFooter: { flexDirection: "row", justifyContent: "space-between" },
  entryAuthor: { fontSize: 11, fontWeight: "600" },
  entryTime: { fontSize: 11, fontFamily: monoFont },
  emptyCard: { paddingVertical: 48 },
});
