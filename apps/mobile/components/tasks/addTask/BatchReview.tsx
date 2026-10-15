import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { dueTimeLabel, formatOtherDay } from "@/components/tasks/addTask/DueEditor";
import { FieldError } from "@/components/tasks/addTask/formBits";
import { useTheme } from "@/lib/theme/useTheme";
import { ADD_TASK_LIMITS, validateDraft, type DraftErrors, type TaskDraft } from "@/lib/tasks/addTask/draft";
import { summarizeBatch, type BatchHalt, type BatchItem, type BatchProblem } from "@/lib/tasks/addTask/batch";
import type { Task } from "@/lib/api/tasks";

/* Review of several suggested tasks. Every suggestion is its own card the person can include, leave out or
   edit; nothing exists until "Create" is pressed, and afterwards each card says exactly what the server did
   with it. The cards only describe -- editing opens the same single-task form used everywhere else. */

/** The one thing most worth telling the person about an incomplete suggestion. */
export function firstProblem(errors: DraftErrors, draft: TaskDraft): { key: string; params?: Record<string, unknown> } | null {
  if (errors.location === "unverified") {
    return { key: "tasks.hk.add.error.location.unverified", params: { text: draft.location.kind === "unverified" ? draft.location.text : "" } };
  }
  if (errors.title) return { key: `tasks.hk.add.error.title.${errors.title}`, params: { max: ADD_TASK_LIMITS.title } };
  if (errors.type) return { key: "tasks.hk.add.error.type.required" };
  if (errors.location) return { key: `tasks.hk.add.error.location.${errors.location}`, params: { max: ADD_TASK_LIMITS.place } };
  if (errors.due) return { key: `tasks.hk.add.error.due.${errors.due}` };
  if (errors.priority) return { key: "tasks.hk.add.priority.confirm" };
  if (errors.description) return { key: "tasks.hk.add.error.description.tooLong", params: { max: ADD_TASK_LIMITS.description } };
  return null;
}

interface BodyProps {
  items: BatchItem[];
  originalText: string;
  zone: string | null | undefined;
  language: string;
  now: Date;
  busy: boolean;
  /** Show incomplete cards as problems (after a Create press, or when nothing else is happening). */
  revealProblems: boolean;
  halted: BatchHalt | null;
  onToggle: (key: string, include: boolean) => void;
  onEdit: (key: string) => void;
  onView: (task: Task) => void;
}

const PROBLEM_KEY: Record<BatchProblem, string> = {
  invalid: "tasks.hk.add.batch.problem.invalid",
  rejected: "tasks.hk.add.batch.problem.rejected",
  forbidden: "tasks.hk.add.batch.problem.forbidden",
  signedOut: "tasks.hk.add.batch.problem.signedOut",
  unconfirmed: "tasks.hk.add.batch.problem.unconfirmed",
  offline: "tasks.hk.add.batch.problem.offline",
};

