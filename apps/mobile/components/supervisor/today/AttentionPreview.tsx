import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { LinkAction, SectionCard, SectionHeader, Skeleton, UnavailableBlock } from "@/components/supervisor/today/TodayBlocks";
import { selectAttentionPreview, type SupervisorAttention } from "@/lib/housekeeping/supervisorAttention";
import { isVerified, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { describeAttention } from "@/lib/housekeeping/supervisorTodayView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const ATTENTION_PREVIEW_LIMIT = 3;

interface Props {
  attention: SupervisorAttention;
  /** The two sources a "nothing needs attention" claim rests on. */
  board: SourceState<unknown>;
  blockedTasks: SourceState<unknown>;
  zone: string | null | undefined;
  language: string;
  t: Translate;
  onOpen: (pathname: string) => void;
  onRetry: () => void;
  /** Wired up with the Attention Center (Phase 3). Without it, no "View all" is shown — never a dead link. */
  onViewAll?: () => void;
}

export function AttentionPreview({ attention, board, blockedTasks, zone, language, t, onOpen, onRetry, onViewAll }: Props) {
  const theme = useTheme();
  const preview = useMemo(() => selectAttentionPreview(attention, ATTENTION_PREVIEW_LIMIT), [attention]);
  const rows = useMemo(
    () =>
      preview.items
        .map((item) => describeAttention(item, { zone, language, someone: t("supervisorToday.attention.someone") }))
        .filter((row): row is NonNullable<typeof row> => row !== null),
    [preview.items, zone, language, t],
  );
  const loading = board.status === "loading" || blockedTasks.status === "loading";
  const verified = isVerified(board) && isVerified(blockedTasks);
  const stale = board.status === "stale" || blockedTasks.status === "stale";
  const incomplete = attention.unverified.length > 0;
  const severityColor = { critical: theme.status.dirty, high: theme.status.pickup, normal: theme.borderSubtle } as const;

  let body;
  if (rows.length > 0) {
    body = (
      <View style={styles.rows}>
        {rows.map((row) => {
          const title = t(row.title.key, row.title.params);
          const subtitle = t(row.subtitle.key, row.subtitle.params);
          const urgency =
            row.severity === "critical" ? t("supervisorToday.attention.urgent") : row.severity === "high" ? t("supervisorToday.attention.high") : null;
          return (
            <Pressable
              key={row.id}
              onPress={() => onOpen(row.pathname)}
              testID={`today-attention-row-${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={[urgency, title, subtitle].filter(Boolean).join(". ")}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.surfaceMuted, borderLeftColor: severityColor[row.severity] },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons name={row.icon} size={20} color={row.severity === "normal" ? theme.textSecondary : severityColor[row.severity]} />
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                  {title}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              </View>
              {row.severity === "critical" ? (
                <View style={[styles.chip, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
                  <Text maxFontSizeMultiplier={1.2} style={[styles.chipText, { color: theme.status.dirty }]}>
                    {t("supervisorToday.attention.urgent")}
                  </Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </Pressable>
          );
        })}
        {preview.hiddenCount > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.textMuted }]} testID="today-attention-more">
            {t("supervisorToday.attention.more", { count: preview.hiddenCount })}
          </Text>
        ) : null}
        {incomplete ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.status.pickup }]} testID="today-attention-partial">
            {t("supervisorToday.status.partial")}
          </Text>
        ) : null}
      </View>
    );
  } else if (loading) {
    body = (
      <View style={styles.rows} testID="today-attention-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    );
  } else if (!verified && !stale) {
    body = (
      <UnavailableBlock
        testID="today-attention-incomplete"
        title={t("supervisorToday.attention.incomplete")}
        hint={t("supervisorToday.attention.incompleteHint")}
        retryLabel={t("supervisorToday.status.retry")}
        onRetry={onRetry}
      />
    );
  } else if (incomplete || stale) {
    body = (
      <View style={styles.caughtUp} testID="today-attention-stale-empty">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caughtTitle, { color: theme.textPrimary }]}>
          {t("supervisorToday.attention.staleEmpty")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]}>
          {t("supervisorToday.attention.staleEmptyHint")}
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.caughtUp} testID="today-attention-empty">
        <Ionicons name="checkmark-circle-outline" size={26} color={theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caughtTitle, { color: theme.textPrimary }]}>
          {t("supervisorToday.attention.caughtUp")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary, textAlign: "center" }]}>
          {t("supervisorToday.attention.caughtUpHint")}
        </Text>
      </View>
    );
  }

  return (
    <SectionCard testID="today-attention">
      <SectionHeader
        title={t("supervisorToday.attention.title")}
        right={onViewAll ? <LinkAction label={t("supervisorToday.attention.viewAll")} onPress={onViewAll} testID="today-attention-viewall" /> : undefined}
      />
      {body}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TARGET + 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: R.md,
    borderLeftWidth: 4,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "700" },
  rowSub: { fontSize: 13, lineHeight: 18 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "800" },
  more: { fontSize: 12.5, fontWeight: "600", paddingHorizontal: 4 },
  caughtUp: { alignItems: "center", gap: 6, paddingVertical: 6 },
  caughtTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
});
