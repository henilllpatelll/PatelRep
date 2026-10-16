import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { documentStatus, freshnessOf, searchDocuments, sortDocuments, suggestedQuestions } from "@/lib/sop/library";
import { useAskAboutSop } from "@/lib/sop/useAskAboutSop";
import { useSopLibrary } from "@/lib/sop/useSopLibrary";
import { useTheme } from "@/lib/theme/useTheme";
import { isSpeechAvailable } from "@/lib/voice/speechModule";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.6;
const MAX_QUESTION = 500;

/** The hotel's procedures: ask a question in your own words, or find a document by name or category. */
export default function SopLibraryScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const assistant = useAssistantOptional();
  const ask = useAskAboutSop();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const role = user?.effective_role ?? user?.role;
  const { docs, loading, refreshing, failed, fromCache, savedAt, refresh } = useSopLibrary();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(docs.map((doc) => doc.category).filter((c): c is string => !!c))).sort(), [docs]);
  const visible = useMemo(() => {
    const byCategory = category ? docs.filter((doc) => doc.category === category) : docs;
    return sortDocuments(searchDocuments(byCategory, query));
  }, [docs, category, query]);
  const suggestions = useMemo(() => (isOnline ? suggestedQuestions(docs) : []), [docs, isOnline]);

  const trimmed = query.trim();
  const canAsk = isOnline && trimmed.length > 0;
  const submitQuestion = () => {
    if (!canAsk) return;
    ask({ text: trimmed.slice(0, MAX_QUESTION) });
    setQuery("");
  };
  const speak = () => {
    if (!assistant) return;
    assistant.setPendingHint("sop_query");
    assistant.openAssistant({ contextType: "general", voice: true });
  };
  const micVisible = !!assistant && isAssistantRole(role) && isSpeechAvailable();

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/home" as never));
  const freshness = savedAt ? freshnessOf(savedAt) : null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primaryAction} />}
    >
      <View style={styles.nav}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} style={styles.backButton} testID="sop-back">
          <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.textMuted }]}>
          {t("sop.kicker")}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
        {t("sop.hero")}
      </Text>

      <Card style={styles.askCard} testID="sop-ask-card">
        <View style={styles.askHead}>
          <Ionicons name="sparkles-outline" size={16} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.askTitle, { color: theme.textPrimary }]}>
            {t("sop.ask.title")}
          </Text>
        </View>
        <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <TextInput
            value={query}
            onChangeText={(text) => setQuery(text.slice(0, MAX_QUESTION))}
            placeholder={t("sop.ask.placeholder")}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t("sop.ask.inputA11y")}
            returnKeyType="send"
            onSubmitEditing={submitQuestion}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.input, { color: theme.textPrimary }]}
            testID="sop-ask-input"
          />
          {micVisible ? (
            <Pressable onPress={speak} accessibilityRole="button" accessibilityLabel={t("sop.ask.voice")} style={styles.iconButton} testID="sop-ask-voice">
              <Ionicons name="mic-outline" size={20} color={theme.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={submitQuestion}
            disabled={!canAsk}
            accessibilityRole="button"
            accessibilityLabel={t("sop.ask.send")}
            accessibilityState={{ disabled: !canAsk }}
            style={[styles.iconButton, { opacity: canAsk ? 1 : 0.4 }]}
            testID="sop-ask-send"
          >
            <Ionicons name="arrow-up-circle" size={26} color={theme.primaryAction} />
          </Pressable>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="sop-ask-hint">
          {isOnline ? t("sop.ask.hint") : t("sop.ask.offline")}
        </Text>
      </Card>

      {fromCache ? (
        <View style={[styles.banner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} accessibilityRole="alert" testID="sop-cache-banner">
          <Ionicons name="cloud-offline-outline" size={16} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
            {freshness ? t(`sop.cache.saved_${freshness.unit}`, { value: freshness.value }) : t("sop.cache.saved_justNow")} {t("sop.cache.reconnect")}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <StateBlock status="loading" style={styles.center} />
      ) : failed ? (
        <StateBlock
          status="error"
          errorIcon="cloud-offline-outline"
          errorMessage={isOnline ? t("sop.errorLoad") : t("sop.errorOffline")}
          onRetry={() => void refresh()}
          retryLabel={t("common.retry")}
          style={styles.center}
        />
      ) : (
        <>
          {suggestions.length > 0 ? (
            <View>
              <SectionLabel>{t("sop.suggest.title")}</SectionLabel>
              <View style={styles.chips}>
                {suggestions.map((item) => (
                  <Pressable
                    key={item.documentId}
                    onPress={() => ask({ documentId: item.documentId, title: item.title, text: t("sop.suggest.keyPoints", { title: item.title }) })}
                    accessibilityRole="button"
                    accessibilityLabel={t("sop.suggest.keyPoints", { title: item.title })}
                    style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surface }]}
                    testID="sop-suggestion"
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                      {t("sop.suggest.keyPoints", { title: item.title })}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("sop.suggest.note")}
              </Text>
            </View>
          ) : null}

          <View>
            <SectionLabel hint={String(visible.length)}>{t("sop.approved")}</SectionLabel>

            {categories.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow} keyboardShouldPersistTaps="handled">
                {[null, ...categories].map((name) => {
                  const selected = category === name;
                  return (
                    <Pressable
                      key={name ?? "all"}
                      onPress={() => setCategory(name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.category, { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.surfaceSubtle : theme.surface }]}
                      testID={`sop-category-${name ?? "all"}`}
                    >
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.categoryText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                        {name ?? t("sop.allCategories")}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={styles.rows}>
              {visible.map((doc) => {
                const status = documentStatus(doc);
                const statusText =
                  status.kind === "approved"
                    ? status.version
                      ? t("sop.status.approvedVersion", { version: status.version })
                      : t("sop.status.approved")
                    : null;
                return (
                  <Pressable
                    key={doc.id}
                    onPress={() => router.push(`/(app)/sop/${doc.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={doc.title}
                    accessibilityHint={statusText ?? undefined}
                    testID="sop-row"
                  >
                    <Card style={styles.rowCard}>
                      <Ionicons name="document-text-outline" size={22} color={theme.textMuted} />
                      <View style={styles.rowBody}>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                          {doc.title}
                        </Text>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                          {[doc.category, statusText].filter(Boolean).join(" · ") || t("sop.status.uploaded")}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
                    </Card>
                  </Pressable>
                );
              })}

              {docs.length === 0 ? (
                <StateBlock
                  status="empty"
                  emptyIcon="document-text-outline"
                  emptyTitle={t("sop.empty.title")}
                  emptyBody={t("sop.empty.body")}
                  style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
                />
              ) : visible.length === 0 ? (
                <StateBlock
                  status="empty"
                  emptyIcon="search-outline"
                  emptyTitle={t("sop.noMatch.title", { query: trimmed })}
                  emptyBody={t(isOnline ? "sop.noMatch.bodyAsk" : "sop.noMatch.body")}
                  style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
                />
              ) : null}
            </View>
          </View>

          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.footer, { color: theme.textMuted }]}>
            {t("sop.footer")}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 14, paddingBottom: 40 },
  nav: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: -8 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 36 },
  center: { paddingTop: 40, alignItems: "center" },
  askCard: { borderRadius: 16, padding: 14, gap: 10 },
  askHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  askTitle: { fontSize: 14.5, fontWeight: "700" },
  inputRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingLeft: 12, minHeight: 50 },
  input: { flex: 1, fontSize: 15, minHeight: 48, paddingVertical: 8 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  banner: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  chips: { gap: 8 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  chipText: { fontSize: 14.5, lineHeight: 20, fontWeight: "600" },
  categoryRow: { gap: 8, paddingBottom: 10 },
  category: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, justifyContent: "center" },
  categoryText: { fontSize: 13.5, fontWeight: "700" },
  rows: { gap: 8 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 14, minHeight: 56 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 13, marginTop: 3, lineHeight: 17 },
  empty: { borderWidth: 1, borderRadius: 12, padding: 20 },
  footer: { fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 4 },
});