export function BatchBody({ items, originalText, zone, language, now, busy, revealProblems, halted, onToggle, onEdit, onView }: BodyProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const summary = summarizeBatch(items);
  const anyCreated = summary.created > 0;
  const total = items.length;

  return (
    <View style={styles.wrap}>
      <View style={styles.found} accessibilityLiveRegion="polite">
        <Ionicons name="sparkles-outline" size={15} color={theme.textSecondary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.foundText, { color: theme.textPrimary }]} testID="batch-found">
          {t("tasks.hk.add.batch.found", { count: total })}
        </Text>
      </View>
      {!anyCreated ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("tasks.hk.add.batch.intro")}
        </Text>
      ) : null}
      {originalText ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={3} style={[styles.original, { color: theme.textMuted }]} testID="batch-original">
          {t("tasks.hk.add.batch.original", { text: originalText })}
        </Text>
      ) : null}

      {anyCreated ? (
        <View
          style={[styles.status, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="batch-created-summary"
        >
          <Ionicons name="checkmark-circle" size={16} color={theme.status.clean} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusText, { color: theme.status.clean }]}>
            {t("tasks.hk.add.batch.createdCount", { count: summary.created, total: summary.included })}
          </Text>
        </View>
      ) : null}
      {halted ? (
        <FieldError message={t(`tasks.hk.add.batch.halted.${halted}`)} testID="batch-halted" />
      ) : null}

      {items.map((item, index) => {
        const validation = validateDraft(item.draft, zone, now);
        const problem = firstProblem(validation.errors, item.draft);
        const created = item.status === "created";
        const showProblem = item.include && !created && !validation.valid && revealProblems;
        const draft = item.draft;
        const room =
          draft.location.kind === "room"
            ? t("tasks.hk.add.field.locationRoom", { room: draft.location.roomNumber })
            : draft.location.kind === "unverified"
              ? t("tasks.hk.add.field.locationUnverified", { text: draft.location.text })
              : draft.location.kind === "place"
                ? draft.location.text
                : t("tasks.hk.add.field.locationNone");
        let due: string | null = null;
        if (draft.due.mode === "unresolved") due = t("tasks.hk.add.field.dueUnresolved");
        else if (draft.due.mode === "set") {
          const time = dueTimeLabel(draft.due, zone, language) || draft.due.time;
          due =
            draft.due.day === "today"
              ? t("tasks.hk.add.field.dueToday", { time })
              : draft.due.day === "tomorrow"
                ? t("tasks.hk.add.field.dueTomorrow", { time })
                : t("tasks.hk.add.field.dueOther", { date: formatOtherDay(draft.due.iso, zone, language), time });
        }
        const left = !item.include && !created;
        const border = created ? theme.status.cleanLine : item.status === "failed" || showProblem ? theme.status.dirtyLine : theme.borderSubtle;
        return (
          <View
            key={item.key}
            style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: border, opacity: left ? 0.6 : 1 }]}
            testID={`batch-card-${index}`}
          >
            <View style={styles.cardHead}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.eyebrow, { color: theme.textMuted }]}>
                {t("tasks.hk.add.batch.taskN", { n: index + 1 })}
              </Text>
              {!created && item.status !== "creating" ? (
                <Pressable
                  onPress={() => onEdit(item.key)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("tasks.hk.add.batch.editA11y", { n: index + 1, title: draft.title })}
                  style={styles.iconButton}
                  testID={`batch-edit-${index}`}
                >
                  <Ionicons name="create-outline" size={20} color={busy ? theme.textDisabled : theme.primaryAction} />
                </Pressable>
              ) : null}
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} testID={`batch-title-${index}`}>
              {draft.title}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
              {t("tasks.hk.add.batch.where", { place: room })}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
              {draft.type ? t("tasks.hk.add.batch.type", { type: t(`tasks.hk.add.type.${draft.type}`) }) : t("tasks.hk.add.error.type.required")}
              {" · "}
              {t("tasks.hk.add.batch.priority", { priority: t(`tasks.hk.add.priority.${draft.priority}`) })}
            </Text>
            {due ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                {due}
              </Text>
            ) : null}
            {draft.priority === "urgent" && !draft.priorityConfirmed ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.status.dirty }]}>
                {t("tasks.hk.add.priority.confirm")}
              </Text>
            ) : null}
            {draft.lowConfidence && !created ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.status.pickup }]}>
                {t("tasks.hk.add.review.lowConfidence")}
              </Text>
            ) : null}

            {showProblem && problem ? (
              <FieldError message={t(problem.key, problem.params)} testID={`batch-problem-${index}`} />
            ) : null}

            {created ? (
              <View style={styles.resultRow}>
                <Ionicons name="checkmark-circle" size={18} color={theme.status.clean} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.result, { color: theme.status.clean }]} testID={`batch-created-${index}`}>
                  {t(item.replayed ? "tasks.hk.add.batch.alreadyCreated" : "tasks.hk.add.batch.created")}
                </Text>
                {item.task ? (
                  <Pressable
                    onPress={() => onView(item.task as Task)}
                    accessibilityRole="button"
                    accessibilityLabel={t("tasks.hk.add.batch.viewA11y", { title: draft.title })}
                    style={styles.viewLink}
                    testID={`batch-view-${index}`}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.viewText, { color: theme.primaryAction }]}>
                      {t("tasks.hk.add.success.view")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : item.status === "creating" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} accessibilityLiveRegion="polite" testID={`batch-creating-${index}`}>
                {t("tasks.hk.add.batch.creating")}
              </Text>
            ) : item.status === "failed" && item.problem ? (
              <View style={styles.failedRow}>
                <Ionicons name="alert-circle" size={18} color={theme.status.dirty} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.result, { color: theme.status.dirty }]} testID={`batch-failed-${index}`}>
                  {t(PROBLEM_KEY[item.problem])}
                </Text>
              </View>
            ) : halted && item.include && item.status === "ready" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID={`batch-unsent-${index}`}>
                {t("tasks.hk.add.batch.unsent")}
              </Text>
            ) : null}

            {!created ? (
              <Pressable
                onPress={() => onToggle(item.key, !item.include)}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.include, disabled: busy }}
                accessibilityLabel={t("tasks.hk.add.batch.includeA11y", { n: index + 1, title: draft.title })}
                style={styles.includeRow}
                testID={`batch-include-${index}`}
              >
                <Ionicons name={item.include ? "checkbox" : "square-outline"} size={24} color={item.include ? theme.primaryAction : theme.textMuted} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.includeText, { color: theme.textPrimary }]}>
                  {t("tasks.hk.add.batch.include")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

interface FooterProps {
  busy: boolean;
  /** Tasks the primary button would create. */
  count: number;
  /** Included tasks that still need fixing. */
  needsFix: boolean;
  anyCreated: boolean;
  /** Something failed or was never sent, so the primary button retries. */
  retrying: boolean;
  onCreate: () => void;
  onBack: () => void;
  onDone: () => void;
}

export function BatchFooter({ busy, count, needsFix, anyCreated, retrying, onCreate, onBack, onDone }: FooterProps) {
  const { t } = useTranslation();
  if (count === 0) {
    // Nothing left to send: either everything was created or everything was left out.
    return anyCreated ? (
      <Button label={t("tasks.hk.add.batch.done")} onPress={onDone} size="lg" icon="checkmark" testID="batch-done" />
    ) : (
      <>
        <FieldError message={t("tasks.hk.add.batch.noneIncluded")} testID="batch-none" />
        <Button label={t("tasks.hk.add.batch.back")} onPress={onBack} variant="secondary" testID="batch-back" />
      </>
    );
  }
  return (
    <>
      {needsFix ? <FieldError message={t("tasks.hk.add.review.fixErrors")} testID="batch-summary" /> : null}
      <Button
        label={t(retrying ? "tasks.hk.add.batch.retry" : "tasks.hk.add.batch.create", { count })}
        onPress={onCreate}
        loading={busy}
        size="lg"
        icon={retrying ? "refresh" : "checkmark"}
        testID="batch-create"
      />
      {anyCreated ? (
        <Button label={t("tasks.hk.add.batch.finish")} onPress={onDone} variant="secondary" disabled={busy} testID="batch-finish" />
      ) : (
        <Button label={t("tasks.hk.add.batch.back")} onPress={onBack} variant="secondary" disabled={busy} testID="batch-back" />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  found: { flexDirection: "row", alignItems: "center", gap: 8 },
  foundText: { fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 13.5, lineHeight: 19 },
  original: { fontSize: 13, lineHeight: 18, fontStyle: "italic" },
  status: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  statusText: { flex: 1, fontSize: 13.5, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, gap: 3 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10, marginTop: -6 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "800" },
  meta: { fontSize: 13.5, lineHeight: 19 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4, flexWrap: "wrap" },
  failedRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 4 },
  result: { flexShrink: 1, fontSize: 13.5, fontWeight: "700" },
  viewLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  viewText: { fontSize: 14, fontWeight: "800" },
  includeRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, marginTop: 2 },
  includeText: { fontSize: 15, fontWeight: "700" },
});
