import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import { CopilotHero, HeroButton, SectionLabel } from "@/components/shared/mobileHandoff";
import { getDocument, type SOPDocument } from "@/lib/api/sop";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function SopDetailScreen() {
  const { sopId } = useLocalSearchParams<{ sopId: string }>();
  const [doc, setDoc] = useState<SOPDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sopId) return;
    getDocument(sopId)
      .then((res) => setDoc(res.data))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [sopId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Document not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.headerMeta}>{doc.category ?? "General"}{doc.page_count ? ` — ${doc.page_count} pages` : ""}</Text>
        <Text style={styles.title}>{doc.title}</Text>
      </View>

      <View style={styles.metaLine}>
        <Ionicons name="document-text-outline" size={13} color={C.ink3} />
        <Text style={styles.metaText}>Updated {formatDate(doc.created_at)}</Text>
        <View style={styles.metaDot} />
        <Text style={[styles.metaText, doc.indexing_status === "indexed" ? { color: C.ready } : { color: C.caution }]}>
          {doc.indexing_status === "indexed" ? "AI-indexed" : doc.indexing_status}
        </Text>
      </View>

      <CopilotHero
        tone="violet"
        kicker="AI assistant"
        actions={
          <HeroButton onDark={false} primary icon="sparkles">
            Ask about this SOP
          </HeroButton>
        }
      >
        <Text>
          I can answer questions about <Text style={styles.heroStrong}>{doc.title}</Text> or help you apply it step by step.
        </Text>
      </CopilotHero>

      {doc.description ? (
        <View>
          <SectionLabel>Overview</SectionLabel>
          <View style={styles.descCard}>
            <Text style={styles.descText}>{doc.description}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="folder-outline" size={15} color={C.ink3} />
          <Text style={styles.infoLabel}>Category</Text>
          <Text style={styles.infoValue}>{doc.category ?? "General"}</Text>
        </View>
        {doc.page_count ? (
          <View style={[styles.infoRow, styles.infoRowBorder]}>
            <Ionicons name="documents-outline" size={15} color={C.ink3} />
            <Text style={styles.infoLabel}>Pages</Text>
            <Text style={styles.infoValue}>{doc.page_count}</Text>
          </View>
        ) : null}
        <View style={[styles.infoRow, styles.infoRowBorder]}>
          <Ionicons name="time-outline" size={15} color={C.ink3} />
          <Text style={styles.infoLabel}>Added</Text>
          <Text style={styles.infoValue}>{formatDate(doc.created_at)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  errorText: { color: C.ink3, fontSize: 14 },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  metaText: { color: C.ink3, fontSize: 12 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.ink4 },
  heroStrong: { fontStyle: "normal", fontWeight: "700", color: C.ink },
  descCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14 },
  descText: { color: C.ink2, fontSize: 13.5, lineHeight: 20 },
  infoCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: C.line2 },
  infoLabel: { flex: 1, color: C.ink3, fontSize: 13 },
  infoValue: { color: C.ink, fontSize: 13, fontWeight: "600" },
});
