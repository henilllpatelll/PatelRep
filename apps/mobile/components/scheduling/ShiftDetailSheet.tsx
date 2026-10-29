import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetActionRow, SheetNotice } from "@/components/home/sheetParts";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { ScheduleStatusBadge } from "@/components/scheduling/ScheduleStatusBadge";
import { ShiftDetailBody } from "@/components/scheduling/ShiftDetailBody";
import type { CoverageGap } from "@/lib/api/schedulingCoverage";
import { cancelShift } from "@/lib/api/schedulingManage";
import { stageChange } from "@/lib/api/schedulingRevisions";
import type { TeamShift } from "@/lib/api/schedulingTeam";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import type { DayRoster, DayShift, RosterPerson } from "@/lib/scheduling/teamScheduleModel";
import { periodLabel, personName, rolesLine, windowText, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useShiftDetail } from "@/lib/scheduling/useShiftDetail";
import { useWriteGuard } from "@/lib/scheduling/useWriteGuard";
import { useTheme } from "@/lib/theme/useTheme";

/** The part-of-day label, unless the shift is already named that ("Morning · Morning" adds nothing). */
function periodText(name: string | null, period: Parameters<typeof periodLabel>[0], t: Translate): string | null {
  const label = periodLabel(period, t);
  return label && name && label.trim().toLowerCase() === name.trim().toLowerCase() ? null : label;
}

interface Props {
  person: RosterPerson | null;
  roster: DayRoster | null;
  /** The schedule's own rows, for the version and template a shift needs to be edited. */
  rows: readonly TeamShift[];
  /** Opens on this shift when the person has several that day. */
  initialShiftId?: string | null;
  zone: string | null;
  language?: string;
  isOnline: boolean;
  /** The schedule changed (a shift was cancelled): refresh it. */
  onChanged: () => void;
  /** Removing a shift adds a cancellation to the draft instead of removing it now. */
  stage?: boolean;
  onEdit: (shift: TeamShift, reassign: boolean) => void;
  onCopy: (shift: TeamShift) => void;
  onMessage: (person: RosterPerson) => void;
  /** Opens the same person in Assignments (who cleans which rooms). Scheduling never edits room work. */
  onOpenAssignments: (userId: string) => void;
  /** The coverage gap a recorded call-out opened for a shift (open, offered or recently filled), if any. */
  coverageFor: (assignmentId: string) => CoverageGap | null;
  /** Record that the person will not work this shift (opens the call-out drawer). */
  onCallOut: (shift: TeamShift) => void;
  onFindCoverage: (gapId: string) => void;
  onClose: () => void;
  t: Translate;
}

/**
 * One person's shifts for the selected day, with the full detail of the chosen one and the actions a supervisor
 * may take on it. Every change is an immediate schedule change; the server decides what is allowed, and this sheet
 * only explains up front why an action is unavailable.
 */
