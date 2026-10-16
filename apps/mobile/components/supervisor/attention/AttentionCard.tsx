import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { AttentionCardView } from "@/lib/housekeeping/supervisorAttentionCenter";
import { translateParams } from "@/lib/housekeeping/supervisorAttentionCenter";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  card: AttentionCardView;
  /** "3:05 PM" for a stale card; null when the card is verified. */
  verifiedAt: string | null;
  t: Translate;
  onPress: (id: string) => void;
}

/**
 * One attention item. Severity is a word as well as a colour; the whole card is one button that opens the
 * detail sheet (it never acts on the room by itself).
 */
function AttentionCardBase({ card, verifiedAt, t, onPress }: Props) {
  const theme = useTheme();
  const accent = { critical: theme.status.dirty, high: theme.status.pickup, normal: theme.borderSubtle }[card.severity];
  const soft = { critical: theme.status.dirtySoft, high: theme.status.pickupSoft, normal: theme.surfaceMuted }[card.severity];
  const line = { critical: theme.status.dirtyLine, high: theme.status.pickupLine, normal: theme.border }[card.severity];
  const ink = card.severity === "normal" ? theme.textSecondary : accent;
  const title = t(card.title.key, translateParams(t, card.title.params));
  const subtitle = t(card.subtitle.key, translateParams(t, card.subtitle.params));
  const severity = t(card.severityLabelKey);
  const category = t(`supervisorAttention.category.${card.category}`);
  const stale = verifiedAt ? t("supervisorAttention.lastVerified", { time: verifiedAt }) : null;

  return (
    <Pressable
      onPress={() => onPress(card.id)}
      accessibilityRole="button"
      accessibilityLabel={[t("supervisorAttention.cardA11y", { severity, title, subtitle }), stale].filter(Boolean).join(" ")}
      testID={`attention-card-${card.id}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderLeftColor: accent },
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: soft, borderColor: line }]}>
        <Ionicons name={card.icon} size={20} color={ink} />
      </View>
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
          {subtitle}
        </Text>
        <View style={styles.meta}>
          <View style={[styles.chip, { backgroundColor: soft, borderColor: line }]} testID={`attention-severity-${card.id}`}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, { color: ink }]}>
              {severity}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={[styles.category, { color: theme.textMuted }]}>
            {category}
          </Text>
        </View>
        {stale ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stale, { color: theme.status.pickup }]} testID={`attention-stale-${card.id}`}>
            {stale}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

export const AttentionCard = memo(AttentionCardBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TARGET + 24,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: R.lg,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15.5, fontWeight: "700", lineHeight: 21 },
  subtitle: { fontSize: 13.5, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 3 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  chipText: { fontSize: 11.5, fontWeight: "800" },
  category: { fontSize: 12, fontWeight: "600" },
  stale: { fontSize: 12, fontWeight: "600", marginTop: 2 },
});
