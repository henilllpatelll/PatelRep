import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Body, Mark, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import type { AllocateCandidate } from "@/lib/housekeeping/assignmentAllocateView";
import { minutesLine, roomNumbersLine } from "@/lib/housekeeping/assignmentBulkView";
import { attendanceLabel, minutesText } from "@/lib/housekeeping/assignmentFlowText";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Allocation drawer content ─────────────────────────────────────────────
   "Assign N rooms": the work, how to hand it out, and who. Choosing nothing is not a default: no housekeeper is
   pre-selected, because attendance and capacity may not be verified. Nothing here writes — "Review changes" and
   "Add to draft" only stage PROPOSED changes. */

function CandidateRow({ candidate, mode, selected, onPress, rooms, t }: { candidate: AllocateCandidate; mode: "single" | "distribute"; selected: boolean; onPress: () => void; rooms: number; t: Translate }) {
  const theme = useTheme();
  const name = candidate.name ?? t("assignments.v2.assign.unnamed");
  const lines = [
    attendanceLabel(candidate.attendance, t),
    t("assignments.v2.assign.candidate.currentRemaining", { value: minutesText(candidate.current.minutes, t) }),
    mode === "single" ? t("assignments.v2.bulk.allocate.candidate.ifAll", { count: rooms, value: minutesText(candidate.ifAll.minutes, t) }) : null,
    candidate.nearbyRooms > 0 ? t("assignments.v2.bulk.allocate.candidate.nearby", { count: candidate.nearbyRooms, total: candidate.roomsTotal }) : null,
  ].filter((line): line is string => line !== null);
  const spoken = [name, ...lines, candidate.highLoad ? t("assignments.v2.assign.candidate.highLoad") : null, selected ? t("assignments.v2.bulk.row.selected") : null].filter(Boolean).join(". ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={mode === "single" ? "radio" : "checkbox"}
      accessibilityState={mode === "single" ? { selected } : { checked: selected }}
      accessibilityLabel={spoken}
      style={({ pressed }) => [styles.candidate, { backgroundColor: theme.surface, borderColor: selected ? theme.primaryAction : theme.border }, pressed && { opacity: 0.85 }]}
      testID={`bulk-candidate-${candidate.userId}`}
    >
      <Mark checked={selected} shape={mode === "single" ? "round" : "square"} />
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
      </View>
    </Pressable>
  );
}

