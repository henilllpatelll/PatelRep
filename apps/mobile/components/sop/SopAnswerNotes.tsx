import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { SopAnswerMeta } from "@/lib/ai/contract";
import { sourceHref } from "@/lib/sop/citations";
import { pushHref } from "@/lib/sop/navigate";

const MAX_FONT_SCALE = 1.6;

interface Props {
  sop: SopAnswerMeta;
  /** Whether the answer arrived with citations (a grounded answer always has them). */
  hasSources: boolean;
  palette?: Palette;
  /** The language the app is set to; an answer written in the other one is labelled as AI-translated. */
  appLanguage: "en" | "es";
  onOpenHref?: (href: string) => void;
  /** Put the cursor back in the composer for a follow-up question. */
  onFollowUp?: () => void;
}

/**
 * What a procedure answer stands on, said plainly next to it: written from cited procedures (or why it could not
 * be), the language label when the answer is a translation, a prominent pointer to the original for risky topics,
 * and the approved documents worth opening when there was no verified answer. Wording only; it changes nothing.
 */
export function SopAnswerNotes({ sop, hasSources, palette, appLanguage, onOpenHref, onFollowUp }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const open = (href: string) => (onOpenHref ? onOpenHref(href) : pushHref(href));

  const translated = sop.grounded && sop.answerLanguage != null && sop.answerLanguage !== appLanguage;

  return (
    <View style={styles.wrap} testID="sop-answer-notes">
      {sop.grounded ? (
        <View style={styles.line}>
          <Ionicons name="shield-checkmark-outline" size={15} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.text}>
            {hasSources ? t("sop.notes.grounded") : t("sop.notes.groundedNoSources")}
          </Text>
        </View>
      ) : (
        <View style={[styles.line, styles.warn]} accessibilityRole="alert" testID="sop-answer-ungrounded">
          <Ionicons name="alert-circle-outline" size={15} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.text}>
            {t(`sop.notes.reason.${sop.reason ?? "insufficient"}`)}
          </Text>
        </View>
      )}

      {translated ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted} testID="sop-answer-translated">
          {t("sop.notes.translated", { language: t(`sop.notes.language.${sop.answerLanguage}`) })}
        </Text>
      ) : null}

      {sop.highRisk ? (
        <View style={[styles.line, styles.warn]} testID="sop-answer-high-risk">
          <Ionicons name="warning-outline" size={15} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.text}>
            {t("sop.notes.highRisk")}
          </Text>
        </View>
      ) : null}

      {!sop.grounded && sop.related.length > 0 ? (
        <View style={styles.related}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
            {t("sop.notes.related")}
          </Text>
          {sop.related.map((doc) => {
            const href = sourceHref({ documentId: doc.id, page: null });
            return href ? (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={t("sop.citation.viewA11y", { title: doc.title })}
                onPress={() => open(href)}
                style={styles.relatedRow}
                testID="sop-related-document"
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText} numberOfLines={2}>
                  {doc.title}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.ai.primary} />
              </Pressable>
            ) : null;
          })}
        </View>
      ) : null}

      {onFollowUp ? (
        <Pressable accessibilityRole="button" onPress={onFollowUp} style={styles.followUp} testID="sop-follow-up">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText}>
            {t("sop.notes.followUp")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Palette) {
  return StyleSheet.create({
    wrap: { marginTop: 4, marginBottom: 2, paddingHorizontal: 2, gap: 6 },
    line: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    warn: {
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    text: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.textSecondary },
    muted: { fontSize: 12.5, lineHeight: 17, color: theme.textSecondary },
    related: { gap: 2 },
    relatedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 8 },
    followUp: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
    linkText: { flexShrink: 1, fontSize: 13.5, fontWeight: "800", color: theme.ai.primary },
  });
}
