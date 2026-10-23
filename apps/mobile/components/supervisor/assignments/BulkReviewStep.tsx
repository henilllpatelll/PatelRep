import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { ValueLine, WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Mark, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import { minutesLine } from "@/lib/housekeeping/assignmentBulkView";
import { ackKey, type EmployeeReview, type ReviewItem, type ReviewValidation } from "@/lib/housekeeping/assignmentDraftReview";
import { ackText, attendanceLabel, minutesText, missingText } from "@/lib/housekeeping/assignmentFlowText";
import { noteText } from "@/lib/housekeeping/assignmentMidshiftText";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import type { MidshiftNote } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── The draft review ──────────────────────────────────────────────────────
   Everything is proposed, never past tense: "Current" is what is published today, "Proposed" is what a person would
   have if this draft were published. Publish stays off while a proposed change no longer holds or a required
   acknowledgement is missing, and the reason is written under the button. The supervisor's tap on Publish is the
   explicit approval; nothing is sent before it. */

function itemText(item: ReviewItem, t: Translate): string {
  const parts = [item.cleanTypeLabel, item.estimateMinutes !== null ? t("assignments.v2.assign.picker.estimate", { minutes: item.estimateMinutes }) : t("assignments.v2.assign.picker.noEstimate")].filter(Boolean).join(" · ");
  if (item.kind === "reassign" && item.toUserId) return t("assignments.v2.bulk.review.item.reassign", { room: item.roomNumber, detail: parts, name: item.fromName ?? t("assignments.v2.assign.unnamed") });
  return t("assignments.v2.bulk.review.item.assign", { room: item.roomNumber, detail: parts });
}

function ValidationRow({ validation, t }: { validation: ReviewValidation; t: Translate }) {
  const theme = useTheme();
  const icon = validation.state === "pass" ? "checkmark-circle" : validation.state === "fail" ? "close-circle" : validation.state === "attention" ? "alert-circle" : "help-circle-outline";
  const color = validation.state === "pass" ? theme.status.ready : validation.state === "fail" ? theme.destructiveAction : theme.textSecondary;
  const text = t(`assignments.v2.bulk.review.validation.${validation.id}.${validation.state}`, { count: validation.count });
  return (
    <View style={styles.validation} accessible accessibilityLabel={text} testID={`bulk-validation-${validation.id}`}>
      <Ionicons name={icon} size={18} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.validationText, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

function EmployeeBlock({ employee, bulk, t }: { employee: EmployeeReview; bulk: BulkAssignmentController; t: Translate }) {
  const theme = useTheme();
  const name = employee.name ?? t("assignments.v2.assign.unnamed");
  const missing = missingText(employee.proposed.minutes, t);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`bulk-review-employee-${employee.userId}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.cardTitle, { color: theme.textPrimary }]}>
        {name}
      </Text>
      <Body tone="secondary">{attendanceLabel(employee.attendance, t)}</Body>
      <ValueLine label={t("assignments.v2.bulk.review.currentRemaining")} value={minutesText(employee.current.minutes, t)} testID={`bulk-review-current-${employee.userId}`} />
      <ValueLine label={t("assignments.v2.bulk.review.proposedRemaining")} value={minutesText(employee.proposed.minutes, t)} strong testID={`bulk-review-proposed-${employee.userId}`} />
      {missing ? <Body tone="muted">{missing}</Body> : null}
      <WarningLines warnings={employee.proposed.warnings} t={t} testIDPrefix={`bulk-review-warning-${employee.userId}`} />

      {employee.added.map((item) => (
        <Text key={`add-${item.roomId}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.item, { color: theme.textPrimary }]} testID={`bulk-review-add-${item.roomNumber}`}>
          {itemText(item, t)}
        </Text>
      ))}
      {employee.released.map((item) => (
        <Text key={`rel-${item.roomId}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.item, { color: theme.textSecondary }]} testID={`bulk-review-release-${item.roomNumber}`}>
          {t(item.toUserId ? "assignments.v2.bulk.review.item.movedAway" : "assignments.v2.bulk.review.item.removed", { room: item.roomNumber })}
        </Text>
      ))}

      {employee.acks.map((ack) => {
        const key = ackKey(employee.userId, ack);
        const checked = bulk.draft.acks.has(key);
        const label = ackText(ack, name, t);
        return (
          <Pressable
            key={key}
            onPress={() => bulk.draft.toggleAck(key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={label}
            style={[styles.ack, { borderColor: checked ? theme.primaryAction : theme.border, backgroundColor: theme.surface }]}
            testID={`bulk-ack-${employee.userId}-${ack}`}
          >
            <Mark checked={checked} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ackText, { color: theme.textPrimary }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}

      {employee.added.length > 0 ? (
        <Button label={t("assignments.v2.bulk.review.editAllocation")} variant="secondary" icon="create-outline" onPress={() => bulk.openEdit(employee.userId)} testID={`bulk-review-edit-${employee.userId}`} accessibilityLabel={t("assignments.v2.bulk.review.editAllocationFor", { name })} />
      ) : null}
    </View>
  );
}

export function BulkReviewStep({ bulk, t, midshiftNote }: { bulk: BulkAssignmentController; t: Translate; midshiftNote?: MidshiftNote | null }) {
  const theme = useTheme();
  const review = bulk.draft.review;
  if (!review) return null;
  const { counts, minutes } = review;
  const rebase = bulk.draft.rebaseNote;
  const first = review.blockers[0];
  const off = !review.canPublish || bulk.paused !== null || bulk.publication.working;
  const kinds = (["assign", "reassign", "remove"] as const).filter((kind) => counts[kind] > 0);

  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={bulk.closePanel} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.review.back")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="bulk-review-back">
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="bulk-review-title">
          {t("assignments.v2.bulk.review.title", { count: review.changeCount })}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="bulk-review-scroll">
        <Notice icon="information-circle-outline" testID="bulk-review-notpublished">
          {t("assignments.v2.bulk.review.notPublished")}
        </Notice>

        {midshiftNote ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="bulk-review-midshift">
            <Body strong>{noteText(midshiftNote, t).title}</Body>
            {noteText(midshiftNote, t).reason ? <Body tone="secondary">{noteText(midshiftNote, t).reason}</Body> : null}
          </View>
        ) : null}

        {rebase && (rebase.rebased.length > 0 || rebase.dropped.length > 0) ? (
          <Notice tone="alert" icon="refresh-outline" live testID="bulk-review-rebased">
            {t("assignments.v2.bulk.review.rebased", { updated: rebase.rebased.length, removed: rebase.dropped.length })}
          </Notice>
        ) : null}

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="bulk-review-summary">
          <SectionLabel>{t("assignments.v2.bulk.review.summary")}</SectionLabel>
          <Body strong>{t("assignments.v2.bulk.review.rooms", { count: review.changeCount })}</Body>
          <Body>{t("assignments.v2.bulk.review.people", { count: review.employeeCount })}</Body>
          <Body>{t("assignments.v2.bulk.review.estimated", { value: minutesLine(minutes, t) })}</Body>
          {kinds.length > 1 || (kinds.length === 1 && kinds[0] !== "assign") ? kinds.map((kind) => <Body key={kind} tone="secondary">{t(`assignments.v2.bulk.review.kind.${kind}`, { count: counts[kind] })}</Body>) : null}
          <Body tone={review.problems.length > 0 ? "alert" : "secondary"} testID="bulk-review-conflicts">
            {review.problems.length > 0 ? t("assignments.v2.bulk.review.problemsCount", { count: review.problems.length }) : t("assignments.v2.bulk.review.noConflicts")}
          </Body>
        </View>

        {review.problems.length > 0 ? (
          <View style={styles.block} testID="bulk-review-problems">
            <SectionLabel>{t("assignments.v2.bulk.review.problems")}</SectionLabel>
            {review.problems.map((problem) => (
              <View key={problem.change.roomId} style={[styles.problem, { borderColor: theme.destructiveAction, backgroundColor: theme.surface }]} testID={`bulk-problem-${problem.change.roomNumber}`}>
                <Body strong>{t(`assignments.v2.bulk.review.problem.${problem.reason}`, { room: problem.change.roomNumber })}</Body>
                {problem.reason !== "scope_changed" && problem.reason !== "board_unavailable" ? (
                  <Pressable onPress={() => bulk.removeRoom(problem.change.roomId)} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.review.removeRoom", { room: problem.change.roomNumber })} style={styles.linkButton} testID={`bulk-problem-remove-${problem.change.roomNumber}`}>
                    <Body tone="alert" strong>
                      {t("assignments.v2.bulk.edit.remove")}
                    </Body>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Button label={t("assignments.v2.bulk.conflict.refresh")} variant="secondary" icon="refresh-outline" onPress={() => void bulk.refreshAndReview()} testID="bulk-review-refresh" />
          </View>
        ) : null}

        {review.employees.map((employee) => (
          <EmployeeBlock key={employee.userId} employee={employee} bulk={bulk} t={t} />
        ))}

        {bulk.draft.exclusions.length > 0 ? (
          <View style={styles.block} testID="bulk-review-exclusions">
            <SectionLabel>{t("assignments.v2.bulk.review.exclusions")}</SectionLabel>
            {bulk.draft.exclusions.map((exclusion) => (
              <Body key={exclusion.roomId} tone="secondary" testID={`bulk-exclusion-${exclusion.roomNumber}`}>
                {t("assignments.v2.bulk.review.exclusion", { room: exclusion.roomNumber, reason: t(`assignments.v2.bulk.review.exclusionReason.${exclusion.reason}`) })}
              </Body>
            ))}
          </View>
        ) : null}

        <View style={styles.block} testID="bulk-review-validation">
          <SectionLabel>{t("assignments.v2.bulk.review.validationHeading")}</SectionLabel>
          {review.validations.map((validation) => (
            <ValidationRow key={validation.id} validation={validation} t={t} />
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {bulk.paused ? (
          <Notice icon="cloud-offline-outline" testID="bulk-review-paused">
            {t(bulk.paused === "offline" ? "assignments.v2.bulk.review.paused.offline" : "assignments.v2.bulk.review.paused.not_live")}
          </Notice>
        ) : off && first ? (
          <Body tone="muted" testID="bulk-review-blocker">
            {t(`assignments.v2.bulk.review.blocked.${first}`)}
          </Body>
        ) : null}
        <Button label={t("assignments.v2.bulk.review.publish", { count: review.changeCount })} icon="cloud-upload-outline" onPress={() => void bulk.publishNow()} disabled={off} testID="bulk-publish" />
        <Pressable onPress={bulk.requestDiscard} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.review.discard")} style={styles.linkButton} testID="bulk-review-discard">
          <Body tone="alert" strong>
            {t("assignments.v2.bulk.review.discard")}
          </Body>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 19, fontWeight: "800" },
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 14, paddingBottom: 12 },
  block: { gap: 8 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  item: { fontSize: 14.5, lineHeight: 21, fontWeight: "600" },
  problem: { borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  linkButton: { minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4 },
  ack: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET + 8, padding: 10, borderWidth: 1.5, borderRadius: R.md, marginTop: 6 },
  ackText: { flex: 1, fontSize: 14, lineHeight: 20 },
  validation: { flexDirection: "row", alignItems: "center", gap: 8 },
  validationText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: { gap: 8, paddingTop: 8 },
});