export function BulkAllocateStep({ bulk, t }: { bulk: BulkAssignmentController; t: Translate }) {
  const theme = useTheme();
  const { selection, allocate, candidates, readiness, preview } = bulk;
  const valid = selection.summary.valid;
  const numbers = valid.map((entry) => entry.room.roomNumber);
  const mode = allocate.mode;
  const ready = readiness === "ready" && bulk.paused === null;

  return (
    <>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="bulk-allocate-title">
          {t("assignments.v2.bulk.allocate.title", { count: valid.length })}
        </Text>
        <Pressable onPress={bulk.closePanel} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="bulk-allocate-close">
          <Ionicons name="close" size={22} color={theme.textPrimary} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="bulk-allocate-scroll">
        {bulk.paused ? (
          <Notice icon="cloud-offline-outline" testID="bulk-allocate-paused">
            {t(bulk.paused === "offline" ? "assignments.v2.bulk.review.paused.offline" : "assignments.v2.bulk.review.paused.not_live")}
          </Notice>
        ) : null}

        <View style={styles.block}>
          <SectionLabel>{t("assignments.v2.bulk.allocate.selectedWork")}</SectionLabel>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rooms, { color: theme.textPrimary }]} testID="bulk-allocate-rooms">
            {roomNumbersLine(numbers, t)}
          </Text>
          <Body tone="secondary" testID="bulk-allocate-estimate">
            {t("assignments.v2.bulk.allocate.estimated", { value: minutesLine(selection.summary.minutes, t) })}
          </Body>
          {selection.summary.invalid.length > 0 ? (
            <Notice tone="alert" icon="alert-circle-outline" testID="bulk-allocate-invalid">
              {t("assignments.v2.bulk.allocate.excluded", { count: selection.summary.invalid.length })}
            </Notice>
          ) : null}
        </View>

        <View style={styles.block}>
          <SectionLabel>{t("assignments.v2.bulk.allocate.how")}</SectionLabel>
          {(["single", "distribute"] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => bulk.setMode(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === option }}
              accessibilityLabel={`${t(`assignments.v2.bulk.allocate.mode.${option}`)}. ${t(`assignments.v2.bulk.allocate.mode.${option}Hint`)}`}
              style={[styles.mode, { backgroundColor: theme.surface, borderColor: mode === option ? theme.primaryAction : theme.border }]}
              testID={`bulk-mode-${option}`}
            >
              <Mark checked={mode === option} shape="round" />
              <View style={styles.candidateBody}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                  {t(`assignments.v2.bulk.allocate.mode.${option}`)}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]}>
                  {t(`assignments.v2.bulk.allocate.mode.${option}Hint`)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.block}>
          <SectionLabel>{t("assignments.v2.bulk.allocate.housekeepers")}</SectionLabel>
          <Body tone="muted">{t(mode === "single" ? "assignments.v2.bulk.allocate.pickOne" : "assignments.v2.bulk.allocate.pickSome")}</Body>
          {candidates.length === 0 ? (
            <Notice testID="bulk-allocate-no-staff">{t("assignments.v2.bulk.allocate.noStaff")}</Notice>
          ) : (
            candidates.map((candidate) => (
              <CandidateRow key={candidate.userId} candidate={candidate} mode={mode} selected={allocate.employeeIds.includes(candidate.userId)} onPress={() => bulk.toggleEmployee(candidate.userId)} rooms={valid.length} t={t} />
            ))
          )}
        </View>

        {mode === "distribute" && preview && preview.shares.length > 0 ? (
          <View style={styles.block} testID="bulk-allocate-preview">
            <SectionLabel>{t("assignments.v2.bulk.allocate.preview.title")}</SectionLabel>
            {preview.shares.map((share) => (
              <Body key={share.userId} testID={`bulk-preview-${share.userId}`}>
                {t("assignments.v2.bulk.allocate.preview.line", { name: share.name ?? t("assignments.v2.assign.unnamed"), count: share.rooms, value: minutesText(share.after.minutes, t) })}
              </Body>
            ))}
            {preview.missingEstimates > 0 ? <Body tone="muted">{t("assignments.v2.bulk.allocate.preview.missing", { count: preview.missingEstimates })}</Body> : null}
          </View>
        ) : null}

        {bulk.stageFailed ? (
          <Notice tone="alert" icon="alert-circle-outline" live testID="bulk-allocate-failed">
            {t("assignments.v2.bulk.allocate.stageFailed")}
          </Notice>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={t("assignments.v2.bulk.allocate.review")} icon="eye-outline" onPress={() => bulk.confirmAllocate("review")} disabled={!ready} variant={allocate.intent === "review" ? "primary" : "secondary"} testID="bulk-allocate-review" />
        <Button label={t("assignments.v2.bulk.allocate.addToDraft")} icon="add-circle-outline" onPress={() => bulk.confirmAllocate("stage")} disabled={!ready} variant={allocate.intent === "stage" ? "primary" : "secondary"} testID="bulk-allocate-stage" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 19, fontWeight: "800" },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 16, paddingBottom: 12 },
  block: { gap: 8 },
  rooms: { fontSize: 17, fontWeight: "800", lineHeight: 24 },
  mode: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET + 8, padding: 12, borderWidth: 1.5, borderRadius: R.lg },
  candidate: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: MIN_TARGET + 8, padding: 12, borderWidth: 1.5, borderRadius: R.lg },
  candidateBody: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  name: { fontSize: 16, fontWeight: "800" },
  tag: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  line: { fontSize: 13.5, lineHeight: 19 },
  footer: { gap: 8, paddingTop: 8 },
});
