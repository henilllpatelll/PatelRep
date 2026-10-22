import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { ImpactBlock } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { ackText, attendanceLabel, minutesText } from "@/lib/housekeeping/assignmentFlowText";
import type { AssignReview } from "@/lib/housekeeping/assignmentPicker";
import type { AssignmentFlowController } from "@/lib/housekeeping/useAssignmentFlow";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.fieldLabel, { color: theme.textMuted }]}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function AckRow({ ack, name, checked, onToggle, t }: { ack: AssignReview["requiredAcks"][number]; name: string; checked: boolean; onToggle: () => void; t: Translate }) {
  const theme = useTheme();
  const label = ackText(ack, name, t);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[styles.ack, { borderColor: checked ? theme.primaryAction : theme.border, backgroundColor: theme.surface }]}
      testID={`assign-ack-${ack}`}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? theme.primaryAction : theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ackText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AssignReviewStep({ controller, banner, paused, t }: { controller: AssignmentFlowController; banner: React.ReactNode; paused: string | null; t: Translate }) {
  const theme = useTheme();
  const { flow, review, busy } = controller;
  if (!flow || !review) return null;
  const reassign = review.intent === "reassign";
  const toName = review.to.name ?? t("assignments.v2.assign.unnamed");
  const fromName = review.from ? (review.from.name ?? t("assignments.v2.assign.unnamed")) : null;
  const priority = review.priorityReasons.map((reason) => t(`assignments.v2.priority.${reason}`)).join(" · ");
  const roomLine = [review.cleanTypeLabel, review.estimate ? t("assignments.v2.assign.picker.estimate", { minutes: review.estimate.minutes }) : t("assignments.v2.assign.picker.noEstimate")]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="assign-review-scroll">
        {banner}

        <Field label={t("assignments.v2.assign.review.room")}>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.roomNumber, { color: theme.textPrimary }]} testID="assign-review-room">
              {review.roomNumber}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="assign-review-room-line">
              {roomLine}
            </Text>
            {priority ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary, fontWeight: "700" }]} testID="assign-review-priority">
                {priority}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textMuted }]} testID="assign-review-stage">
              {t(`assignments.v2.assign.review.stage.${review.stage}`)}
            </Text>
          </View>
        </Field>

        {reassign && fromName ? (
          <Field label={t("assignments.v2.assign.review.currentAssignee")}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.person, { color: theme.textPrimary }]} testID="assign-review-from">
              {fromName}
            </Text>
          </Field>
        ) : null}

        <Field label={reassign ? t("assignments.v2.assign.review.newAssignee") : t("assignments.v2.assign.review.assignTo")}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.person, { color: theme.textPrimary }]} testID="assign-review-to">
            {toName}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="assign-review-attendance">
            {attendanceLabel(review.to.attendance, t)}
          </Text>
        </Field>

        {review.requiredAcks.length > 0 ? (
          <Field label={t("assignments.v2.assign.review.ackTitle")}>
            <View style={styles.stack} testID="assign-review-acks">
              {review.requiredAcks.map((ack) => (
                <AckRow key={ack} ack={ack} name={toName} checked={flow.acks.includes(ack)} onToggle={() => controller.toggleAck(ack)} t={t} />
              ))}
            </View>
          </Field>
        ) : null}

        <Field label={reassign ? t("assignments.v2.assign.review.impactTitle") : t("assignments.v2.assign.review.workloadTitle")}>
          <View style={styles.stack}>
            <ImpactBlock impact={review.toImpact} heading={toName} t={t} tone="receive" testID="assign-review-to-impact" />
            {review.estimate ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="assign-review-room-delta">
                {t("assignments.v2.assign.review.roomDelta", { room: review.roomNumber, value: minutesText({ minutes: review.estimate.minutes, partial: false, missing: 0, rooms: 1 }, t) })}
              </Text>
            ) : (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textMuted }]} testID="assign-review-no-estimate">
                {t("assignments.v2.assign.review.noEstimate")}
              </Text>
            )}
            {review.fromImpact && fromName ? (
              <ImpactBlock impact={review.fromImpact} heading={fromName} t={t} tone="release" testID="assign-review-from-impact" />
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textMuted }]}>
              {t("assignments.v2.assign.review.estimateNote")}
            </Text>
          </View>
        </Field>

        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textMuted }]} testID="assign-review-checked">
          {t("assignments.v2.assign.review.checked")}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={t(reassign ? "assignments.v2.assign.review.confirmReassign" : "assignments.v2.assign.review.confirmAssign")}
          icon="checkmark"
          onPress={() => void controller.confirm()}
          loading={busy}
          disabled={!controller.canConfirm || !!paused}
          testID="assign-confirm"
        />
        <Button label={t("assignments.v2.assign.review.backToPicker")} variant="secondary" onPress={controller.back} disabled={busy} testID="assign-back-to-picker" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 14, paddingBottom: 8 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  stack: { gap: 8 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  roomNumber: { fontFamily: monoFont, fontSize: 30, lineHeight: 36, fontWeight: "800" },
  person: { fontSize: 19, fontWeight: "800" },
  line: { fontSize: 13.5, lineHeight: 19 },
  ack: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, minHeight: 52, paddingVertical: 8 },
  ackText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  footer: { gap: 8, paddingTop: 6 },
});
