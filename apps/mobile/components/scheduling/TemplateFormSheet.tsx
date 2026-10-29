import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { ErrorText, FieldLabel, TextField } from "@/components/scheduling/formParts";
import { Choice } from "@/components/supervisor/board/BoardFilterSheet";
import { Button } from "@/components/ui/Button";
import { archiveTemplate, createTemplate, fetchTemplateUsage, updateTemplate, type ShiftTemplate, type TemplateUsage, type WriteFailure } from "@/lib/api/schedulingManage";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { parseTimeText, templateClock } from "@/lib/scheduling/shiftForm";
import { failureBody, failureTitle } from "@/lib/scheduling/shiftText";
import { departmentLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useWriteGuard } from "@/lib/scheduling/useWriteGuard";
import { useTheme } from "@/lib/theme/useTheme";

const NAME_MAX = 80;

export interface DepartmentOption {
  id: string;
  code: string;
}

interface Props {
  /** null = create a new template. */
  template: ShiftTemplate | null;
  departments: readonly DepartmentOption[];
  isOnline: boolean;
  /** The list changed (saved / archived): refresh it. */
  onChanged: () => void;
  onClose: () => void;
  t: Translate;
}

/** The clock a template shows in its field: 24-hour "07:00", which parses back exactly in any language. */
function fieldText(value: string | null | undefined): string {
  return templateClock(value)?.value ?? "";
}

/**
 * Create or edit a shift template. A template is only a pattern for NEW shifts: shifts already on the schedule keep
 * the times they were created with, and the editor says how many there are before anything changes.
 */
