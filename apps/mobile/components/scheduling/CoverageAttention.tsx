import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { SectionCard, SectionHeader } from "@/components/supervisor/today/TodayBlocks";
import type { CoverageGap } from "@/lib/api/schedulingCoverage";
import type { CoverageState } from "@/lib/scheduling/useCoverageGaps";
import { gapStatusLabel, gapTitle, gapWindow } from "@/lib/scheduling/coverageText";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  /** Open or offered gaps on the selected day. */
  gaps: readonly CoverageGap[];
  status: CoverageState;
  zone: string | null;
  language?: string;
  onFind: (gapId: string) => void;
  onRetry: () => void;
  t: Translate;
}

/**
 * Shifts that still need a person on the selected day, from real call-outs and posted open shifts. If coverage could
 * not be read at all, it says so (coverage is UNKNOWN, not "nothing to cover"); a stale read keeps its rows.
 */
export function CoverageAttention({ gaps, status, zone, language, onFind, onRetry, t }: Props) {
  const theme = useTheme();
  if (status === "failed") {
    return (
      <SectionCard testID="team-schedule-coverage-failed">
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${t("teamSchedule.coverage.attentionFailed")}. ${t("common.retry")}`} style={styles.failed}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.flex, { color: theme.textPrimary }]}>
            {t("teamSchedule.coverage.attentionFailed")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.link, { color: theme.primaryAction }]}>
            {t("common.retry")}
          </Text>
        </Pressable>
      </SectionCard>
    );
  }
  if (gaps.length === 0) return null;
  return (
    <SectionCard testID="team-schedule-coverage">
      <SectionHeader title={t("teamSchedule.coverage.attentionTitle")} />
      <View style={styles.list}>
        {gaps.map((gap) => {
          const title = t("teamSchedule.coverage.needsCover", { shift: gapTitle(gap, t) });
          const who = gap.absentUserName ? t("teamSchedule.coverage.unavailable", { name: gap.absentUserName }) : t("teamSchedule.coverage.openShiftNoCallOut");
          const body = `${gapWindow(gap, zone, language, t)} · ${who}`;
          return (
            <Pressable
              key={gap.id}
              onPress={() => onFind(gap.id)}
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${body}. ${gapStatusLabel(gap, t)}. ${t("teamSchedule.coverage.action.findCoverage")}`}
              testID={`team-schedule-gap-${gap.id}`}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="alert-circle-outline" size={20} color={theme.status.pickup} />
              <View style={styles.flex}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                  {title}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                  {body}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.textPrimary }]}>
                  {gapStatusLabel(gap, t)} · {t("teamSchedule.coverage.action.findCoverage")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  failed: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 14.5, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 18 },
  status: { fontSize: 12.5, fontWeight: "700" },
  link: { fontSize: 14, fontWeight: "700" },
});
