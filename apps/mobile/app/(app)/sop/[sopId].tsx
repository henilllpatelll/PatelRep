import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { documentStatus, formatDocumentDate, freshnessOf } from "@/lib/sop/library";
import { parsePageParam } from "@/lib/sop/citations";
import { openOriginalDocument, type OpenOriginalResult } from "@/lib/sop/openOriginal";
import { useAskAboutSop } from "@/lib/sop/useAskAboutSop";
import { useSopDocument } from "@/lib/sop/useSopDocument";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.6;

type OpenState = "idle" | "opening" | Exclude<OpenOriginalResult, "opened">;

/** One procedure: what it is, the original document, and questions the assistant can answer from it. */
export default function SopDetailScreen() {
  const { sopId, page: pageParam } = useLocalSearchParams<{ sopId: string; page?: string }>();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const ask = useAskAboutSop();
  const { doc, status, fromCache, savedAt, reload } = useSopDocument(sopId);
  const [open, setOpen] = useState<OpenState>("idle");
  const page = parsePageParam(pageParam);
  const language = i18n.language?.startsWith("es") ? "es" : "en";
  const otherLanguage = language === "es" ? "en" : "es";

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/sop" as never));
  const header = (
    <View style={[styles.nav, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("sop.backToList")} style={styles.backButton} testID="sop-detail-back">
        <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
        {t("sop.kicker")}
      </Text>
    </View>
  );

  if (status === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <StateBlock status="loading" style={styles.center} />
      </View>
    );
  }

  if (status !== "ready" || !doc) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <StateBlock
          status="error"
          errorIcon="document-text-outline"
          errorMessage={status === "gone" ? t("sop.gone") : t(isOnline ? "sop.errorLoad" : "sop.errorOffline")}
          onRetry={status === "gone" ? back : reload}
          retryLabel={status === "gone" ? t("sop.backToList") : t("common.retry")}
          style={styles.center}
        />
      </View>
    );
  }

  const info = documentStatus(doc);
  const approvedOn = formatDocumentDate(doc.approval?.approved_at, language);
  const reviewDue = formatDocumentDate(info.reviewDate, language);
  const added = formatDocumentDate(doc.created_at, language);
  const askable = doc.ai_ready !== false && doc.indexing_status === "indexed";
  const canAsk = askable && isOnline && !fromCache;
  const freshness = savedAt ? freshnessOf(savedAt) : null;

  const openOriginal = async () => {
    if (open === "opening") return;
    setOpen("opening");
    const result = await openOriginalDocument(doc.id, page);
    setOpen(result === "opened" ? "idle" : result);
  };

  const questions: Array<{ key: string; text: string }> = [
    { key: "keyPoints", text: t("sop.detail.q.keyPoints") },
    { key: "simply", text: t("sop.detail.q.simply") },
    { key: "first", text: t("sop.detail.q.first") },
    { key: "translate", text: t(`sop.detail.q.translate_${otherLanguage}`) },
  ];

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      {header}

      <View style={styles.body}>
        <View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerMeta, { color: theme.textMuted }]}>
            {doc.category ?? t("sop.general")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="sop-detail-title">
            {doc.title}
          </Text>
        </View>

        <View style={styles.metaLine}>
          <Ionicons name={info.kind === "approved" ? "shield-checkmark-outline" : "document-text-outline"} size={14} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metaText, { color: theme.textSecondary }]} testID="sop-detail-status">
            {info.kind === "approved"
              ? [t("sop.status.approved"), info.version ? t("sop.citation.version", { version: info.version }) : null].filter(Boolean).join(" · ")
              : t("sop.status.uploaded")}
          </Text>
        </View>
        {approvedOn || reviewDue ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metaText, { color: theme.textMuted }]} testID="sop-detail-dates">
            {[approvedOn ? t("sop.detail.approvedOn", { date: approvedOn }) : null, reviewDue ? t("sop.detail.reviewDue", { date: reviewDue }) : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}

        {fromCache ? (
          <View style={[styles.banner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} accessibilityRole="alert" testID="sop-detail-cache">
            <Ionicons name="cloud-offline-outline" size={16} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
              {freshness ? t(`sop.cache.saved_${freshness.unit}`, { value: freshness.value }) : t("sop.cache.saved_justNow")} {t("sop.cache.reconnect")}
            </Text>
          </View>
        ) : null}

        <View>
          <SectionLabel>{t("sop.detail.document")}</SectionLabel>
          <Card style={styles.docCard}>
            <View style={styles.infoRow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLabel, { color: theme.textMuted }]}>
                {t("sop.category")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoValue, { color: theme.textPrimary }]}>
                {doc.category ?? t("sop.general")}
              </Text>
            </View>
            {doc.page_count ? (
              <View style={styles.infoRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLabel, { color: theme.textMuted }]}>
                  {t("sop.pages")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoValue, { color: theme.textPrimary }]}>
                  {doc.page_count}
                </Text>
              </View>
            ) : null}
            {added ? (
              <View style={styles.infoRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLabel, { color: theme.textMuted }]}>
                  {t("sop.added")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoValue, { color: theme.textPrimary }]}>
                  {added}
                </Text>
              </View>
            ) : null}
            <Button
              label={page ? t("sop.detail.openPage", { page }) : t("sop.detail.open")}
              onPress={() => void openOriginal()}
              icon="open-outline"
              loading={open === "opening"}
              disabled={fromCache || !isOnline}
              testID="sop-open-original"
            />
            {open === "offline" || fromCache || !isOnline ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="sop-open-offline">
                {t("sop.detail.openOffline")}
              </Text>
            ) : null}
            {open === "unavailable" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.note, { color: theme.textMuted }]} testID="sop-open-unavailable">
                {t("sop.detail.openUnavailable")}
              </Text>
            ) : null}
          </Card>
        </View>

        {doc.description ? (
          <View>
            <SectionLabel>{t("sop.overview")}</SectionLabel>
            <Card style={styles.descCard}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.descText, { color: theme.textSecondary }]}>
                {doc.description}
              </Text>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>{t("sop.detail.askTitle")}</SectionLabel>
          {canAsk ? (
            <View style={styles.chips}>
              {questions.map((question) => (
                <Pressable
                  key={question.key}
                  onPress={() => ask({ documentId: doc.id, title: doc.title, text: question.text })}
                  accessibilityRole="button"
                  accessibilityLabel={question.text}
                  style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  testID={`sop-question-${question.key}`}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                    {question.text}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => ask({ documentId: doc.id, title: doc.title })}
                accessibilityRole="button"
                accessibilityLabel={t("sop.detail.askAnother")}
                style={[styles.chip, { borderColor: theme.primaryAction, backgroundColor: theme.surface }]}
                testID="sop-question-another"
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.primaryAction }]}>
                  {t("sop.detail.askAnother")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="sop-ask-unavailable">
              {!askable ? t("sop.detail.askNotReady") : t("sop.detail.askOffline")}
            </Text>
          )}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted, marginTop: 8 }]}>
            {t("sop.detail.citeNote")}
          </Text>
        </View>
      </View>
      {open === "opening" ? <ActivityIndicator style={styles.spinner} color={theme.textMuted} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 40 },
  nav: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  center: { paddingTop: 40, alignItems: "center", flex: 1 },
  body: { paddingHorizontal: 18, gap: 14 },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 36, marginTop: 4 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  metaText: { fontSize: 13, lineHeight: 18 },
  banner: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  docCard: { borderRadius: 14, padding: 14, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  note: { fontSize: 12.5, lineHeight: 18 },
  descCard: { borderRadius: 12, padding: 14 },
  descText: { fontSize: 14.5, lineHeight: 22 },
  chips: { gap: 8 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  chipText: { fontSize: 14.5, lineHeight: 20, fontWeight: "600" },
  spinner: { marginTop: 8 },
});
