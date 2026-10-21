import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { CorrectionPlan } from "@/lib/inspections/correctionPlan";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** Changing an issue to another answer throws its description, severity and photo away: say so, and ask. */
export function ChangeAnswerSheet({ visible, busy, t, onKeep, onConfirm }: { visible: boolean; busy: boolean; t: Translate; onKeep: () => void; onConfirm: () => void }) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.workspace.changeAnswer.title")}
      onClose={busy ? () => undefined : onKeep}
      onBackdrop={busy ? undefined : onKeep}
      closeLabel={t("inspect.workspace.changeAnswer.keep")}
      showClose={false}
      testID="workspace-change-answer"
      t={t}
      footer={
        <>
          <Button label={t("inspect.workspace.changeAnswer.keep")} size="lg" disabled={busy} onPress={onKeep} testID="workspace-change-answer-keep" />
          <Button label={t("inspect.workspace.changeAnswer.confirm")} variant="destructive" size="lg" loading={busy} onPress={onConfirm} testID="workspace-change-answer-confirm" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {t("inspect.workspace.changeAnswer.body")}
      </Text>
    </WorkspaceSheet>
  );
}

/**
 * What submitting this failed inspection will set in motion. Strictly a preview: it has no inputs and no save, because
 * the server — not this screen — chooses the owner, the priority and the wording, and creates the task only when the
 * inspection is submitted. It never says anything has already been created or sent.
 */
export function CorrectionSheet({ plan, t, onClose }: { plan: CorrectionPlan | null; t: Translate; onClose: () => void }) {
  const theme = useTheme();
  const owner = plan?.owner.name ? t("inspect.workspace.correction.ownerExpected", { name: plan.owner.name }) : t("inspect.workspace.correction.ownerUnknown");
  return (
    <WorkspaceSheet
      visible={plan !== null}
      title={t("inspect.workspace.correction.title")}
      onClose={onClose}
      onBackdrop={onClose}
      testID="workspace-correction"
      t={t}
      footer={<Button label={t("common.close")} variant="secondary" size="lg" onPress={onClose} testID="workspace-correction-done" />}
    >
      {plan ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("inspect.workspace.correction.intro")}
          </Text>
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Fact label={t("inspect.workspace.correction.track")} value={t("inspect.workspace.correction.status")} testID="workspace-correction-status" />
            <Fact label={t("inspect.workspace.correction.owner")} value={owner} note={t("inspect.workspace.correction.ownerNote")} testID="workspace-correction-owner" />
            <Fact
              label={t("inspect.workspace.correction.kind")}
              value={t(plan.kind === "touch_up" ? "inspect.workspace.correction.kindTouchUp" : plan.kind === "reclean" ? "inspect.workspace.correction.kindReclean" : "inspect.workspace.correction.kindUndecided")}
              testID="workspace-correction-kind"
            />
            <Fact label={t("inspect.workspace.correction.priority")} value={t("inspect.workspace.correction.priorityValue")} testID="workspace-correction-priority" />
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heading, { color: theme.textMuted }]}>
            {t("inspect.workspace.correction.steps").toUpperCase()}
          </Text>
          {plan.steps.map((step) => (
            <View key={step.itemId} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]} testID={`workspace-correction-step-${step.itemId}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stepTitle, { color: theme.textPrimary }]}>
                {step.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
                {step.section}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: step.instruction ? theme.textSecondary : theme.textMuted }]}>
                {step.instruction ?? t("inspect.workspace.correction.noInstruction")}
              </Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]} testID="workspace-correction-limits">
            {t("inspect.workspace.correction.limits")}
          </Text>
        </>
      ) : null}
    </WorkspaceSheet>
  );
}

function Fact({ label, value, note, testID }: { label: string; value: string; note?: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
        {value}
      </Text>
      {note ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 10 },
  fact: { gap: 2 },
  heading: { fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: 4 },
  value: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  stepTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
