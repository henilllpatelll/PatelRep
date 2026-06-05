import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import { AILabel, HandoffRow, IconButton, SectionLabel } from "@/components/shared/mobileHandoff";
import { listDocuments, type SOPDocument } from "@/lib/api/sop";

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
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerMeta}>{docs.length} procedures</Text>
        <Text style={styles.title}>How-to</Text>
      </View>

      <TouchableOpacity style={styles.search} onPress={() => router.push("/(app)/copilot")}>
        <Ionicons name="search-outline" size={15} color={C.ink3} />
        <Text style={styles.searchText}>Ask "how do I..."</Text>
        <AILabel>AI</AILabel>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <>
          <View>
            <SectionLabel>Categories</SectionLabel>
            <View style={styles.categories}>
              {categories.map((cat) => {
                const count = docs.filter((d) => (d.category ?? "General") === cat).length;
                return (
                  <View key={cat} style={styles.categoryCard}>
                    <IconButton icon={categoryIcon(cat)} tone="accent" size={38} />
                    <Text style={styles.categoryTitle}>{cat}</Text>
                    <Text style={styles.categorySub}>{count} procedure{count !== 1 ? "s" : ""}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View>
            <SectionLabel>Recently added</SectionLabel>
            <View style={styles.rows}>
              {recent.map((doc) => (
                <HandoffRow
                  key={doc.id}
                  onPress={() => router.push(`/(app)/sop/${doc.id}`)}
                  lead={<IconButton icon="document-text-outline" size={42} />}
                  title={<Text style={styles.rowTitle}>{doc.title}</Text>}
                  sub={`${doc.category ?? "General"}${doc.page_count ? ` — ${doc.page_count} pages` : ""}`}
                  right={<Ionicons name="chevron-forward" size={15} color={C.ink4} />}
                />
              ))}
              {docs.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No SOPs uploaded yet</Text>
                  <Text style={styles.emptySub}>Ask your GM to upload procedure documents.</Text>
                </View>
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  header: { marginBottom: 2 },
  center: { paddingTop: 40, alignItems: "center" },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  search: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14 },
  searchText: { flex: 1, color: C.ink4, fontSize: 13.5 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryCard: { width: "48.5%", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14 },
  categoryTitle: { color: C.ink, fontSize: 13.5, fontWeight: "700", marginTop: 10 },
  categorySub: { color: C.ink3, fontSize: 11.5, marginTop: 2 },
  rows: { gap: 8 },
  rowTitle: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
});
