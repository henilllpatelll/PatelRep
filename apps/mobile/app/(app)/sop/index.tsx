import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { displayFont } from "@/components/shared/tokens";
import { AILabel, IconButton, SectionLabel } from "@/components/shared/mobileHandoff";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { listDocuments, type SOPDocument } from "@/lib/api/sop";
import { useTheme } from "@/lib/theme/useTheme";

const CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  Housekeeping: "bed-outline",
  Engineering: "construct-outline",
  "Front Desk": "business-outline",
  Safety: "shield-checkmark-outline",
};

function categoryIcon(cat: string | null): React.ComponentProps<typeof Ionicons>["name"] {
  if (!cat) return "document-text-outline";
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return "document-text-outline";
}

export default function SopLibraryScreen() {
  const theme = useTheme();
  const [docs, setDocs] = useState<SOPDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listDocuments();
      setDocs(res.data);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const categories = Array.from(new Set(docs.map((d) => d.category ?? "General")));
  const recent = [...docs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
    >
      <View style={styles.header}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{docs.length} procedures</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>How-to</Text>
      </View>

      <Pressable
        onPress={() => router.push("/(app)/copilot")}
        accessibilityRole="button"
        accessibilityLabel={'Ask "how do I..."'}
      >
        <Card style={styles.search}>
          <Ionicons name="search-outline" size={15} color={theme.textMuted} />
          <Text style={[styles.searchText, { color: theme.textDisabled }]}>Ask "how do I..."</Text>
          <AILabel>AI</AILabel>
        </Card>
      </Pressable>

      {loading ? (
        <StateBlock status="loading" style={styles.center} />
      ) : (
        <>
          <View>
            <SectionLabel>Categories</SectionLabel>
            <View style={styles.categories}>
              {categories.map((cat) => {
                const count = docs.filter((d) => (d.category ?? "General") === cat).length;
                return (
                  <Card key={cat} style={styles.categoryCard}>
                    <IconButton icon={categoryIcon(cat)} tone="accent" size={38} />
                    <Text style={[styles.categoryTitle, { color: theme.textPrimary }]}>{cat}</Text>
                    <Text style={[styles.categorySub, { color: theme.textMuted }]}>{count} procedure{count !== 1 ? "s" : ""}</Text>
                  </Card>
                );
              })}
            </View>
          </View>

          <View>
            <SectionLabel>Recently added</SectionLabel>
            <View style={styles.rows}>
              {recent.map((doc) => (
                <Pressable
                  key={doc.id}
                  onPress={() => router.push(`/(app)/sop/${doc.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={doc.title}
                >
                  <Card style={styles.rowCard}>
                    <IconButton icon="document-text-outline" size={42} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{doc.title}</Text>
                      <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                        {`${doc.category ?? "General"}${doc.page_count ? ` — ${doc.page_count} pages` : ""}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
                  </Card>
                </Pressable>
              ))}
              {docs.length === 0 && (
                <StateBlock
                  status="empty"
                  emptyIcon="document-text-outline"
                  emptyTitle="No SOPs uploaded yet"
                  emptyBody="Ask your GM to upload procedure documents."
                  style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
                />
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  header: { marginBottom: 2 },
  center: { paddingTop: 40, alignItems: "center" },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  search: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 0 },
  searchText: { flex: 1, fontSize: 13.5 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryCard: { width: "48.5%", borderRadius: 14, padding: 14 },
  categoryTitle: { fontSize: 13.5, fontWeight: "700", marginTop: 10 },
  categorySub: { fontSize: 11.5, marginTop: 2 },
  rows: { gap: 8 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 14 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13.5, fontWeight: "600" },
  rowSub: { fontSize: 13, marginTop: 3, lineHeight: 16 },
  empty: { borderWidth: 1, borderRadius: 12, padding: 20 },
});