export function TemplateFormSheet({ template, departments, isOnline, onChanged, onClose, t }: Props) {
  const theme = useTheme();
  const { busy, run } = useWriteGuard();
  const [name, setName] = useState(template?.name ?? "");
  const [startText, setStartText] = useState(fieldText(template?.startTime));
  const [endText, setEndText] = useState(fieldText(template?.endTime));
  const [departmentId, setDepartmentId] = useState<string | null>(template?.departmentId ?? (departments.length === 1 ? departments[0].id : null));
  const [active, setActive] = useState(template?.isActive ?? true);
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [usage, setUsage] = useState<TemplateUsage | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);

  useEffect(() => {
    if (!template) return;
    let live = true;
    fetchTemplateUsage(template.id).then(
      (found) => live && setUsage(found),
      () => live && setUsageFailed(true),
    );
    return () => {
      live = false;
    };
  }, [template]);

  const start = parseTimeText(startText);
  const end = parseTimeText(endText);
  const trimmed = name.trim();
  const errors = {
    name: trimmed.length === 0,
    department: !template && !departmentId,
    start: start === null,
    end: end === null,
    same: start !== null && end !== null && start.minutes === end.minutes,
  };
  const invalid = errors.name || errors.department || errors.start || errors.end || errors.same;
  const dirty = template
    ? trimmed !== template.name || active !== template.isActive || start?.value !== templateClock(template.startTime)?.value || end?.value !== templateClock(template.endTime)?.value
    : trimmed !== "" || startText !== "" || endText !== "";
  const guard = useDiscardGuard({ dirty, busy, onClose });

  const save = async () => {
    setShowErrors(true);
    if (invalid || !start || !end || !isOnline) return;
    setFailure(null);
    const res = await run(() =>
      template
        ? updateTemplate(template.id, { name: trimmed, startTime: start.value, endTime: end.value, isActive: active, expectedVersion: template.version })
        : createTemplate({ name: trimmed, departmentId: departmentId as string, startTime: start.value, endTime: end.value }),
    );
    if (!res) return;
    if (res.ok) {
      onChanged();
      onClose();
      return;
    }
    if (res.failure.kind === "version_conflict") onChanged();
    setFailure(res.failure);
  };

  const archive = () => {
    if (!template) return;
    const upcoming = usage?.upcoming ?? 0;
    const past = usage?.past ?? 0;
    Alert.alert(
      t("teamSchedule.manage.templates.archiveTitle", { name: template.name }),
      usage ? t("teamSchedule.manage.templates.archiveMessage", { upcoming, past }) : t("teamSchedule.manage.templates.archiveMessageUnknown"),
      [
        { text: t("teamSchedule.manage.cancel.keep"), style: "cancel" },
        {
          text: t("teamSchedule.manage.templates.archive"),
          style: "destructive",
          onPress: async () => {
            setFailure(null);
            const res = await run(() => archiveTemplate(template.id));
            if (!res) return;
            if (res.ok) {
              onChanged();
              onClose();
            } else {
              setFailure(res.failure);
            }
          },
        },
      ],
    );
  };

  const unconfirmed = failure?.kind === "unconfirmed";
  const title = t(template ? "teamSchedule.manage.templates.editTitle" : "teamSchedule.manage.templates.createTitle");

  return (
    <BottomSheet
      visible
      title={title}
      onClose={guard}
      tall
      testID="template-form"
      footer={
        <View style={styles.footer}>
          <Button label={unconfirmed ? t("teamSchedule.manage.form.checkAndRetry") : t(template ? "teamSchedule.manage.form.saveChanges" : "teamSchedule.manage.templates.create")} onPress={save} loading={busy} disabled={busy || !isOnline} testID="template-form-save" />
          {template && !template.archived ? <Button label={t("teamSchedule.manage.templates.archive")} variant="destructive" onPress={archive} disabled={busy || !isOnline} testID="template-form-archive" /> : null}
        </View>
      }
    >
      <View style={styles.body}>
        <SheetNotice text={t("teamSchedule.manage.templates.onlyNew")} testID="template-form-only-new" />
        {!isOnline ? <SheetNotice tone="warn" text={t("teamSchedule.manage.offline")} /> : null}
        {failure ? <SheetNotice tone="error" text={`${failureTitle(failure, t)}. ${failureBody(failure, t)}`} testID="template-form-failure" /> : null}

        <TextField label={t("teamSchedule.manage.templates.name")} value={name} onChangeText={setName} placeholder={t("teamSchedule.manage.templates.namePlaceholder")} testID="template-form-name" maxLength={NAME_MAX} error={showErrors && errors.name ? t("teamSchedule.manage.templates.nameRequired") : null} />

        {!template ? (
          <View style={styles.group}>
            <FieldLabel>{t("teamSchedule.manage.templates.department")}</FieldLabel>
            <View style={styles.group} accessibilityRole="radiogroup">
              {departments.map((option) => (
                <Choice key={option.id} kind="radio" selected={departmentId === option.id} label={departmentLabel(option.code, t)} onPress={() => setDepartmentId(option.id)} testID={`template-form-dept-${option.code}`} />
              ))}
            </View>
            {departments.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="template-form-no-departments">
                {t("teamSchedule.manage.templates.noDepartments")}
              </Text>
            ) : null}
            {showErrors && errors.department ? <ErrorText text={t("teamSchedule.manage.templates.departmentRequired")} testID="template-form-department-error" /> : null}
          </View>
        ) : null}

        <View style={styles.timeRow}>
          <View style={styles.timeCell}>
            <TextField label={t("teamSchedule.manage.form.start")} value={startText} onChangeText={setStartText} placeholder="7:00 AM" testID="template-form-start" error={showErrors && errors.start ? t("teamSchedule.manage.formError.startTime") : null} />
          </View>
          <View style={styles.timeCell}>
            <TextField label={t("teamSchedule.manage.form.end")} value={endText} onChangeText={setEndText} placeholder="3:00 PM" testID="template-form-end" error={showErrors && (errors.end || errors.same) ? t(errors.end ? "teamSchedule.manage.formError.endTime" : "teamSchedule.manage.formError.sameTimes") : null} />
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
          {t("teamSchedule.manage.templates.overnightHint")}
        </Text>

        {template ? (
          <>
            <View style={styles.switchRow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.switchLabel, { color: theme.textPrimary }]}>
                {t("teamSchedule.manage.templates.active")}
              </Text>
              <Switch value={active} onValueChange={setActive} accessibilityLabel={t("teamSchedule.manage.templates.active")} testID="template-form-active" />
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="template-form-usage">
              {usage ? t("teamSchedule.manage.templates.usage", { upcoming: usage.upcoming, past: usage.past }) : usageFailed ? t("teamSchedule.manage.templates.usageFailed") : t("teamSchedule.manage.templates.usageLoading")}
            </Text>
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  group: { gap: 8 },
  muted: { fontSize: 13.5, lineHeight: 19 },
  timeRow: { flexDirection: "row", gap: 10 },
  timeCell: { flex: 1 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
  footer: { gap: 8 },
});
