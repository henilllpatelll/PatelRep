import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Mark, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import { minutesLine } from "@/lib/housekeeping/assignmentBulkView";
import { attendanceLabel, capacityText, minutesText } from "@/lib/housekeeping/assignmentFlowText";
import type { MidshiftDestination } from "@/lib/housekeeping/assignmentMidshift";
import { blockedText, nameOrFallback, receiversLine } from "@/lib/housekeeping/assignmentMidshiftText";
import type { MidshiftController } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Step 2 — who takes it ─────────────────────────────────────────────────
   "Available team" means people the roster VERIFIES on shift, nobody else; a failed roster makes the team empty rather
   than guessing. "A specific housekeeper" never pre-selects anyone: the supervisor may pick someone who is on a break
   or not clocked in, and the review then asks them to confirm it. Nothing here moves anything. */

function DestinationRow({ candidate, selected, onPress, count, t }: { candidate: MidshiftDestination; selected: boolean; onPress: () => void; count: number; t: Translate }) {
  const theme = useTheme();
  const name = nameOrFallback(candidate.name, t);
  const lines = [
    attendanceLabel(candidate.attendance, t),
    t("assignments.v2.assign.candidate.currentRemaining", { value: minutesText(candidate.current.minutes, t) }),
    t("assignments.v2.bulk.allocate.candidate.ifAll", { count, value: minutesText(candidate.ifAll.minutes, t) }),
    capacityText(candidate.current, candidate.ifAll, t),
    candidate.shiftMinutesLeft !== null ? t("assignments.v2.midshift.destination.shiftLeft", { minutes: Math.max(0, Math.round(candidate.shiftMinutesLeft)) }) : null,
    candidate.attendanceAck ? t("assignments.v2.midshift.destination.confirmLater") : null,
  ].filter((line): line is string => line !== null);
  const spoken = [name, ...lines, candidate.highLoad ? t("assignments.v2.assign.candidate.highLoad") : null, selected ? t("assignments.v2.bulk.row.selected") : null].filter(Boolean).join(". ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      style={({ pressed }) => [styles.candidate, { backgroundColor: theme.surface, borderColor: selected ? theme.primaryAction : theme.border }, pressed && { opacity: 0.85 }]}
      testID={`midshift-candidate-${candidate.userId}`}
    >
      <Mark checked={selected} shape="round" />
      <View style={styles.candidateBody}>
        <View style={styles.nameRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {name}
          </Text>
          {candidate.highLoad ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tag, { color: theme.destructiveAction, borderColor: theme.destructiveAction }]}>
              {t("assignments.v2.assign.candidate.highLoad")}
            </Text>
          ) : null}
        </View>
        {lines.map((line) => (
          <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]}>
            {line}
          </Text>
        ))}
        <WarningLines warnings={candidate.ifAll.warnings} t={t} testIDPrefix={`midshift-candidate-warning-${candidate.userId}`} />
      </View>
    </Pressable>
  );
}

export function MidshiftDestinationStep({ midshift, t }: { midshift: MidshiftController; t: Translate }) {
  const theme = useTheme();
  const { source, summary, mode, destinations } = midshift;
  if (!source || !summary) return null;
  const name = nameOrFallback(source.name, t);
  const count = summary.valid.length;
  const teamNames = destinations.filter((candidate) => midshift.teamIds.includes(candidate.userId)).map((candidate) => candidate.name);
  const noTeam = mode === "team" && midshift.teamIds.length === 0;
  const blocked = midshift.blocked;
  const plan = midshift.plan;

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="midshift-destination-scroll">
        <Body strong testID="midshift-moving">
          {t("assignments.v2.midshift.destination.movingLine", { count, value: minutesLine(summary.minutes, t) })}
        </Body>

        <View style={styles.block}>
          {(["team", "person"] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => midshift.setMode(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === option }}
              accessibilityLabel={`${t(`assignments.v2.midshift.destination.mode.${option}`)}. ${t(`assignments.v2.midshift.destination.mode.${option}Hint`)}`}
              style={[styles.mode, { backgroundColor: theme.surface, borderColor: mode === option ? theme.primaryAction : theme.border }]}
              testID={`midshift-mode-${option}`}
            >
              <Mark checked={mode === option} shape="round" />
              <View style={styles.candidateBody}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                  {t(`assignments.v2.midshift.destination.mode.${option}`)}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]}>
                  {t(`assignments.v2.midshift.destination.mode.${option}Hint`)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {mode === "team" && !noTeam ? (
          <Body tone="secondary" testID="midshift-team-members">
            {t("assignments.v2.midshift.destination.teamMembers", { names: receiversLine(teamNames, t) })}
          </Body>
        ) : null}

        {noTeam ? (
          <View style={styles.block} testID="midshift-no-team">
            <Notice tone="alert" icon="alert-circle-outline" live>
              {t("assignments.v2.midshift.destination.teamNone")}
            </Notice>
            <Body tone="secondary">{t("assignments.v2.midshift.destination.teamNoneBody")}</Body>
            <Button label={t("assignments.v2.midshift.destination.chooseSpecific")} variant="secondary" onPress={() => midshift.setMode("person")} testID="midshift-choose-specific" />
            <Button label={t("assignments.v2.midshift.destination.adjustRooms")} variant="secondary" onPress={midshift.back} testID="midshift-adjust-rooms" />
            <Button label={t("assignments.v2.midshift.destination.keepAssigned", { name })} variant="secondary" onPress={midshift.close} testID="midshift-keep-assigned" />
            <Body tone="muted" testID="midshift-keep-note">
              {t("assignments.v2.midshift.destination.keepNote", { name, attendance: attendanceLabel(source.member.attendance, t) })}
            </Body>
          </View>
        ) : null}

        {mode === "person" ? (
          <View style={styles.block}>
            <SectionLabel>{t("assignments.v2.midshift.destination.mode.person")}</SectionLabel>
            <Body tone="muted">{t("assignments.v2.midshift.destination.pickHint")}</Body>
            {destinations.length === 0 ? (
              <Notice testID="midshift-no-staff">{t("assignments.v2.midshift.destination.noStaff")}</Notice>
            ) : (
              destinations.map((candidate) => <DestinationRow key={candidate.userId} candidate={candidate} selected={midshift.destinationId === candidate.userId} onPress={() => midshift.chooseDestination(candidate.userId)} count={count} t={t} />)
            )}
          </View>
        ) : null}

        {plan && plan.leftOut.length > 0 && plan.review === null && !noTeam && mode === "team" ? (
          <Notice tone="alert" icon="alert-circle-outline" testID="midshift-none-placeable">
            {t("assignments.v2.midshift.review.noneMoved")}
          </Notice>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {blocked ? (
          <Body tone="muted" testID="midshift-blocked">
            {blockedText(blocked, midshift.paused, t)}
          </Body>
        ) : null}
        <Button label={t("assignments.v2.midshift.destination.next")} icon="eye-outline" onPress={midshift.next} disabled={blocked !== null} testID="midshift-next" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, marginTop: 8 },
  content: { gap: 14, paddingBottom: 12 },
  block: { gap: 8 },
  mode: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET + 8, padding: 12, borderWidth: 1.5, borderRadius: R.lg },
  candidate: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: MIN_TARGET + 8, padding: 12, borderWidth: 1.5, borderRadius: R.lg },
  candidateBody: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  name: { fontSize: 16, fontWeight: "800" },
  tag: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  line: { fontSize: 13.5, lineHeight: 19 },
  footer: { gap: 8, paddingTop: 8 },
});
