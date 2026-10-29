import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { DateStepper, ErrorText, FieldLabel, TextField, ValueRow } from "@/components/scheduling/formParts";
import { EmployeePicker } from "@/components/scheduling/EmployeePicker";
import { FailurePanel, ReviewList, VersionConflictPanel, WarningsList } from "@/components/scheduling/ShiftReview";
import { Choice } from "@/components/supervisor/board/BoardFilterSheet";
import { Button } from "@/components/ui/Button";
import type { ShiftTemplate } from "@/lib/api/schedulingManage";
import type { TeamPerson, TeamShift } from "@/lib/api/schedulingTeam";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import {
  draftForCopy,
  draftFromShift,
  emptyDraft,
  isDirty,
  NOTES_MAX,
  occurrenceDates,
  RECURRENCE_MAX_DAYS,
  resolveTimes,
  validateDraft,
  type FormMode,
  type ShiftDraft,
} from "@/lib/scheduling/shiftForm";
import { durationText, formErrorText, overnightHint } from "@/lib/scheduling/shiftText";
import { addDaysToYmd, formatLongDate, formatWallClock, mondayIndex } from "@/lib/scheduling/teamScheduleDates";
import { departmentLabel, rolesLine, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useShiftFormFlow, type SavedSummary } from "@/lib/scheduling/useShiftFormFlow";
import { useTheme } from "@/lib/theme/useTheme";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface ShiftFormProps {
  mode: FormMode;
  /** The shift being edited or copied. */
  source: TeamShift | null;
  /** Day the form opens on for a new shift. */
  date: string;
  /** Pre-chosen employee for a new shift (the person whose card the supervisor came from). */
  userId?: string | null;
  /** Open the employee picker straight away (the "Reassign" action). */
  reassign?: boolean;
  today: string;
  zone: string | null;
  language?: string;
  people: readonly TeamPerson[];
  /** The shifts already on the schedule, to show what a person has on the chosen day. */
  shifts: readonly TeamShift[];
  templates: readonly ShiftTemplate[] | null;
  templatesFailed: boolean;
  onRetryTemplates: () => void;
  isOnline: boolean;
  onSaved: (summary: SavedSummary) => void;
  onClose: () => void;
  onGone: () => void;
  onOpenTemplates: () => void;
  t: Translate;
}

/**
 * Add, Edit and Copy Shift: one form. Saving is an IMMEDIATE schedule change (there is no draft or notification
 * step yet) and the form says so. The server validates every write; this form only gives early, plain feedback.
 * Mount it with a `key` so each opening starts from its own draft.
 */
export function ShiftFormSheet(props: ShiftFormProps) {
  const loading = props.templates === null && !props.templatesFailed;
  if (loading) {
    // The starting draft depends on the shift's template (to tell a custom time from the template's), so the form
    // waits for the templates instead of guessing and then showing the wrong thing.
    return (
      <BottomSheet visible title={props.t("teamSchedule.manage.form.addTitle")} onClose={props.onClose} testID="shift-form-loading">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
          {props.t("teamSchedule.manage.templates.loading")}
        </Text>
      </BottomSheet>
    );
  }
  // Remounts if the templates arrive after a failed first read, so the draft is rebuilt against them.
  return <ShiftFormBody key={props.templates ? "ready" : "failed"} {...props} />;
}

