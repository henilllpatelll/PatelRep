import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { CopilotHero, SectionLabel } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { getDocument, type SOPDocument } from "@/lib/api/sop";
import { useTheme } from "@/lib/theme/useTheme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function SopDetailScreen() {
  const { sopId } = useLocalSearchParams<{ sopId: string }>();
  const theme = useTheme();
  const { t } = useTranslation();
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
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }

  if (!doc) {
    return (
      <StateBlock
        status="error"
        errorIcon="document-text-outline"
        errorMessage="Document not found."
        style={[styles.center, { backgroundColor: theme.background }]}
      />
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <View>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{doc.category ?? "General"}{doc.page_count ? ` — ${doc.page_count} pages` : ""}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{doc.title}</Text>
      </View>

      <View style={styles.metaLine}>
        <Ionicons name="document-text-outline" size={13} color={theme.textMuted} />
        <Text style={[styles.metaText, { color: theme.textMuted }]}>{t("sop.updatedPrefix", { date: formatDate(doc.created_at) })}</Text>
        <View style={[styles.metaDot, { backgroundColor: theme.textDisabled }]} />
        <Text style={[styles.metaText, { color: doc.indexing_status === "indexed" ? theme.status.ready : theme.status.pickup }]}>
          {doc.indexing_status === "indexed" ? "AI-indexed" : doc.indexing_status}
        </Text>
      </View>

      <CopilotHero
        tone="violet"
        kicker="AI assistant"
        actions={
          <Button label="Ask about this SOP" onPress={() => undefined} icon="sparkles" size="sm" />
        }
      >
        <Text>
          {t("sop.assistantIntroPrefix")} <Text style={[styles.heroStrong, { color: theme.textPrimary }]}>{doc.title}</Text> {t("sop.assistantIntroSuffix")}
        </Text>
      </CopilotHero>

      {doc.description ? (
        <View>
          <SectionLabel>{t("sop.overview")}</SectionLabel>
          <Card style={styles.descCard}>
            <Text style={[styles.descText, { color: theme.textSecondary }]}>{doc.description}</Text>
          </Card>
        </View>
      ) : null}

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="folder-outline" size={15} color={theme.textMuted} />
          <Text style={[styles.infoLabel, { color: theme.textMuted }]}>{t("sop.category")}</Text>
          <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{doc.category ?? "General"}</Text>
        </View>
        {doc.page_count ? (
          <View style={[styles.infoRow, styles.infoRowBorder, { borderTopColor: theme.borderSubtle }]}>
            <Ionicons name="documents-outline" size={15} color={theme.textMuted} />
            <Text style={[styles.infoLabel, { color: theme.textMuted }]}>{t("sop.pages")}</Text>
            <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{doc.page_count}</Text>
          </View>
        ) : null}
        <View style={[styles.infoRow, styles.infoRowBorder, { borderTopColor: theme.borderSubtle }]}>
          <Ionicons name="time-outline" size={15} color={theme.textMuted} />
          <Text style={[styles.infoLabel, { color: theme.textMuted }]}>{t("sop.added")}</Text>
          <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{formatDate(doc.created_at)}</Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  metaText: { fontSize: 12 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  heroStrong: { fontStyle: "normal", fontWeight: "700" },
  descCard: { borderRadius: 12, padding: 14 },
  descText: { fontSize: 13.5, lineHeight: 20 },
  infoCard: { borderRadius: 12, overflow: "hidden", padding: 0 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  infoRowBorder: { borderTopWidth: 1 },
  infoLabel: { flex: 1, fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: "600" },
});