export function ShiftDetailSheet({ person, roster, rows, initialShiftId, zone, language, isOnline, onChanged, stage = false, onEdit, onCopy, onMessage, onOpenAssignments, coverageFor, onCallOut, onFindCoverage, onClose, t }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = person !== null;
  const name = person ? personName(person, t) : "";
  const role = person ? rolesLine(person.roles, t) : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialShiftId ?? null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const { busy, run } = useWriteGuard();

  // A different person (or a deep link to one of their shifts) starts from the right shift with no stale message.
  useEffect(() => {
    setSelectedId(initialShiftId ?? null);
    setNotice(null);
  }, [person?.userId, initialShiftId]);

  const shift: DayShift | null = person ? (person.shifts.find((candidate) => candidate.id === selectedId) ?? person.shifts[0] ?? null) : null;
  const row = shift ? rows.find((candidate) => candidate.id === shift.id) ?? null : null;
  const detailState = useShiftDetail(shift?.id ?? null, row?.version ?? null, visible && shift !== null);
  const detail = detailState.state.status === "ready" ? detailState.state.detail : null;
  const hasAttendance = (detail?.attendance.sessions.length ?? 0) > 0;

  const editBlocked = !isOnline
    ? t("teamSchedule.manage.offline")
    : !row
      ? t("teamSchedule.manage.detail.notEditableData")
      : detail && !detail.editable
        ? t("teamSchedule.manage.detail.pastLocked")
        : hasAttendance
          ? t("teamSchedule.manage.detail.attendanceLocked")
          : detail === null
            ? t("teamSchedule.manage.detail.checking")
            : null;

  const gap = row ? coverageFor(row.id) : null;
  const callOutBlocked = !isOnline
    ? t("teamSchedule.manage.offline")
    : !row
      ? t("teamSchedule.manage.detail.notEditableData")
      : Date.parse(row.endsAt) <= Date.now()
        ? t("teamSchedule.coverage.shiftEnded")
        : null;

  const confirmCancel = () => {
    if (!row || !shift) return;
    Alert.alert(
      t(stage ? "teamSchedule.publish.cancel.title" : "teamSchedule.manage.cancel.title"),
      t(stage ? "teamSchedule.publish.cancel.message" : "teamSchedule.manage.cancel.message", { name, window: windowText(shift, t), date: formatLongDate(shift.workDate, language) }),
      [
        { text: t("teamSchedule.manage.cancel.keep"), style: "cancel" },
        { text: t(stage ? "teamSchedule.publish.cancel.confirm" : "teamSchedule.manage.cancel.confirm"), style: "destructive", onPress: () => void doCancel(row) },
      ],
    );
  };

  const doCancel = async (target: TeamShift) => {
    setNotice(null);
    const res = await run(async () => {
      if (stage) await stageChange({ kind: "cancel", assignmentId: target.id, expectedVersion: target.version });
      else await cancelShift(target.id, target.version);
    });
    if (!res) return;
    if (res.ok) {
      onChanged();
      onClose();
      return;
    }
    const kind = res.failure.kind;
    if (kind === "not_found") {
      // Already gone (removed by someone else, or our own earlier attempt landed): the goal is met.
      onChanged();
      onClose();
    } else if (kind === "version_conflict") {
      onChanged();
      setNotice({ tone: "error", text: t("teamSchedule.manage.cancel.changed") });
    } else if (kind === "unconfirmed") {
      onChanged();
      setNotice({ tone: "error", text: t("teamSchedule.manage.cancel.unconfirmed") });
    } else {
      setNotice({ tone: "error", text: t(`teamSchedule.manage.cancel.failed.${kind === "locked" || kind === "attendance" || kind === "forbidden" ? kind : "other"}`) });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-schedule-detail-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="team-schedule-detail-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {person && roster ? (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.who}>
                <Avatar name={name} size={48} />
                <View style={styles.whoText}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.name, { color: theme.textPrimary }]} numberOfLines={3}>
                    {name}
                  </Text>
                  {role ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                      {role}
                    </Text>
                  ) : null}
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                    {formatLongDate(roster.date, language)}
                  </Text>
                </View>
              </View>

              {person.status ? (
                <View style={styles.block}>
                  <ScheduleStatusBadge status={person.status} t={t} testID="team-schedule-detail-status" />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                    {t(`teamSchedule.detail.statusHint.${person.status}`)}
                  </Text>
                </View>
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="team-schedule-detail-plan-only">
                  {t("teamSchedule.detail.planOnly")}
                </Text>
              )}

              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
                {t("teamSchedule.detail.shifts").toUpperCase()}
              </Text>
              {person.shifts.length === 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="team-schedule-detail-unscheduled">
                  {t("teamSchedule.detail.noShift")}
                </Text>
              ) : (
                person.shifts.map((candidate) => {
                  const selected = candidate.id === shift?.id;
                  return (
                    <Pressable
                      key={candidate.id}
                      onPress={() => setSelectedId(candidate.id)}
                      disabled={person.shifts.length === 1}
                      accessibilityRole={person.shifts.length === 1 ? "text" : "radio"}
                      accessibilityState={{ selected }}
                      style={[styles.shift, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}
                      testID={`team-schedule-detail-shift-${candidate.id}`}
                    >
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.shiftTime, { color: theme.textPrimary }]}>
                        {windowText(candidate, t)}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                        {[candidate.name, periodText(candidate.name, candidate.period, t), candidate.draft ? t("teamSchedule.draft") : null, candidate.carried ? t("teamSchedule.carried") : null].filter(Boolean).join(" · ")}
                      </Text>
                    </Pressable>
                  );
                })
              )}

              {shift ? <ShiftDetailBody shift={shift} roles={person.roles} state={detailState.state} zone={zone} language={language} t={t} /> : null}
              {notice ? <SheetNotice tone={notice.tone} text={notice.text} testID="shift-detail-notice" /> : null}
              {gap ? <SheetNotice tone={gap.status === "filled" ? "info" : "warn"} text={gap.status === "filled" ? t("teamSchedule.coverage.shiftStatus.filled", { name: gap.filledUserName ?? t("teamSchedule.coverage.someone") }) : t(`teamSchedule.coverage.shiftStatus.${gap.status}`)} testID="shift-detail-coverage" /> : null}

              <View style={styles.actions}>
                {shift && row ? (
                  <>
                    <SheetActionRow icon="create-outline" title={t("teamSchedule.manage.action.edit")} hint={t("teamSchedule.manage.action.editHint")} disabledReason={editBlocked} onPress={() => onEdit(row, false)} testID="shift-action-edit" />
                    <SheetActionRow icon="swap-horizontal-outline" title={t("teamSchedule.manage.action.reassign")} hint={t("teamSchedule.manage.action.reassignHint")} disabledReason={editBlocked} onPress={() => onEdit(row, true)} testID="shift-action-reassign" />
                    <SheetActionRow icon="copy-outline" title={t("teamSchedule.manage.action.copy")} hint={t("teamSchedule.manage.action.copyHint")} disabledReason={isOnline ? null : t("teamSchedule.manage.offline")} onPress={() => onCopy(row)} kind="form" testID="shift-action-copy" />
                  </>
                ) : null}
                {shift && row && !gap ? <SheetActionRow icon="call-outline" title={t("teamSchedule.coverage.action.recordCallOut")} hint={t("teamSchedule.coverage.action.recordCallOutHint")} disabledReason={callOutBlocked} onPress={() => onCallOut(row)} kind="form" testID="shift-action-call-out" /> : null}
                {gap ? <SheetActionRow icon="people-circle-outline" title={t(gap.status === "open" || gap.status === "offered" ? "teamSchedule.coverage.action.findCoverage" : "teamSchedule.coverage.action.viewCoverage")} hint={t("teamSchedule.coverage.action.coverageHint")} onPress={() => onFindCoverage(gap.id)} testID="shift-action-coverage" /> : null}
                <SheetActionRow icon="chatbubble-ellipses-outline" title={t("teamSchedule.manage.action.message")} hint={t("teamSchedule.manage.action.messageHint")} disabledReason={isOnline ? null : t("teamSchedule.manage.offline")} onPress={() => onMessage(person)} testID="shift-action-message" />
                <SheetActionRow icon="people-outline" title={t("teamSchedule.detail.openAssignments")} hint={t("teamSchedule.detail.assignmentsHint")} onPress={() => onOpenAssignments(person.userId)} testID="team-schedule-detail-assignments" accessibilityLabel={t("teamSchedule.detail.openAssignments")} />
                {shift && row ? <SheetActionRow icon="trash-outline" title={t("teamSchedule.manage.action.cancel")} hint={t("teamSchedule.manage.action.cancelHint")} disabledReason={busy ? t("teamSchedule.manage.cancel.working") : editBlocked} onPress={confirmCancel} testID="shift-action-cancel" /> : null}
              </View>
            </ScrollView>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-schedule-detail-close" style={({ pressed }) => [styles.close, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, pressed && { opacity: 0.8 }]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.closeText, { color: theme.textPrimary }]}>
              {t("common.close")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  whoText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 14, lineHeight: 19 },
  block: { gap: 6 },
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
  shift: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 2, minHeight: MIN_TARGET },
  shiftTime: { fontSize: 17, fontWeight: "700" },
  actions: { gap: 8, marginTop: 4 },
  close: { minHeight: MIN_TARGET, marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 15, fontWeight: "700" },
});