function ShiftFormBody(props: ShiftFormProps) {
  const { mode, source, date, userId, reassign, today, zone, language, people, shifts, templates, templatesFailed, onRetryTemplates, isOnline, onSaved, onClose, onGone, onOpenTemplates, t } = props;
  const theme = useTheme();
  const active = useMemo(() => (templates ?? []).filter((template) => template.isActive && !template.archived), [templates]);
  const templateOf = useCallback((id: string | null) => (id ? (templates ?? []).find((template) => template.id === id) ?? null : null), [templates]);
  const personOf = useCallback((id: string | null) => (id ? people.find((person) => person.userId === id) ?? null : null), [people]);
  const nameOf = useCallback((id: string) => personOf(id)?.name ?? t("teamSchedule.unnamed"), [personOf, t]);

  const initial = useMemo<ShiftDraft>(() => {
    if (source && mode === "edit") return draftFromShift(source, templateOf(source.shiftId), personOf(source.userId)?.departmentId ?? null);
    if (source && mode === "copy") return draftForCopy(source, templateOf(source.shiftId), personOf(source.userId)?.departmentId ?? null, today);
    const base = emptyDraft(date < today ? today : date);
    const person = personOf(userId ?? null);
    return person ? { ...base, userId: person.userId, departmentId: person.departmentId } : base;
    // The first opening decides the starting point; later data refreshes must not reset a half-made form.
  }, []);
  const [draft, setDraft] = useState<ShiftDraft>(initial);
  const [pickerOpen, setPickerOpen] = useState(Boolean(reassign));
  const [showErrors, setShowErrors] = useState(false);

  const flow = useShiftFormFlow({ mode, source, templateOf, onSaved, onGone });
  const template = templateOf(draft.templateId);
  const errors = validateDraft(draft, { today, template }, mode);
  const person = personOf(draft.userId);
  const { times } = resolveTimes(draft, template);
  const dirty = isDirty(draft, initial);
  const guard = useDiscardGuard({ dirty, busy: flow.busy, onClose });
  const set = useCallback((patch: Partial<ShiftDraft>) => setDraft((held) => ({ ...held, ...patch })), []);

  // Templates the chosen employee can actually work: their department's, falling back to the department filter.
  const deptId = person?.departmentId ?? draft.departmentId;
  const choices = useMemo(() => active.filter((candidate) => !deptId || candidate.departmentId === deptId), [active, deptId]);
  const existing = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const shift of shifts) {
      if (shift.workDate !== draft.date || shift.carriedFromPreviousDay || shift.id === source?.id) continue;
      const text = `${formatWallClock(shift.workDate, shift.startTime, shift.startsAt, zone, language)} – ${formatWallClock(shift.workDate, shift.endTime, shift.endsAt, zone, language)}`;
      map.set(shift.userId, [...(map.get(shift.userId) ?? []), text]);
    }
    return map;
  }, [shifts, draft.date, source?.id, zone, language]);
  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const candidate of people) if (candidate.departmentId && candidate.departmentCode) seen.set(candidate.departmentId, candidate.departmentCode);
    return [...seen.entries()];
  }, [people]);

  const recurringCount = draft.recurring ? occurrenceDates(draft.date, draft.endDate, draft.weekdays).length : 1;
  const review = flow.step === "review" && flow.preview !== null;
  const offlineBlocked = !isOnline;
  const submit = () => {
    setShowErrors(true);
    if (errors.length > 0 || !template || offlineBlocked) return;
    void flow.submit(draft, template);
  };
  const confirm = () => {
    if (!template || offlineBlocked) return;
    void flow.confirm(draft, template);
  };
  const reload = () => {
    const next = flow.adoptLatest();
    if (next) {
      setDraft(next);
      setShowErrors(false);
    }
  };

  const title = t(mode === "edit" ? "teamSchedule.manage.form.editTitle" : mode === "copy" ? "teamSchedule.manage.form.copyTitle" : "teamSchedule.manage.form.addTitle");
  const primaryLabel = review
    ? flow.preview && flow.preview.warnings.length > 0
      ? t("teamSchedule.manage.form.saveAnyway")
      : t("teamSchedule.manage.form.createCount", { count: flow.preview?.createCount ?? 0 })
    : mode === "edit"
      ? t("teamSchedule.manage.form.saveChanges")
      : draft.recurring
        ? t("teamSchedule.manage.form.reviewCount", { count: recurringCount })
        : t("teamSchedule.manage.form.save");
  const unconfirmed = flow.failure?.kind === "unconfirmed";

  const footer = (
    <View style={styles.footer}>
      {review ? <Button label={t("teamSchedule.manage.form.back")} variant="secondary" onPress={flow.backToForm} disabled={flow.busy} testID="shift-form-back" /> : null}
      <Button
        label={unconfirmed ? t("teamSchedule.manage.form.checkAndRetry") : primaryLabel}
        onPress={review ? confirm : submit}
        loading={flow.busy}
        disabled={flow.busy || offlineBlocked || (flow.latest !== null)}
        testID="shift-form-save"
      />
    </View>
  );

  return (
    <>
      <BottomSheet visible title={title} onClose={guard} footer={footer} tall testID="shift-form" scrollKey={flow.failure ? `f:${flow.failure.kind}` : review ? "review" : null}>
        <View style={styles.body}>
          <SheetNotice text={t("teamSchedule.manage.form.immediate")} testID="shift-form-immediate" />
          {offlineBlocked ? <SheetNotice tone="warn" text={t("teamSchedule.manage.offline")} testID="shift-form-offline" /> : null}
          {flow.latest ? <VersionConflictPanel fields={flow.changedFields} onReload={reload} busy={flow.busy} t={t} /> : flow.failure ? <FailurePanel failure={flow.failure} t={t} /> : null}

          {review && flow.preview ? (
            <>
              <ReviewList preview={flow.preview} nameOf={nameOf} zone={zone} language={language} t={t} />
              <WarningsList warnings={flow.preview.warnings} t={t} />
            </>
          ) : (
            <>
              <View style={styles.group}>
                <FieldLabel>{t("teamSchedule.manage.form.employee")}</FieldLabel>
                {departments.length > 1 && mode !== "edit" ? (
                  <View style={styles.choices} accessibilityRole="radiogroup">
                    <Choice kind="radio" selected={draft.departmentId === null} label={t("teamSchedule.manage.form.allDepartments")} onPress={() => set({ departmentId: null })} testID="shift-form-dept-all" />
                    {departments.map(([id, code]) => (
                      <Choice key={id} kind="radio" selected={draft.departmentId === id} label={departmentLabel(code, t)} onPress={() => set({ departmentId: id, ...(person && person.departmentId !== id ? { userId: null, templateId: null } : {}) })} testID={`shift-form-dept-${code}`} />
                    ))}
                  </View>
                ) : null}
                <ValueRow
                  label={t("teamSchedule.manage.form.employee")}
                  value={person ? [person.name ?? t("teamSchedule.unnamed"), rolesLine(person.roles, t)].filter(Boolean).join(" · ") : null}
                  placeholder={t("teamSchedule.manage.form.chooseEmployee")}
                  onPress={() => setPickerOpen(true)}
                  testID="shift-form-employee"
                />
                {showErrors && errors.includes("employee") ? <ErrorText text={formErrorText("employee", t)} testID="shift-form-employee-error" /> : null}
              </View>

              <View style={styles.group}>
                <FieldLabel>{t("teamSchedule.manage.form.date")}</FieldLabel>
                <DateStepper
                  label={t("teamSchedule.manage.form.date")}
                  value={formatLongDate(draft.date, language)}
                  onPrev={() => set({ date: addDaysToYmd(draft.date, -1) })}
                  onNext={() => set({ date: addDaysToYmd(draft.date, 1) })}
                  prevDisabled={draft.date <= today}
                  prevLabel={t("teamSchedule.prevDay")}
                  nextLabel={t("teamSchedule.nextDay")}
                  testID="shift-form-date"
                />
                {errors.includes("pastDate") ? <ErrorText text={formErrorText("pastDate", t)} testID="shift-form-date-error" /> : null}
              </View>

              <View style={styles.group}>
                <FieldLabel>{t("teamSchedule.manage.form.template")}</FieldLabel>
                {templates === null ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                    {t(templatesFailed ? "teamSchedule.manage.templates.loadFailed" : "teamSchedule.manage.templates.loading")}
                  </Text>
                ) : choices.length === 0 ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="shift-form-no-templates">
                    {t("teamSchedule.manage.form.noTemplates")}
                  </Text>
                ) : (
                  <View style={styles.choices} accessibilityRole="radiogroup">
                    {choices.map((choice) => (
                      <Choice
                        key={choice.id}
                        kind="radio"
                        selected={draft.templateId === choice.id}
                        label={`${choice.name} · ${t("teamSchedule.window", { start: formatWallClock(draft.date, choice.startTime, "", zone, language), end: formatWallClock(draft.date, choice.endTime, "", zone, language) })}`}
                        onPress={() => set({ templateId: choice.id, departmentId: choice.departmentId ?? draft.departmentId })}
                        testID={`shift-form-template-${choice.id}`}
                      />
                    ))}
                  </View>
                )}
                {templatesFailed ? <Button label={t("teamSchedule.retry")} size="sm" variant="secondary" onPress={onRetryTemplates} testID="shift-form-templates-retry" /> : null}
                <Button label={t("teamSchedule.manage.form.manageTemplates")} size="sm" variant="ghost" icon="layers-outline" onPress={onOpenTemplates} testID="shift-form-open-templates" />
                {showErrors && errors.includes("template") ? <ErrorText text={formErrorText("template", t)} testID="shift-form-template-error" /> : null}
              </View>

              <View style={styles.switchRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.switchLabel, { color: theme.textPrimary }]}>
                  {t("teamSchedule.manage.form.customTimes")}
                </Text>
                <Switch value={draft.customTimes} onValueChange={(on) => set({ customTimes: on, startText: on && !draft.startText ? "" : draft.startText })} accessibilityLabel={t("teamSchedule.manage.form.customTimes")} testID="shift-form-custom" />
              </View>
              {draft.customTimes ? (
                <View style={styles.timeRow}>
                  <View style={styles.timeCell}>
                    <TextField label={t("teamSchedule.manage.form.start")} value={draft.startText} onChangeText={(startText) => set({ startText })} placeholder="7:00 AM" testID="shift-form-start" error={showErrors && (errors.includes("startTime") || errors.includes("sameTimes")) ? formErrorText(errors.includes("startTime") ? "startTime" : "sameTimes", t) : null} />
                  </View>
                  <View style={styles.timeCell}>
                    <TextField label={t("teamSchedule.manage.form.end")} value={draft.endText} onChangeText={(endText) => set({ endText })} placeholder="3:00 PM" testID="shift-form-end" error={showErrors && errors.includes("endTime") ? formErrorText("endTime", t) : null} />
                  </View>
                </View>
              ) : null}
              {times ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="shift-form-times">
                  {[
                    t("teamSchedule.window", { start: formatWallClock(draft.date, `${times.start.value}:00`, "", zone, language), end: formatWallClock(draft.date, `${times.end.value}:00`, "", zone, language) }),
                    durationText(times.start, times.end, t),
                    overnightHint(times.start, times.end, t),
                  ].filter(Boolean).join(" · ")}
                </Text>
              ) : null}

              <TextField label={t("teamSchedule.manage.form.notes")} value={draft.notes} onChangeText={(notes) => set({ notes })} placeholder={t("teamSchedule.manage.form.notesPlaceholder")} testID="shift-form-notes" multiline maxLength={NOTES_MAX} />

              {mode !== "edit" ? (
                <View style={styles.group}>
                  <View style={styles.switchRow}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.switchLabel, { color: theme.textPrimary }]}>
                      {t("teamSchedule.manage.form.recurring")}
                    </Text>
                    <Switch value={draft.recurring} onValueChange={(on) => set({ recurring: on, weekdays: on && draft.weekdays.length === 0 ? [mondayIndex(draft.date)] : draft.weekdays })} accessibilityLabel={t("teamSchedule.manage.form.recurring")} testID="shift-form-recurring" />
                  </View>
                  {draft.recurring ? (
                    <>
                      <FieldLabel>{t("teamSchedule.manage.form.repeatOn")}</FieldLabel>
                      <View style={styles.choices}>
                        {WEEKDAYS.map((day) => (
                          <Choice key={day} kind="checkbox" selected={draft.weekdays.includes(day)} label={t(`teamSchedule.manage.weekday.${WEEKDAY_KEYS[day]}`)} onPress={() => set({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort() })} testID={`shift-form-weekday-${day}`} />
                        ))}
                      </View>
                      {showErrors && errors.includes("weekdays") ? <ErrorText text={formErrorText("weekdays", t)} testID="shift-form-weekdays-error" /> : null}
                      <FieldLabel>{t("teamSchedule.manage.form.until")}</FieldLabel>
                      <DateStepper label={t("teamSchedule.manage.form.until")} value={formatLongDate(draft.endDate, language)} onPrev={() => set({ endDate: addDaysToYmd(draft.endDate, -1) })} onNext={() => set({ endDate: addDaysToYmd(draft.endDate, 1) })} prevDisabled={draft.endDate <= draft.date} prevLabel={t("teamSchedule.prevDay")} nextLabel={t("teamSchedule.nextDay")} testID="shift-form-until" />
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                        {t("teamSchedule.manage.form.recurringLimit", { days: RECURRENCE_MAX_DAYS })}
                      </Text>
                      {errors.filter((e) => e === "endDate" || e === "rangeTooLong" || e === "noOccurrences" || e === "tooMany").map((e) => (
                        <ErrorText key={e} text={formErrorText(e, t)} testID={`shift-form-${e}`} />
                      ))}
                    </>
                  ) : null}
                </View>
              ) : null}
              {showErrors && errors.includes("notesTooLong") ? <ErrorText text={formErrorText("notesTooLong", t)} /> : null}
            </>
          )}
        </View>
      </BottomSheet>
      <EmployeePicker
        visible={pickerOpen}
        people={people}
        departmentId={draft.departmentId}
        selectedId={draft.userId}
        existing={existing}
        dateLabel={formatLongDate(draft.date, language)}
        onSelect={(chosen) => {
          // A different department's templates do not apply: drop a template that no longer fits.
          const keep = template && chosen.departmentId && template.departmentId !== chosen.departmentId ? { templateId: null } : {};
          set({ userId: chosen.userId, departmentId: chosen.departmentId ?? draft.departmentId, ...keep });
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        t={t}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  group: { gap: 8 },
  choices: { gap: 8 },
  muted: { fontSize: 13.5, lineHeight: 19 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
  timeRow: { flexDirection: "row", gap: 10 },
  timeCell: { flex: 1 },
  footer: { gap: 8 },
});
