import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { issueTitle, issueWhat } from "@/components/engineering/sync/SyncIssueSheet";
import type { SyncIssue } from "@/lib/engineering/syncStatusModel";
import { MIN_TOUCH, SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

/** One thing that needs the person. The whole row opens the details sheet; nothing is resolved by tapping it. */
export function SyncIssueRow({ issue, onOpen }: { issue: SyncIssue; onOpen: (issue: SyncIssue) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const title = issueTitle(issue, t);
  const what = issueWhat(issue, t);
  return (
    <Pressable
      onPress={() => onOpen(issue)}
      accessibilityRole="button"
      accessibilityLabel={t("engineeringSync.issueA11y", { title, what })}
      accessibilityHint={t("engineeringSync.openIssueHint")}
      style={({ pressed }) => [styles.row, { borderColor: theme.status.dirtyLine, backgroundColor: pressed ? theme.surfaceMuted : theme.surface }]}
      testID={`esync-issue-${issue.id}`}
    >
      <Ionicons name="alert-circle" size={22} color={theme.status.dirty} />
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={3} style={[styles.what, { color: theme.status.dirty }]}>
          {what}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: 12, padding: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "700" },
  what: { fontSize: 13, lineHeight: 18 },
});
