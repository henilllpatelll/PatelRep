import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { ErrorText, FieldLabel, TextField } from "@/components/scheduling/formParts";
import { Button } from "@/components/ui/Button";
import { ABSENCE_KINDS, classifyCoverageFailure, newCallOutKey, recordAbsence, type AbsenceKind, type CoverageFailure, type RecordedCallOut } from "@/lib/api/schedulingCoverage";
import type { TeamShift } from "@/lib/api/schedulingTeam";
import { addDaysToYmd, formatLongDate, formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import { failureText, gapTitle, gapWindow, minutesText } from "@/lib/scheduling/coverageText";
import { parseClockText, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Record Call-Out ────────────────────────────────────────────────────────
   A supervisor EXPLICITLY records that an employee will not work a scheduled shift. Nothing is inferred from a missing
   clock-in. Two steps in one drawer:
     1. the form (reason category, optional operational note, when they leave for an early departure)
     2. the confirmation + coverage impact, with the next actions
   Recording never reassigns rooms, never edits the shift, and never touches attendance. The reasons are operational
   categories on purpose: no medical or other personal detail is asked for. */

interface Props {
  shift: TeamShift | null;
  personName: string;
  roleText: string | null;
  /** Verified attendance wording for the shift's day, or null when it was not read. */
  attendanceText: string | null;
  zone: string | null;
  language?: string;
  isOnline: boolean;
  onClose: () => void;
  /** The call-out is saved: refresh the schedule and coverage. */
  onRecorded: () => void;
  onFindCoverage: (gapId: string) => void;
  onReviewRooms: (userId: string) => void;
  t: Translate;
}

export function CallOutSheet({ shift, personName, roleText, attendanceText, zone, language, isOnline, onClose, onRecorded, onFindCoverage, onReviewRooms, t }: Props) {
  const theme = useTheme();
  const [kind, setKind] = useState<AbsenceKind>("called_out");
  const [leaving, setLeaving] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<CoverageFailure | null>(null);
  const [done, setDone] = useState<RecordedCallOut | null>(null);
  // One key per submission attempt: a retry after a lost answer returns the SAME call-out instead of a second one.
  const key = useRef(newCallOutKey());
  const inFlight = useRef(false);

  useEffect(() => {
    setKind("called_out");
    setLeaving("");
    setNote("");
    setBusy(false);
    setError(null);
    setFailure(null);
    setDone(null);
    key.current = newCallOutKey();
  }, [shift?.id]);

  if (!shift) return null;
  const visible = true;

  const leavingInstant = (): string | null => {
    const clock = parseClockText(leaving);
    if (!clock) return null;
    const starts = Date.parse(shift.startsAt);
    const ends = Date.parse(shift.endsAt);
    for (const day of [shift.workDate, addDaysToYmd(shift.workDate, 1)]) {
      const instant = zonedTimeToInstant(day, clock.hour, clock.minute, zone);
      if (instant && instant.getTime() > starts && instant.getTime() < ends) return instant.toISOString();
    }
    return null;
  };

  const submit = async () => {
    if (inFlight.current || busy) return;
    setError(null);
    setFailure(null);
    let leavingAt: string | null = null;
    if (kind === "leaving_early") {
      leavingAt = leavingInstant();
      if (!leavingAt) {
        setError(t(parseClockText(leaving) ? "teamSchedule.coverage.callOut.leavingOutside" : "teamSchedule.coverage.callOut.leavingInvalid"));
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await recordAbsence({ assignmentId: shift.id, expectedVersion: shift.version, kind, leavingAt, note, idempotencyKey: key.current });
      setDone(result);
      onRecorded();
    } catch (caught) {
      const classified = classifyCoverageFailure(caught);
      setFailure(classified);
      // The server may have saved it (no answer): the same key makes the retry safe; a stale shift needs a reload.
      if (classified.stale) onRecorded();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const window = shift.startTime && shift.endTime ? gapWindow({ workDate: shift.workDate, startTime: shift.startTime, endTime: shift.endTime, startsAt: shift.startsAt, endsAt: shift.endsAt }, zone, language, t) : formatWallClock(shift.workDate, shift.startTime, shift.startsAt, zone, language);
  const closeNow = () => onClose();

  if (done) {
    const gap = done.gap;
    const impact = done.impact;
    const unassessed = !impact || !impact.verified;
    return (
      <CoverageSheet
        visible={visible}
        title={t("teamSchedule.coverage.callOut.recorded")}
        subtitle={t("teamSchedule.coverage.callOut.recordedHint", { name: personName })}
        closeLabel={t("common.close")}
        onClose={closeNow}
        testID="call-out-done"
        footer={
          <>
            {gap ? <Button label={t("teamSchedule.coverage.action.findReplacement")} icon="people-outline" onPress={() => onFindCoverage(gap.id)} testID="call-out-find-replacement" /> : null}
            {impact?.verified && (impact.roomsRemaining ?? 0) > 0 ? (
              <Button label={t("teamSchedule.coverage.action.reviewRooms")} icon="home-outline" variant="secondary" onPress={() => onReviewRooms(shift.userId)} testID="call-out-review-rooms" />
            ) : null}
            <Button label={t("teamSchedule.coverage.action.returnToSchedule")} variant="ghost" onPress={closeNow} testID="call-out-return" />
          </>
        }
      >
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="call-out-need">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardLabel, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.impact.needed").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {gap ? gapTitle(gap, t) : shift.name ?? t("teamSchedule.coverage.shiftFallback")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textSecondary }]}>
            {gap ? gapWindow(gap, zone, language, t) : window}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textPrimary }]}>
            {t("teamSchedule.coverage.impact.oneUnavailable")}
          </Text>
        </View>
        {unassessed ? (
          <SheetNotice tone="warn" text={t("teamSchedule.coverage.impact.unassessed")} testID="call-out-impact-unassessed" />
        ) : impact ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="call-out-impact">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardLabel, { color: theme.textMuted }]}>
              {t("teamSchedule.coverage.impact.title").toUpperCase()}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textPrimary }]} testID="call-out-impact-rooms">
              {(impact.roomsAssigned ?? 0) === 0 ? t("teamSchedule.coverage.impact.noRooms") : t("teamSchedule.coverage.impact.rooms", { remaining: impact.roomsRemaining ?? 0, assigned: impact.roomsAssigned ?? 0 })}
            </Text>
            {(impact.roomsInProgress ?? 0) > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textPrimary }]}>
                {t("teamSchedule.coverage.impact.inProgress", { count: impact.roomsInProgress ?? 0 })}
              </Text>
            ) : null}
            {impact.estimatedMinutesRemaining !== null && (impact.roomsRemaining ?? 0) > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textSecondary }]}>
                {t("teamSchedule.coverage.impact.workload", { time: minutesText(impact.estimatedMinutesRemaining, t) })}
              </Text>
            ) : null}
            {impact.minutesLeftInShift !== null ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textSecondary }]}>
                {t("teamSchedule.coverage.impact.timeLeft", { time: minutesText(impact.minutesLeftInShift, t) })}
              </Text>
            ) : null}
          </View>
        ) : null}
        <SheetNotice text={t("teamSchedule.coverage.impact.roomsStay")} testID="call-out-rooms-stay" />
      </CoverageSheet>
    );
  }

  const offline = !isOnline;
  return (
    <CoverageSheet
      visible={visible}
      title={t("teamSchedule.coverage.callOut.title")}
      subtitle={t("teamSchedule.coverage.callOut.subtitle")}
      closeLabel={t("common.close")}
      onClose={closeNow}
      testID="call-out-sheet"
      footer={
        <>
          <Button label={t("teamSchedule.coverage.callOut.confirm")} icon="checkmark" onPress={() => void submit()} loading={busy} disabled={busy || offline} testID="call-out-confirm" />
          {offline ? <ErrorText text={t("teamSchedule.manage.offline")} testID="call-out-offline" /> : null}
        </>
      }
    >
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="call-out-shift">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
          {personName}
        </Text>
        {roleText ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textSecondary }]}>
            {roleText}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textPrimary }]}>
          {formatLongDate(shift.workDate, language)} · {window}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardBody, { color: theme.textMuted }]} testID="call-out-attendance">
          {attendanceText ?? t("teamSchedule.coverage.callOut.attendanceUnknown")}
        </Text>
      </View>

      <FieldLabel>{t("teamSchedule.coverage.callOut.reason")}</FieldLabel>
      <View style={styles.kinds} accessibilityRole="radiogroup">
        {ABSENCE_KINDS.map((option) => {
          const selected = option === kind;
          return (
            <Pressable
              key={option}
              onPress={() => setKind(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`teamSchedule.coverage.kind.${option}`)}
              testID={`call-out-kind-${option}`}
              style={[styles.kind, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}
            >
              <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? theme.primaryAction : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kindText, { color: theme.textPrimary }]}>
                {t(`teamSchedule.coverage.kind.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {kind === "leaving_early" ? (
        <TextField label={t("teamSchedule.coverage.callOut.leavingAt")} value={leaving} onChangeText={setLeaving} placeholder={t("teamSchedule.coverage.callOut.leavingPlaceholder")} testID="call-out-leaving" error={error} />
      ) : null}

      <TextField label={t("teamSchedule.coverage.callOut.note")} value={note} onChangeText={setNote} placeholder={t("teamSchedule.coverage.callOut.notePlaceholder")} testID="call-out-note" multiline maxLength={500} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("teamSchedule.coverage.callOut.privacy")}
      </Text>
      {failure ? <SheetNotice tone="error" text={failureText(failure, t)} testID="call-out-failure" /> : null}
    </CoverageSheet>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 4 },
  cardLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  cardBody: { fontSize: 14.5, lineHeight: 20 },
  kinds: { gap: 8 },
  kind: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12 },
  kindText: { flex: 1, fontSize: 15.5, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 18 },
});
