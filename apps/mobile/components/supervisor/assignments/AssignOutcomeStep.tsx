import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { ConflictView } from "@/lib/housekeeping/assignmentFlow";
import type { AssignmentFlowController, FlowOutcome } from "@/lib/housekeeping/useAssignmentFlow";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function Hero({ icon, tone, title, body, testID }: { icon: keyof typeof Ionicons.glyphMap; tone: "ok" | "warn" | "wait"; title: string; body?: string | null; testID: string }) {
  const theme = useTheme();
  const color = tone === "ok" ? theme.status.ready : tone === "warn" ? theme.destructiveAction : theme.textSecondary;
  return (
    <View style={styles.hero} accessibilityLiveRegion="polite" testID={testID}>
      <Ionicons name={icon} size={44} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID={`${testID}-title`}>
        {title}
      </Text>
      {body ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID={`${testID}-body`}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** The confirmed result: shown only after the server said yes (or a read-back proved it). */
export function AppliedOutcome({
  outcome,
  outOfView,
  controller,
  t,
}: {
  outcome: Extract<FlowOutcome, { kind: "applied" }>;
  /** The room no longer matches the list the supervisor is looking at. */
  outOfView: boolean;
  controller: AssignmentFlowController;
  t: Translate;
}) {
  const theme = useTheme();
  const who = outcome.toName ?? t("assignments.v2.assign.thisPerson");
  const title =
    outcome.action === "remove"
      ? t("assignments.v2.assign.outcome.removedTitle", { room: outcome.roomNumber })
      : t(outcome.action === "reassign" ? "assignments.v2.assign.outcome.reassignedTitle" : "assignments.v2.assign.outcome.assignedTitle", { room: outcome.roomNumber });
  const body = outcome.action === "remove" ? t("assignments.v2.assign.outcome.removedBody") : t("assignments.v2.assign.outcome.assignedBody", { name: who });
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="assign-outcome-applied">
        <Hero icon="checkmark-circle" tone="ok" title={title} body={body} testID="assign-applied" />
        {outcome.refresh === "failed" ? (
          <View style={[styles.note, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="assign-refresh-failed">
            <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]}>
              {t("assignments.v2.assign.outcome.refreshFailed")}
            </Text>
          </View>
        ) : null}
        {outOfView ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textMuted }]} testID="assign-out-of-view">
            {t("assignments.v2.assign.outcome.outOfView")}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t("assignments.v2.assign.outcome.done")} onPress={controller.close} testID="assign-done" />
      </View>
    </>
  );
}

/** The write may or may not have happened. Nothing is sent again; the only action here reads. */
export function UnknownOutcome({ controller, error, t }: { controller: AssignmentFlowController; error: boolean; t: Translate }) {
  const theme = useTheme();
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="assign-outcome-unknown">
        <Hero icon="time-outline" tone="wait" title={t("assignments.v2.assign.outcome.checkingTitle")} body={t("assignments.v2.assign.outcome.checkingBody")} testID="assign-unknown" />
        {error ? (
          <View style={[styles.note, { backgroundColor: theme.surfaceMuted, borderColor: theme.destructiveAction }]} accessibilityRole="alert" testID="assign-still-unknown">
            <Ionicons name="alert-circle-outline" size={16} color={theme.destructiveAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textPrimary }]}>
              {t("assignments.v2.assign.error.still_unknown")}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t("assignments.v2.assign.outcome.checkResult")} icon="refresh-outline" onPress={() => void controller.checkResult()} loading={controller.checking} testID="assign-check-result" />
        <Button label={t("common.close")} variant="secondary" onPress={controller.close} disabled={controller.checking} testID="assign-unknown-close" />
      </View>
    </>
  );
}

function ownerText(owner: { userId: string | null; name: string | null } | undefined, t: Translate): string {
  if (owner === undefined) return t("assignments.v2.assign.conflict.notOnBoard");
  if (owner.userId === null) return t("assignments.v2.assign.conflict.unassigned");
  return owner.name ?? t("assignments.v2.assign.unnamed");
}

/** "Assignment changed": the supervisor's change was NOT applied, and pressing the same button again is not offered. */
export function ConflictOutcome({ conflict, controller, t }: { conflict: ConflictView; controller: AssignmentFlowController; t: Translate }) {
  const theme = useTheme();
  const stageKey = conflict.reason === "not_assignable" && conflict.stage ? `assignments.v2.assign.conflict.stage.${conflict.stage}` : null;
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="assign-outcome-conflict">
        <Hero
          icon="alert-circle"
          tone="warn"
          title={t("assignments.v2.assign.conflict.title")}
          body={t("assignments.v2.assign.conflict.body", { room: conflict.roomNumber })}
          testID="assign-conflict"
        />
        <View style={[styles.facts, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.fact}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textSecondary }]}>
              {t("assignments.v2.assign.conflict.previous")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]} testID="assign-conflict-previous">
              {ownerText(conflict.previous, t)}
            </Text>
          </View>
          <View style={styles.fact}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textSecondary }]}>
              {t("assignments.v2.assign.conflict.current")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]} testID="assign-conflict-current">
              {ownerText(conflict.current, t)}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textPrimary }]} testID="assign-conflict-reason">
          {stageKey ? t(stageKey) : t(`assignments.v2.assign.conflict.reason.${conflict.reason}`)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]} testID="assign-conflict-not-applied">
          {t("assignments.v2.assign.conflict.notApplied")}
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t("assignments.v2.assign.conflict.reviewAgain")} icon="refresh-outline" onPress={() => void controller.reviewAgain()} disabled={controller.busy || conflict.current === undefined} testID="assign-review-again" />
        <Button label={t("common.cancel")} variant="secondary" onPress={controller.close} disabled={controller.busy} testID="assign-conflict-cancel" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 14, paddingBottom: 8 },
  hero: { alignItems: "center", gap: 8, paddingVertical: 8 },
  title: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  body: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  noteText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  facts: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 8 },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  factLabel: { fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  factValue: { fontSize: 14.5, fontWeight: "800", flex: 1, textAlign: "right" },
  footer: { gap: 8, paddingTop: 6 },
});
