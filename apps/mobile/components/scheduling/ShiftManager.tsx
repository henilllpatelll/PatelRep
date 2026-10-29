import { useCallback, useEffect, useState } from "react";
import DirectMessageModal from "@/components/supervisor/DirectMessageModal";
import { CallOutSheet } from "@/components/scheduling/CallOutSheet";
import { ShiftDetailSheet } from "@/components/scheduling/ShiftDetailSheet";
import { ShiftFormSheet } from "@/components/scheduling/ShiftFormSheet";
import type { CoverageGap } from "@/lib/api/schedulingCoverage";
import type { TeamPerson, TeamShift } from "@/lib/api/schedulingTeam";
import type { FormMode } from "@/lib/scheduling/shiftForm";
import type { DayRoster, RosterPerson } from "@/lib/scheduling/teamScheduleModel";
import { personName, rolesLine, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTemplates } from "@/lib/scheduling/useTemplates";
import type { SavedSummary } from "@/lib/scheduling/useShiftFormFlow";
import { useToast } from "@/lib/theme/useToast";

/** What the Add / Edit / Copy form was opened for. */
export interface FormRequest {
  mode: FormMode;
  source: TeamShift | null;
  date: string;
  userId?: string | null;
  /** Open the employee picker straight away (the "Reassign" action). */
  reassign?: boolean;
}

interface Props {
  roster: DayRoster | null;
  /** Everybody in the supervisor's scope (not only people with a shift today). */
  people: readonly TeamPerson[];
  /** Every shift the schedule holds for the loaded week. */
  rows: readonly TeamShift[];
  openUserId: string | null;
  openShiftId: string | null;
  onCloseDetail: () => void;
  form: FormRequest | null;
  onForm: (request: FormRequest | null) => void;
  today: string;
  zone: string | null;
  language?: string;
  isOnline: boolean;
  /** Re-read the schedule after any change. */
  onChanged: () => void | Promise<void>;
  onOpenAssignments: (userId: string) => void;
  onOpenTemplates: () => void;
  /** Call-outs and coverage (Phase 4). */
  coverageFor: (assignmentId: string) => CoverageGap | null;
  onFindCoverage: (gapId: string) => void;
  onCoverageChanged: () => void;
  t: Translate;
}

/**
 * The one place Today and Week share for looking at and changing shifts: detail, add/edit/copy, message. Neither
 * screen keeps its own editing logic. The screen keeps its own date, filters, search and scroll position, because this
 * only ever opens sheets on top of it.
 */
export function ShiftManager({ roster, people, rows, openUserId, openShiftId, onCloseDetail, form, onForm, today, zone, language, isOnline, onChanged, onOpenAssignments, onOpenTemplates, coverageFor, onFindCoverage, onCoverageChanged, t }: Props) {
  const toast = useToast();
  const [messageTo, setMessageTo] = useState<RosterPerson | null>(null);
  // The call-out drawer outlives the detail sheet it was opened from (one modal at a time), so it keeps its own copy.
  const [callOut, setCallOut] = useState<{ shift: TeamShift; name: string; role: string | null; attendance: string | null } | null>(null);
  const templates = useTemplates({ enabled: form !== null });
  const reloadTemplates = templates.reload;

  // Templates are re-read each time a form opens, so a template edited in between is never stale.
  useEffect(() => {
    if (form) void reloadTemplates();
    // only the opening matters
  }, [form !== null]);

  const sheetPerson = roster?.people.find((person) => person.userId === openUserId) ?? null;

  const startCallOut = useCallback(
    (shift: TeamShift) => {
      const person = roster?.people.find((candidate) => candidate.userId === shift.userId) ?? null;
      const status = person?.status ?? null;
      setCallOut({
        shift,
        name: person ? personName(person, t) : t("teamSchedule.coverage.someone"),
        role: person ? rolesLine(person.roles, t) : null,
        attendance: status ? t(`teamSchedule.detail.statusHint.${status}`) : null,
      });
      onCloseDetail();
    },
    [roster, t, onCloseDetail],
  );

  const saved = useCallback(
    (summary: SavedSummary) => {
      onForm(null);
      onCloseDetail();
      void onChanged();
      const base =
        summary.kind === "updated"
          ? t(summary.alreadySaved ? "teamSchedule.manage.saved.alreadySaved" : "teamSchedule.manage.saved.updated")
          : summary.count === 0
            ? t("teamSchedule.manage.saved.alreadyThere")
            : t("teamSchedule.manage.saved.created", { count: summary.count });
      toast.success(summary.warnings.length > 0 ? `${base} ${t("teamSchedule.manage.saved.withWarnings", { count: summary.warnings.length })}` : base);
    },
    [onCloseDetail, onChanged, onForm, t, toast],
  );

  const gone = useCallback(() => {
    onForm(null);
    onCloseDetail();
    void onChanged();
    toast.info(t("teamSchedule.manage.saved.gone"));
  }, [onCloseDetail, onChanged, onForm, t, toast]);

  return (
    <>
      <ShiftDetailSheet
        person={sheetPerson}
        roster={roster}
        rows={rows}
        initialShiftId={openShiftId}
        zone={zone}
        language={language}
        isOnline={isOnline}
        onChanged={() => void onChanged()}
        onEdit={(shift, reassign) => onForm({ mode: "edit", source: shift, date: shift.workDate, userId: shift.userId, reassign })}
        onCopy={(shift) => onForm({ mode: "copy", source: shift, date: shift.workDate, userId: shift.userId })}
        onMessage={setMessageTo}
        onOpenAssignments={onOpenAssignments}
        coverageFor={coverageFor}
        onCallOut={startCallOut}
        onFindCoverage={(gapId) => {
          onCloseDetail();
          onFindCoverage(gapId);
        }}
        onClose={onCloseDetail}
        t={t}
      />
      {form ? (
        <ShiftFormSheet
          key={`${form.mode}:${form.source?.id ?? "new"}:${form.date}`}
          mode={form.mode}
          source={form.source}
          date={form.date}
          userId={form.userId}
          reassign={form.reassign}
          today={today}
          zone={zone}
          language={language}
          people={people}
          shifts={rows}
          templates={templates.state.templates}
          templatesFailed={templates.state.status === "failed" || templates.state.error}
          onRetryTemplates={() => void reloadTemplates()}
          isOnline={isOnline}
          onSaved={saved}
          onClose={() => onForm(null)}
          onGone={gone}
          onOpenTemplates={() => {
            onForm(null);
            onOpenTemplates();
          }}
          t={t}
        />
      ) : null}
      <CallOutSheet
        shift={callOut?.shift ?? null}
        personName={callOut?.name ?? ""}
        roleText={callOut?.role ?? null}
        attendanceText={callOut?.attendance ?? null}
        zone={zone}
        language={language}
        isOnline={isOnline}
        onClose={() => setCallOut(null)}
        onRecorded={() => {
          void onChanged();
          onCoverageChanged();
        }}
        onFindCoverage={(gapId) => {
          setCallOut(null);
          onFindCoverage(gapId);
        }}
        onReviewRooms={(userId) => {
          setCallOut(null);
          onOpenAssignments(userId);
        }}
        t={t}
      />
      <DirectMessageModal visible={messageTo !== null} recipientId={messageTo?.userId ?? null} recipientName={messageTo?.name ?? null} isOnline={isOnline} onClose={() => setMessageTo(null)} />
    </>
  );
}
