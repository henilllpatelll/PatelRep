import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import type { ReviewItem } from "@/lib/housekeeping/assignmentDraftReview";
import { attendanceLabel, capacityText, minutesText, missingText } from "@/lib/housekeeping/assignmentFlowText";
import { blockedText, leftOutText, nameOrFallback, reasonLabel } from "@/lib/housekeeping/assignmentMidshiftText";
import type { LoadView } from "@/lib/housekeeping/assignmentPicker";
import type { MidshiftController } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Step 3 — review the redistribution ────────────────────────────────────
   Before and after for the person the work leaves and for everyone who receives it, from the same workload functions as
   the Team tab. It is a PREVIEW of a scratch draft: nothing is staged, let alone published, until "Add changes to draft",
   and even then only into the unpublished draft that has its own review. "Nothing left" is said only when the person
   truly has no remaining rooms; a missing estimate keeps a total "at least". */

function remainingText(view: LoadView, t: Translate): string {
  return view.minutes.rooms === 0 ? t("assignments.v2.midshift.review.nothingLeft") : minutesText(view.minutes, t);
}

function itemDetail(item: ReviewItem, t: Translate): string {
  return [item.cleanTypeLabel, item.estimateMinutes !== null ? t("assignments.v2.assign.picker.estimate", { minutes: item.estimateMinutes }) : t("assignments.v2.assign.picker.noEstimate")].filter(Boolean).join(" · ");
}

