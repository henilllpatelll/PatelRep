import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui/Card";
import { Kicker, LinkButton, MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { AttentionGroup, AttentionPreview, AttentionPreviewItem } from "@/lib/housekeeping/homeState";
import { describeAttentionRow } from "@/lib/housekeeping/homeText";
import type { TextContext } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  preview: AttentionPreview;
  note: HomeModel["supervisorInstruction"];
  t: Translate;
  ctx: TextContext;
  onOpenItem: (row: AttentionPreviewItem) => void;
  /** Opens the full list: the Attention Center when it exists, My Rooms until then. */
  onViewAll: () => void;
  onAcknowledgeNote: () => void;
}

const ICON: Record<AttentionGroup, keyof typeof Ionicons.glyphMap> = {
  critical: "alert-circle",
  actionable: "construct-outline",
  message: "chatbubble-ellipses-outline",
  restricted: "lock-closed-outline",
  info: "information-circle-outline",
};

/**
 * A short preview of what needs the person, with the rest counted, never
 * dropped. Work they can resolve ranks above rooms they can only wait on, and
 * the group icon says which is which without relying on colour.
 */
export function NeedsAttentionPreview({ preview, note, t, ctx, onOpenItem, onViewAll, onAcknowledgeNote }: Props) {
  const theme = useTheme();
  if (preview.total === 0) return null;

  const tone: Record<AttentionGroup, string> = {
    critical: theme.status.dirty,
    actionable: theme.status.pickup,
    message: theme.status.clean,
    restricted: theme.textMuted,
    info: theme.textMuted,
  };

  return (
    <Card style={styles.card} testID="needs-attention">
      <View style={styles.header}>
        <Kicker>{t("home.attention.kicker")}</Kicker>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]}>
          {preview.total}
        </Text>
      </View>

      {preview.shown.map((row) => {
        const copy = describeAttentionRow(row, note, t, ctx);
        const isMessage = row.item.kind === "supervisor_message";
        return (
          <View key={row.item.id} style={[styles.rowWrap, { borderTopColor: theme.borderSubtle }]}>
            <Pressable
              onPress={() => onOpenItem(row)}
              accessibilityRole="button"
              accessibilityLabel={[copy.title, copy.detail].filter(Boolean).join(". ")}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}
              testID={`attention-${row.item.id}`}
            >
              <Ionicons name={ICON[row.group]} size={20} color={tone[row.group]} />
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
                  {copy.title}
                </Text>
                {copy.detail ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={2}>
                    {copy.detail}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </Pressable>
            {isMessage ? (
              <LinkButton label={t("home.needsYou.gotIt")} onPress={onAcknowledgeNote} testID="attention-got-it" />
            ) : null}
          </View>
        );
      })}

      {preview.remaining > 0 ? (
        <LinkButton
          label={t("home.attention.viewAll", { count: preview.total })}
          icon="arrow-forward"
          onPress={onViewAll}
          testID="attention-view-all"
          accessibilityLabel={t("home.attention.viewAllA11y", { count: preview.remaining })}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, gap: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6 },
  count: { fontSize: 12, fontWeight: "800" },
  rowWrap: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { minHeight: MIN_TARGET + 8, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  detail: { fontSize: 13, lineHeight: 18 },
});
