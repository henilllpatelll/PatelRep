import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── "N unpublished changes" ───────────────────────────────────────────────
   The Rooms view's only reminder that there is a draft. It says the changes are NOT published, opens the review,
   and — when a publication's outcome is unclear — says that instead, because that is the more important fact. */

export function DraftIndicator({ bulk, t }: { bulk: BulkAssignmentController; t: Translate }) {
  const theme = useTheme();
  const unclear = bulk.publication.lockedToOperation;
  const count = bulk.draft.changeCount;
  if (!unclear && count === 0) return null;
  const label = unclear ? t("assignments.v2.bulk.indicator.unknown") : t("assignments.v2.bulk.indicator.changes", { count });
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={bulk.openReview}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t(unclear ? "assignments.v2.bulk.indicator.unknownHint" : "assignments.v2.bulk.indicator.hint")}
        style={({ pressed }) => [styles.pill, { backgroundColor: theme.surface, borderColor: unclear ? theme.destructiveAction : theme.primaryAction }, pressed && { opacity: 0.85 }]}
        testID="bulk-draft-indicator"
      >
        <Ionicons name={unclear ? "alert-circle-outline" : "create-outline"} size={18} color={unclear ? theme.destructiveAction : theme.primaryAction} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textPrimary }]}>
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: R.lg },
  text: { flex: 1, fontSize: 14.5, fontWeight: "800" },
});
