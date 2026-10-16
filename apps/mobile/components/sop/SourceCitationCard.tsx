import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { AssistantSource } from "@/lib/ai/contract";
import { citationDetail, sourceHref } from "@/lib/sop/citations";
import { pushHref } from "@/lib/sop/navigate";

const MAX_FONT_SCALE = 1.6;

interface Props {
  source: AssistantSource;
  palette?: Palette;
  /** Where "View source procedure" goes. The compact assistant closes itself first; default is a plain push. */
  onOpenHref?: (href: string) => void;
}

/**
 * One cited procedure: its real title, then only the version, section and page the server actually returned,
 * the passage the answer rests on, and a way to open the document. A source with no usable document id is shown
 * as text and has no link. There is no confidence number: a similarity score is not evidence.
 */
export function SourceCitationCard({ source, palette, onOpenHref }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const href = sourceHref(source);
  const detail = citationDetail(source, t);
  const open = () => {
    if (!href) return;
    if (onOpenHref) onOpenHref(href);
    else pushHref(href);
  };

  return (
    <View style={styles.card} testID="source-citation">
      <View style={styles.head}>
        <Ionicons name="document-text-outline" size={16} color={theme.textSecondary} />
        <View style={styles.headText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title} numberOfLines={3} accessibilityRole="header">
            {source.title}
          </Text>
          {detail ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detail} testID="source-citation-detail">
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {source.excerpt ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.excerpt} numberOfLines={3}>
          {source.excerpt}
        </Text>
      ) : null}
      {href ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sop.citation.viewA11y", { title: source.title })}
          onPress={open}
          style={styles.link}
          testID="source-citation-open"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText}>
            {t("sop.citation.view")}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.ai.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Palette) {
  return StyleSheet.create({
    card: {
      padding: 12,
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      gap: 6,
    },
    head: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    headText: { flex: 1, gap: 2 },
    title: { fontSize: 14, lineHeight: 19, fontWeight: "700", color: theme.textPrimary },
    detail: { fontSize: 12.5, lineHeight: 17, color: theme.textSecondary },
    excerpt: { fontSize: 13, lineHeight: 18, color: theme.textSecondary },
    link: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 44, gap: 4 },
    linkText: { fontSize: 13.5, fontWeight: "800", color: theme.ai.primary },
  });
}
