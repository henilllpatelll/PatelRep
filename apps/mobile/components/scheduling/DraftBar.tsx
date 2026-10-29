import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { DraftCounts } from "@/lib/scheduling/draftOverlay";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  /** null = the drafts could not be read (said so; never shown as "no draft"). */
  counts: DraftCounts | null;
  loadFailed: boolean;
  /** The Week is drawing the pending changes over the published schedule. */
  previewing: boolean;
  canPreview: boolean;
  /** New shifts and edits go to the draft (true) or apply to the live schedule at once (false). */
  planInDraft: boolean;
  isOnline: boolean;
  onTogglePreview: () => void;
  onPlanInDraft: (value: boolean) => void;
  onReview: () => void;
  onDiscard: () => void;
  onHistory: () => void;
  onRetry: () => void;
  t: Translate;
}

/**
 * The draft status of the schedule. Employees see published shifts only; everything staged here is invisible to them until it is
 * published. Wording is exact: a draft is "not published", never "saved" or "sent".
 */
export function DraftBar({ counts, loadFailed, previewing, canPreview, planInDraft, isOnline, onTogglePreview, onPlanInDraft, onReview, onDiscard, onHistory, onRetry, t }: Props) {
  const theme = useTheme();
  const total = counts?.total ?? 0;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: total > 0 ? theme.status.pickupLine : theme.borderSubtle }]} testID="draft-bar">
      {loadFailed ? (
        <View style={styles.row}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.flex, { color: theme.textPrimary }]} testID="draft-bar-failed">
            {t("teamSchedule.publish.bar.failed")}
          </Text>
          <Button label={t("common.retry")} size="sm" variant="ghost" onPress={onRetry} testID="draft-bar-retry" />
        </View>
      ) : total > 0 && counts ? (
        <View style={styles.stack} testID="draft-bar-active">
          <View style={styles.row}>
            <Ionicons name="create-outline" size={18} color={theme.status.pickup} />
            <View style={styles.flex}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
                {t("teamSchedule.publish.bar.title", { count: total })}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {t("teamSchedule.publish.bar.breakdown", { created: counts.created, changed: counts.changed, cancelled: counts.cancelled })}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {t("teamSchedule.publish.bar.hidden")}
              </Text>
            </View>
          </View>
          <View style={styles.buttons}>
            <View style={styles.cell}>
              <Button label={t("teamSchedule.publish.bar.review")} icon="document-text-outline" onPress={onReview} disabled={!isOnline} testID="draft-bar-review" />
            </View>
            {canPreview ? (
              <View style={styles.cell}>
                <Button
                  label={t(previewing ? "teamSchedule.publish.bar.viewPublished" : "teamSchedule.publish.bar.preview")}
                  icon={previewing ? "eye-off-outline" : "eye-outline"}
                  variant="secondary"
                  onPress={onTogglePreview}
                  testID="draft-bar-preview"
                />
              </View>
            ) : null}
            <View style={styles.cell}>
              <Button label={t("teamSchedule.publish.bar.discard")} icon="trash-outline" variant="secondary" onPress={onDiscard} disabled={!isOnline} testID="draft-bar-discard" />
            </View>
          </View>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="draft-bar-none">
          {t("teamSchedule.publish.bar.none")}
        </Text>
      )}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            label={t(planInDraft ? "teamSchedule.publish.bar.planningDraft" : "teamSchedule.publish.bar.planningNow")}
            icon={planInDraft ? "create-outline" : "flash-outline"}
            size="sm"
            variant="ghost"
            onPress={() => onPlanInDraft(!planInDraft)}
            testID="draft-bar-mode"
          />
        </View>
        <Button label={t("teamSchedule.publish.bar.history")} icon="time-outline" size="sm" variant="ghost" onPress={onHistory} testID="draft-bar-history" />
      </View>
      {!planInDraft ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.status.pickup }]} testID="draft-bar-now-warning">
          {t("teamSchedule.publish.bar.nowWarning")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 12, gap: 8 },
  stack: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { flexGrow: 1, minWidth: 140 },
});
