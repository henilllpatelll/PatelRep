import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import type { TranslationLanguage } from "@/lib/api/translation";
import type { Task } from "@/lib/api/tasks";
import { useTaskTranslation } from "@/lib/tasks/useTaskTranslation";

/* "Translate instructions" on the task detail. The person picks the language; nothing is fetched until they do.
   The translation is wording written by AI to help someone read the task: the original stays on screen above it,
   can be shown instead of the translation at any time, and the task itself (its status, text and room) is never
   changed. If a translation cannot be made, the original is simply all there is, and the task can still be done. */

const LANGUAGES: TranslationLanguage[] = ["en", "es"];

interface Props {
  task: Pick<Task, "id" | "title" | "description">;
  offline: boolean;
}

export function TaskTranslation({ task, offline }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { status, language, result, translate, reset } = useTaskTranslation(task, offline);
  const [showOriginal, setShowOriginal] = useState(false);

  const pick = (target: TranslationLanguage) => {
    setShowOriginal(false);
    if (language === target && status === "ready") {
      reset();
      return;
    }
    void translate(target);
  };

  const shown = result ? (showOriginal ? result.original : result.translated) : null;
  const languageName = language ? t(`tasks.hk.translate.language.${language}`) : "";

  return (
    <View style={styles.section} testID="task-translate">
      <View style={styles.titleRow}>
        <Ionicons name="language-outline" size={14} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textMuted }]}>
          {t("tasks.hk.translate.title")}
        </Text>
      </View>

      <View style={styles.choices}>
        {LANGUAGES.map((code) => {
          const selected = language === code && status !== "idle";
          return (
            <Pressable
              key={code}
              onPress={() => pick(code)}
              accessibilityRole="button"
              accessibilityState={{ selected, busy: selected && status === "loading" }}
              accessibilityLabel={t("tasks.hk.translate.into", { language: t(`tasks.hk.translate.language.${code}`) })}
              style={[
                styles.choice,
                { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.surfaceSubtle : theme.surface },
              ]}
              testID={`task-translate-${code}`}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.choiceText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                {t(`tasks.hk.translate.language.${code}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {status === "loading" ? (
        <View style={styles.row} accessibilityLiveRegion="polite" testID="task-translate-loading">
          <ActivityIndicator color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
            {t("tasks.hk.translate.loading")}
          </Text>
        </View>
      ) : null}

      {status === "offline" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.note, { color: theme.textMuted }]} testID="task-translate-offline">
          {t("tasks.hk.translate.offline")}
        </Text>
      ) : null}

      {status === "failed" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.note, { color: theme.textMuted }]} testID="task-translate-failed">
          {t("tasks.hk.translate.failed")}
        </Text>
      ) : null}

      {status === "ready" && shown ? (
        <View
          style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          accessibilityLiveRegion="polite"
          testID="task-translate-result"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badge, { color: theme.textMuted }]}>
            {showOriginal ? t("tasks.hk.translate.originalBadge") : t("tasks.hk.translate.badge", { language: languageName })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.shownTitle, { color: theme.textPrimary }]} testID="task-translate-title">
            {shown.title}
          </Text>
          {shown.description ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.shownBody, { color: theme.textPrimary }]} testID="task-translate-body">
              {shown.description}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
            {t("tasks.hk.translate.aiNote")}
          </Text>
          <Pressable
            onPress={() => setShowOriginal((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={t(showOriginal ? "tasks.hk.translate.showTranslation" : "tasks.hk.translate.showOriginal")}
            style={styles.link}
            testID="task-translate-toggle"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
              {t(showOriginal ? "tasks.hk.translate.showTranslation" : "tasks.hk.translate.showOriginal")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  choices: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  choiceText: { fontSize: 14.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  badge: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  shownTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  shownBody: { fontSize: 14.5, lineHeight: 21 },
  note: { fontSize: 12.5, lineHeight: 18 },
  link: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  linkText: { fontSize: 14, fontWeight: "800" },
});
