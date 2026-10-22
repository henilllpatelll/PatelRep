import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { CorrectionPlan } from "@/lib/inspections/correctionPlan";
import type { RecheckStanding, ReviewModel } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** A previously failed item, re-checked: how it stands now (never assumed). */
export interface RecheckLine {
  id: string;
  label: string;
  standing: RecheckStanding;
}

/**
 * The final look before the inspection is sent. The findings are read-only here (change them in the checklist); the
 * only things editable are the inspector's overall note and, through the footer, the decision to send. Nothing is
 * approved by looking at this: the room is approved only when the server records a pass. An inspection with an issue
 * is never described as approved - the room stays blocked until a passing reinspection.
 */
export function ReviewView({
  model,
  plan,
  room,
  outcome,
  notes,
  notesEditable,
  recheck,
  t,
  onNotes,
  onGoToItem,
  onOpenCorrection,
}: {
  model: ReviewModel;
  plan: CorrectionPlan | null;
  room: string;
  /** What the checklist as answered would record. */
  outcome: "passed" | "failed";
  notes: string;
  notesEditable: boolean;
  /** Present on a reinspection: the earlier failures, and whether each is now fixed. */
  recheck: readonly RecheckLine[];
  t: Translate;
  onNotes: (text: string) => void;
  /** Return to the checklist at this item. */
  onGoToItem: (itemId: string) => void;
  onOpenCorrection: () => void;
}) {
  const theme = useTheme();
  const missingEvidence = model.failures.filter((failure) => failure.photoMissing).length;
  const counts = [
    { key: "pass", value: model.passed, fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
    { key: "fail", value: model.failed, fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
    { key: "na", value: model.na, fg: theme.textPrimary, bg: theme.surfaceMuted, line: theme.border },
    { key: "missing", value: missingEvidence, fg: missingEvidence > 0 ? theme.status.pickup : theme.textPrimary, bg: theme.surfaceMuted, line: missingEvidence > 0 ? theme.status.pickupLine : theme.border },
  ] as const;
  const owner = plan?.owner.name ? t("inspect.workspace.correction.summary", { name: plan.owner.name }) : t("inspect.workspace.correction.summaryUnknown");
  return (
    <View style={styles.wrap} testID="workspace-review-view">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
        {t("inspect.workspace.reviewScreen.title", { room })}
      </Text>
      {outcome === "passed" ? (
        <View style={[styles.notice, { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine }]} testID="workspace-review-passed">
          <Ionicons name="checkmark-circle-outline" size={18} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeTitle, styles.flex, { color: theme.textPrimary }]}>
            {t("inspect.workspace.reviewScreen.passedBanner")}
          </Text>
        </View>
      ) : null}

      {model.failed > 0 ? (
        <View style={[styles.notice, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert" testID="workspace-review-blocked">
          <Ionicons name="close-circle-outline" size={18} color={theme.status.dirty} />
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeTitle, { color: theme.textPrimary }]}>
              {t("inspect.workspace.reviewScreen.blockedTitle")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
              {t("inspect.workspace.reviewScreen.blockedBody")}
            </Text>
          </View>
        </View>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reviewed, { color: theme.textSecondary }]} testID="workspace-review-reviewed">
        {t("inspect.workspace.reviewScreen.reviewed")}: {t("inspect.workspace.reviewScreen.reviewedCount", { reviewed: model.reviewed, total: model.total })}
      </Text>

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
              {t(count.key === "missing" ? "inspect.workspace.reviewScreen.count.missing" : `inspect.workspace.answer.${count.key}`)}
            </Text>
          </View>
        ))}
      </View>

      {model.failures.length > 0 ? (
        <Section title={t("inspect.workspace.reviewScreen.issues")} testID="workspace-review-issues">
          {model.failures.map((failure) => (
            <View key={failure.item.id} style={[styles.row, { borderColor: theme.status.dirtyLine, backgroundColor: theme.surface }]} testID={`workspace-review-issue-${failure.item.id}`}>
              <View style={styles.rowTop}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, styles.flex, { color: theme.textPrimary }]}>
                  {failure.item.description}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.severity, { color: failure.severity ? theme.textPrimary : theme.status.pickup, borderColor: failure.severity ? theme.border : theme.status.pickupLine }]}
                  testID={`workspace-review-severity-${failure.item.id}`}
                >
                  {failure.severity ? t(`inspect.workspace.issue.severity.${failure.severity}`) : t("inspect.workspace.item.severityNeeded")}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                {failure.item.section}
              </Text>
              {failure.note ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} testID={`workspace-review-note-${failure.item.id}`}>
                  {failure.note}
                </Text>
              ) : null}
              {failure.hasPhoto ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} testID={`workspace-review-photo-${failure.item.id}`}>
                  {t("inspect.workspace.reviewScreen.photoAttached")}
                </Text>
              ) : null}
              {failure.needsDetails ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.flag, { color: theme.status.dirty }]} testID={`workspace-review-needs-${failure.item.id}`}>
                  {failure.photoFileLost
                    ? t("inspect.workspace.reviewScreen.photoLost")
                    : failure.photoMissing
                      ? t("inspect.workspace.reviewScreen.needsPhoto")
                      : failure.needsSeverity
                        ? t("inspect.workspace.reviewScreen.severityNeeded")
                        : t("inspect.workspace.reviewScreen.needsDetails")}
                </Text>
              ) : null}
              <View style={styles.rowAction}>
                <Button
                  label={t("inspect.workspace.reviewScreen.goToItem")}
                  accessibilityLabel={t("inspect.workspace.reviewScreen.goToItemA11y", { item: failure.item.description })}
                  variant="secondary"
                  size="md"
                  onPress={() => onGoToItem(failure.item.id)}
                  testID={`workspace-review-goto-${failure.item.id}`}
                />
              </View>
            </View>
          ))}
        </Section>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="workspace-review-no-issues">
          {t("inspect.workspace.reviewScreen.noIssues")}
        </Text>
      )}

      {plan ? (
        <Section title={t("inspect.workspace.reviewScreen.correction")} testID="workspace-review-correction">
          <View style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} testID="workspace-review-correction-owner">
              {owner}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} testID="workspace-review-correction-status">
              {t("inspect.workspace.correction.status")}
            </Text>
            <View style={styles.rowAction}>
              <Button
                label={t("inspect.workspace.reviewScreen.correctionDetails")}
                accessibilityLabel={t("inspect.workspace.reviewScreen.correctionDetailsA11y")}
                variant="secondary"
                size="md"
                onPress={onOpenCorrection}
                testID="workspace-review-correction-details"
              />
            </View>
          </View>
        </Section>
      ) : null}

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

      {recheck.length > 0 ? (
        <Section title={t("inspect.workspace.reviewScreen.recheck")} testID="workspace-review-recheck">
          {recheck.map((line) => (
            <View key={line.id} style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]} accessible accessibilityLabel={`${line.label}. ${t(`inspect.workspace.reviewScreen.standing.${line.standing}`)}`}>
              <View style={styles.rowTop}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, styles.flex, { color: theme.textPrimary }]}>
                  {line.label}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.severity, { color: line.standing === "fixed" ? theme.status.ready : line.standing === "still_failing" ? theme.status.dirty : theme.status.pickup, borderColor: theme.border }]}
                  testID={`workspace-review-standing-${line.id}`}
                >
                  {t(`inspect.workspace.reviewScreen.standing.${line.standing}`)}
                </Text>
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      <Section title={t("inspect.workspace.reviewScreen.notes")} testID="workspace-review-notes">
        <TextInput
          value={notes}
          onChangeText={onNotes}
          editable={notesEditable}
          multiline
          maxLength={500}
          placeholder={t("inspect.workspace.reviewScreen.notesPlaceholder")}
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={t("inspect.workspace.reviewScreen.notes")}
          style={[styles.notesInput, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.surface }]}
          testID="workspace-review-notes-input"
        />
      </Section>

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
  flex: { flex: 1, minWidth: 0 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, padding: 12 },
  noticeTitle: { fontSize: 15, lineHeight: 21, fontWeight: "800" },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  reviewed: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  count: { flexGrow: 1, flexBasis: "22%", minWidth: 72, borderWidth: 1, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 },
  countValue: { fontSize: 26, lineHeight: 30, fontWeight: "800" },
  countLabel: { fontSize: 12, fontWeight: "700" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  row: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  rowAction: { alignSelf: "flex-start", marginTop: 6 },
  severity: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  flag: { fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 2 },
  notesInput: { minHeight: 84, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, lineHeight: 21, textAlignVertical: "top" },
  empty: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
