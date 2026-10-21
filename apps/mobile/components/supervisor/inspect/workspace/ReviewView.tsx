import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { ReviewModel } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * A read-only look at the findings so far. Nothing here can be submitted, approved or sent back; it exists so the
 * supervisor can see what they have recorded and what is still outstanding before going on. Leaving it changes
 * nothing.
 */
export function ReviewView({ model, room, t }: { model: ReviewModel; room: string; t: Translate }) {
  const theme = useTheme();
  const counts = [
    { key: "pass", value: model.passed, fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
    { key: "fail", value: model.failed, fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
    { key: "na", value: model.na, fg: theme.textPrimary, bg: theme.surfaceMuted, line: theme.border },
  ] as const;
  return (
    <View style={styles.wrap} testID="workspace-review-view">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
        {t("inspect.workspace.reviewScreen.title", { room })}
      </Text>
      <View style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} testID="workspace-review-readonly">
        <Ionicons name="eye-outline" size={18} color={theme.textSecondary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
          {t("inspect.workspace.reviewScreen.readOnly")}
        </Text>
      </View>

      <View style={styles.counts}>
        {counts.map((count) => (
          <View
            key={count.key}
            style={[styles.count, { backgroundColor: count.bg, borderColor: count.line }]}
            accessible
            accessibilityLabel={t(`inspect.workspace.reviewScreen.count.${count.key}A11y`, { count: count.value })}
            testID={`workspace-review-count-${count.key}`}
          >
            <Text maxFontSizeMultiplier={1.3} style={[styles.countValue, { color: count.fg }]}>
              {count.value}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.countLabel, { color: theme.textSecondary }]}>
              {t(`inspect.workspace.answer.${count.key}`)}
            </Text>
          </View>
        ))}
      </View>

      {model.failures.length > 0 ? (
        <Section title={t("inspect.workspace.reviewScreen.issues")} testID="workspace-review-issues">
          {model.failures.map((failure) => (
            <View key={failure.item.id} style={[styles.row, { borderColor: theme.status.dirtyLine, backgroundColor: theme.surface }]} testID={`workspace-review-issue-${failure.item.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                {failure.item.description}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                {failure.item.section}
              </Text>
              {failure.note ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]}>
                  {failure.note}
                </Text>
              ) : null}
              {failure.needsDetails ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.flag, { color: theme.status.dirty }]} testID={`workspace-review-needs-${failure.item.id}`}>
                  {failure.photoMissing ? t("inspect.workspace.reviewScreen.needsPhoto") : t("inspect.workspace.reviewScreen.needsDetails")}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="workspace-review-no-issues">
          {t("inspect.workspace.reviewScreen.noIssues")}
        </Text>
      )}

      {model.naItems.length > 0 ? (
        <Section title={t("inspect.workspace.reviewScreen.notApplicable")} testID="workspace-review-na">
          {model.naItems.map(({ item, note }) => (
            <View key={item.id} style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                {item.description}
              </Text>
              {note ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]}>
                  {note}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}

      {model.optionalUnreviewed > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="workspace-review-optional">
          {t("inspect.workspace.reviewScreen.optionalLeft", { count: model.optionalUnreviewed })}
        </Text>
      ) : null}

      {model.outstanding > 0 ? (
        <View style={[styles.notice, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert" testID="workspace-review-outstanding">
          <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
            {t("inspect.workspace.reviewScreen.outstanding", { count: model.outstanding })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, testID, children }: { title: string; testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, padding: 12 },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  counts: { flexDirection: "row", gap: 8 },
  count: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 },
  countValue: { fontSize: 26, lineHeight: 30, fontWeight: "800" },
  countLabel: { fontSize: 12, fontWeight: "700" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  row: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  flag: { fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 2 },
  empty: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
