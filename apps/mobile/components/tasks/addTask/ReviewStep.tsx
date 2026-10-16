import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { dueTimeLabel, formatOtherDay } from "@/components/tasks/addTask/DueEditor";
import { Chip, ChipRow, Field, FieldError, ValueRow, inputStyle } from "@/components/tasks/addTask/formBits";
import { useTheme } from "@/lib/theme/useTheme";
import {
  ADD_TASK_LIMITS,
  ADD_TASK_PRIORITIES,
  ADD_TASK_TYPES,
  type DraftErrors,
  type TaskDraft,
} from "@/lib/tasks/addTask/draft";

export type SubmitProblem = "rejected" | "forbidden" | "signedOut" | "unconfirmed" | "offline";

interface BodyProps {
  draft: TaskDraft;
  /** Errors to display (the container decides when to reveal title/description errors). */
  errors: DraftErrors;
  fromDescription: boolean;
  submitProblem: SubmitProblem | null;
  zone: string | null | undefined;
  language: string;
  isHousekeeper: boolean;
  busy: boolean;
  onChange: (patch: Partial<TaskDraft>) => void;
  onEditLocation: () => void;
  onEditDue: () => void;
}

export function ReviewBody({
  draft,
  errors,
  fromDescription,
  submitProblem,
  zone,
  language,
  isHousekeeper,
  busy,
  onChange,
  onEditLocation,
  onEditDue,
}: BodyProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ai = fromDescription && draft.aiSuggested;

  const locationValue =
    draft.location.kind === "room"
      ? t("tasks.hk.add.field.locationRoom", { room: draft.location.roomNumber })
      : draft.location.kind === "place"
        ? draft.location.text
        : draft.location.kind === "unverified"
          ? t("tasks.hk.add.field.locationUnverified", { text: draft.location.text })
          : t("tasks.hk.add.field.locationNone");

  let dueValue = t("tasks.hk.add.field.dueNone");
  if (draft.due.mode === "unresolved") dueValue = t("tasks.hk.add.field.dueUnresolved");
  else if (draft.due.mode === "set") {
    const time = dueTimeLabel(draft.due, zone, language) || draft.due.time;
    dueValue =
      draft.due.day === "today"
        ? t("tasks.hk.add.field.dueToday", { time })
        : draft.due.day === "tomorrow"
          ? t("tasks.hk.add.field.dueTomorrow", { time })
          : t("tasks.hk.add.field.dueOther", { date: formatOtherDay(draft.due.iso, zone, language), time });
  }

  const locationError = errors.location
    ? t(`tasks.hk.add.error.location.${errors.location}`, {
        text: draft.location.kind === "unverified" ? draft.location.text : "",
        max: ADD_TASK_LIMITS.place,
      })
    : null;
  const dueError = errors.due ? t(`tasks.hk.add.error.due.${errors.due}`) : null;
  const inputColors = { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle };

  return (
    <View style={styles.wrap}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
        {t(ai ? "tasks.hk.add.review.introAi" : "tasks.hk.add.review.introManual")}
      </Text>
      {ai && draft.lowConfidence ? (
        <FieldError message={t("tasks.hk.add.review.lowConfidence")} testID="review-low-confidence" />
      ) : null}

      <Field label={t("tasks.hk.add.field.title")}>
        <TextInput
          value={draft.title}
          onChangeText={(title) => onChange({ title })}
          editable={!busy}
          placeholder={t("tasks.hk.add.field.titlePlaceholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("tasks.hk.add.field.title")}
          maxLength={ADD_TASK_LIMITS.title + 20}
          style={[inputStyle, inputColors, { borderColor: errors.title ? theme.status.dirty : theme.borderSubtle }]}
          testID="review-title"
        />
        <FieldError
          message={errors.title ? t(`tasks.hk.add.error.title.${errors.title}`, { max: ADD_TASK_LIMITS.title }) : null}
          testID="review-title-error"
        />
      </Field>

      <Field label={t("tasks.hk.add.field.location")}>
        <ValueRow
          label={t("tasks.hk.add.field.location")}
          value={locationValue}
          actionLabel={t(draft.location.kind === "none" ? "tasks.hk.add.field.locationChoose" : "tasks.hk.add.field.change")}
          onPress={onEditLocation}
          invalid={!!errors.location}
          testID="review-location"
        />
        <FieldError message={locationError} testID="review-location-error" />
      </Field>

      <Field label={t("tasks.hk.add.field.type")}>
        <ChipRow label={t("tasks.hk.add.field.type")}>
          {ADD_TASK_TYPES.map((type) => (
            <Chip
              key={type}
              label={t(`tasks.hk.add.type.${type}`)}
              selected={draft.type === type}
              onPress={() => onChange({ type })}
              testID={`review-type-${type}`}
            />
          ))}
        </ChipRow>
        <FieldError message={errors.type ? t("tasks.hk.add.error.type.required") : null} testID="review-type-error" />
      </Field>

      <Field label={t("tasks.hk.add.field.priority")}>
        <ChipRow label={t("tasks.hk.add.field.priority")}>
          {ADD_TASK_PRIORITIES.map((priority) => (
            <Chip
              key={priority}
              label={t(`tasks.hk.add.priority.${priority}`)}
              selected={draft.priority === priority}
              attention={priority === "urgent" && !draft.priorityConfirmed}
              onPress={() => onChange({ priority, priorityConfirmed: true })}
              testID={`review-priority-${priority}`}
            />
          ))}
        </ChipRow>
        <FieldError message={errors.priority ? t("tasks.hk.add.priority.confirm") : null} testID="review-priority-error" />
      </Field>

      <Field label={t("tasks.hk.add.field.due")}>
        <ValueRow
          label={t("tasks.hk.add.field.due")}
          value={dueValue}
          actionLabel={t("tasks.hk.add.field.change")}
          onPress={onEditDue}
          invalid={!!errors.due}
          testID="review-due"
        />
        <FieldError message={dueError} testID="review-due-error" />
      </Field>

      <Field label={t("tasks.hk.add.field.description")}>
        <TextInput
          value={draft.description}
          onChangeText={(description) => onChange({ description })}
          editable={!busy}
          multiline
          placeholder={t("tasks.hk.add.field.descriptionPlaceholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("tasks.hk.add.field.description")}
          textAlignVertical="top"
          maxLength={ADD_TASK_LIMITS.description + 20}
          style={[inputStyle, inputColors, styles.multiline, { borderColor: errors.description ? theme.status.dirty : theme.borderSubtle }]}
          testID="review-description"
        />
        <FieldError
          message={errors.description ? t("tasks.hk.add.error.description.tooLong", { max: ADD_TASK_LIMITS.description }) : null}
        />
      </Field>

      <View style={[styles.assign, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
        <View style={styles.assignText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignTitle, { color: theme.textPrimary }]}>
            {t("tasks.hk.add.field.assign")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
            {draft.assignToMe
              ? t("tasks.hk.add.field.assignOn")
              : t(draft.type === "housekeeping" && isHousekeeper ? "tasks.hk.add.field.assignOffHousekeeping" : "tasks.hk.add.field.assignOffOther")}
          </Text>
        </View>
        <Switch
          value={draft.assignToMe}
          onValueChange={(assignToMe) => onChange({ assignToMe })}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityLabel={t("tasks.hk.add.field.assign")}
          trackColor={{ true: theme.primaryAction, false: theme.border }}
          testID="review-assign"
        />
      </View>

      {submitProblem ? (
        <View
          style={[styles.problem, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
          accessibilityRole="alert"
          testID="review-submit-error"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.problemText, { color: theme.status.dirty }]}>
            {t(`tasks.hk.add.error.submit.${submitProblem}`)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface FooterProps {
  busy: boolean;
  showSummary: boolean;
  onCreate: () => void;
  onBack: () => void;
}

export function ReviewFooter({ busy, showSummary, onCreate, onBack }: FooterProps) {
  const { t } = useTranslation();
  return (
    <>
      {showSummary ? <FieldError message={t("tasks.hk.add.review.fixErrors")} testID="review-summary" /> : null}
      <Button label={t("tasks.hk.add.review.create")} onPress={onCreate} loading={busy} size="lg" icon="checkmark" testID="review-create" />
      <Button
        label={t("tasks.hk.add.review.back")}
        onPress={onBack}
        variant="secondary"
        disabled={busy}
        testID="review-back"
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  intro: { fontSize: 13.5, lineHeight: 19 },
  multiline: { minHeight: 88, maxHeight: 180, paddingTop: 10 },
  assign: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  assignText: { flex: 1, gap: 2 },
  assignTitle: { fontSize: 15, fontWeight: "700" },
  problem: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  problemText: { fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
});