function ValidationLine({ id, state, count, t }: { id: string; state: string; count: number; t: Translate }) {
  const theme = useTheme();
  const icon = state === "pass" ? "checkmark-circle" : state === "fail" ? "close-circle" : state === "attention" ? "alert-circle" : "help-circle-outline";
  const color = state === "pass" ? theme.status.ready : state === "fail" ? theme.destructiveAction : theme.textSecondary;
  const text = t(`assignments.v2.bulk.review.validation.${id}.${state}`, { count });
  return (
    <View style={styles.validation} accessible accessibilityLabel={text} testID={`midshift-validation-${id}`}>
      <Ionicons name={icon} size={18} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.validationText, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

function MovePicker({ midshift, t }: { midshift: MidshiftController; t: Translate }) {
  const theme = useTheme();
  const roomId = midshift.movePickerFor;
  const room = midshift.summary?.valid.find((candidate) => candidate.roomId === roomId);
  if (!roomId || !room) return null;
  const current = midshift.plan?.assignments[roomId] ?? null;
  const choices = midshift.destinations.filter((candidate) => candidate.userId !== current);
  return (
    <View style={styles.block} testID="midshift-move-picker">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
        {t("assignments.v2.midshift.review.moveTitle", { room: room.roomNumber })}
      </Text>
      {choices.map((candidate) => (
        <Pressable
          key={candidate.userId}
          onPress={() => midshift.moveRoom(roomId, candidate.userId)}
          accessibilityRole="button"
          accessibilityLabel={`${nameOrFallback(candidate.name, t)}. ${attendanceLabel(candidate.attendance, t)}`}
          style={[styles.pick, { backgroundColor: theme.surface, borderColor: theme.border }]}
          testID={`midshift-move-to-${candidate.userId}`}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {nameOrFallback(candidate.name, t)}
          </Text>
          <Body tone="secondary">{attendanceLabel(candidate.attendance, t)}</Body>
        </Pressable>
      ))}
      <Button label={t("assignments.v2.midshift.review.cancelMove")} variant="secondary" onPress={() => midshift.openMovePicker(null)} testID="midshift-move-cancel" />
    </View>
  );
}

export function MidshiftReviewStep({ midshift, t }: { midshift: MidshiftController; t: Translate }) {
  const theme = useTheme();
  const { source, plan, editing } = midshift;
  if (!source || !plan) return null;
  const review = plan.review;
  const sourceName = nameOrFallback(source.name, t);
  const sourceReview = review?.employees.find((employee) => employee.userId === source.userId) ?? null;
  const receivers = (review?.employees ?? []).filter((employee) => employee.added.length > 0);
  const stays = source.rooms.length - (sourceReview?.released.length ?? 0);
  const missing = receivers.some((employee) => employee.proposed.minutes.missing > 0) || (sourceReview?.proposed.minutes.missing ?? 0) > 0;
  const blocked = midshift.blocked;
  const off = blocked !== null || !review;

  if (midshift.movePickerFor) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="midshift-review-scroll">
        <MovePicker midshift={midshift} t={t} />
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="midshift-review-scroll">
        <Notice testID="midshift-not-published">{t("assignments.v2.midshift.review.notPublished")}</Notice>
        {midshift.reason ? <Body tone="secondary" testID="midshift-reason-line">{t("assignments.v2.midshift.review.reasonLine", { reason: reasonLabel(midshift.reason, t) })}</Body> : null}
        {plan.leftOut.length > 0 && review ? (
          <Notice tone="alert" icon="alert-circle-outline" live testID="midshift-partial">
            {t("assignments.v2.midshift.review.partial")}
          </Notice>
        ) : null}
        {!review ? (
          <Notice tone="alert" icon="alert-circle-outline" live testID="midshift-none-moved">
            {t("assignments.v2.midshift.review.noneMoved")}
          </Notice>
        ) : null}
        {missing ? <Body tone="muted" testID="midshift-missing">{t("assignments.v2.midshift.review.missing")}</Body> : null}

        {sourceReview ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="midshift-source-card">
            <SectionLabel>{t("assignments.v2.midshift.review.sourceHeading")}</SectionLabel>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.name, { color: theme.textPrimary }]}>
              {sourceName}
            </Text>
            <Body testID="midshift-source-before">{t("assignments.v2.midshift.review.before", { value: remainingText(sourceReview.current, t) })}</Body>
            <Body strong testID="midshift-source-after">
              {t("assignments.v2.midshift.review.after", { value: remainingText(sourceReview.proposed, t) })}
            </Body>
            {capacityText(sourceReview.current, sourceReview.proposed, t) ? <Body tone="secondary" testID="midshift-source-capacity">{capacityText(sourceReview.current, sourceReview.proposed, t)}</Body> : null}
            <Body tone="secondary">{t("assignments.v2.midshift.review.moving", { count: sourceReview.released.length })}</Body>
            {stays > 0 ? <Body tone="secondary" testID="midshift-source-stays">{t("assignments.v2.midshift.review.staysWith", { count: stays, name: sourceName })}</Body> : null}
          </View>
        ) : null}

        {receivers.length > 0 ? <SectionLabel>{t("assignments.v2.midshift.review.destinationHeading")}</SectionLabel> : null}
        {receivers.map((employee) => {
          const name = nameOrFallback(employee.name, t);
          const note = missingText(employee.proposed.minutes, t);
          return (
            <View key={employee.userId} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`midshift-receiver-${employee.userId}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.name, { color: theme.textPrimary }]}>
                {name}
              </Text>
              <Body tone="secondary">{attendanceLabel(employee.attendance, t)}</Body>
              <Body testID={`midshift-before-${employee.userId}`}>{t("assignments.v2.midshift.review.before", { value: remainingText(employee.current, t) })}</Body>
              <Body strong testID={`midshift-after-${employee.userId}`}>
                {t("assignments.v2.midshift.review.after", { value: remainingText(employee.proposed, t) })}
              </Body>
              {capacityText(employee.current, employee.proposed, t) ? <Body tone="secondary" testID={`midshift-capacity-${employee.userId}`}>{capacityText(employee.current, employee.proposed, t)}</Body> : null}
              {note ? <Body tone="muted">{note}</Body> : null}
              <WarningLines warnings={employee.proposed.warnings} t={t} testIDPrefix={`midshift-warning-${employee.userId}`} />
              {employee.acks.length > 0 ? <Body tone="muted" testID={`midshift-confirm-later-${employee.userId}`}>{t("assignments.v2.midshift.destination.confirmLater")}</Body> : null}
              {employee.added.map((item) => (
                <View key={item.roomId} style={styles.itemRow} testID={`midshift-item-${item.roomNumber}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
                    {item.roomNumber}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemDetail, { color: theme.textSecondary }]}>
                    {itemDetail(item, t)}
                  </Text>
                  {editing ? (
                    <View style={styles.itemActions}>
                      <Pressable
                        onPress={() => midshift.openMovePicker(item.roomId)}
                        accessibilityRole="button"
                        accessibilityLabel={t("assignments.v2.midshift.review.moveA11y", { room: item.roomNumber })}
                        style={styles.action}
                        testID={`midshift-move-${item.roomNumber}`}
                      >
                        <Body strong style={{ color: theme.primaryAction }}>
                          {t("assignments.v2.midshift.review.move")}
                        </Body>
                      </Pressable>
                      <Pressable
                        onPress={() => midshift.takeOut(item.roomId)}
                        accessibilityRole="button"
                        accessibilityLabel={t("assignments.v2.midshift.review.takeOutA11y", { room: item.roomNumber })}
                        style={styles.action}
                        testID={`midshift-takeout-${item.roomNumber}`}
                      >
                        <Body tone="alert" strong>
                          {t("assignments.v2.midshift.review.takeOut")}
                        </Body>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          );
        })}

        {plan.leftOut.length > 0 ? (
          <View style={styles.block} testID="midshift-left-out">
            <SectionLabel>{t("assignments.v2.midshift.review.leftOutHeading")}</SectionLabel>
            {plan.leftOut.map((entry) => (
              <Body key={entry.roomId} tone="secondary" testID={`midshift-left-out-${entry.roomNumber || entry.roomId}`}>
                {t("assignments.v2.midshift.review.leftOutLine", { room: entry.roomNumber, reason: leftOutText(entry.reason, t) })}
              </Body>
            ))}
          </View>
        ) : null}

        {review ? (
          <View style={styles.block} testID="midshift-validation">
            <SectionLabel>{t("assignments.v2.bulk.review.validationHeading")}</SectionLabel>
            {review.validations.map((validation) => (
              <ValidationLine key={validation.id} id={validation.id} state={validation.state} count={validation.count} t={t} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {blocked ? (
          <Body tone="muted" testID="midshift-blocked">
            {blockedText(blocked, midshift.paused, t)}
          </Body>
        ) : null}
        <Button label={t("assignments.v2.midshift.review.addToDraft")} icon="add-circle-outline" onPress={() => midshift.addToDraft()} disabled={off} testID="midshift-add-to-draft" />
        <Button
          label={editing ? t("assignments.v2.midshift.review.doneEditing") : t("assignments.v2.midshift.review.edit")}
          variant="secondary"
          icon="create-outline"
          onPress={midshift.toggleEditing}
          disabled={!review}
          testID="midshift-edit"
        />
        {editing ? (
          <Button label={t("assignments.v2.midshift.review.editSelection")} variant="secondary" onPress={midshift.editSelection} testID="midshift-edit-selection" />
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, marginTop: 8 },
  content: { gap: 12, paddingBottom: 12 },
  block: { gap: 8 },
  title: { fontSize: 18, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  name: { fontSize: 17, fontWeight: "800" },
  itemRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, minHeight: 36, paddingTop: 4 },
  roomNumber: { fontFamily: monoFont, fontSize: 17, fontWeight: "800", minWidth: 48 },
  itemDetail: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  itemActions: { flexDirection: "row", gap: 4 },
  action: { minHeight: MIN_TARGET, minWidth: 56, justifyContent: "center", alignItems: "center", paddingHorizontal: 6 },
  pick: { minHeight: MIN_TARGET + 8, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  validation: { flexDirection: "row", alignItems: "center", gap: 8 },
  validationText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: { gap: 8, paddingTop: 8 },
});
