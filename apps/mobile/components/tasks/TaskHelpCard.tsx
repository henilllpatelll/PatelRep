import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import type { Task } from "@/lib/api/tasks";
import type { Viewer } from "@/lib/tasks/taskActions";
import { explainSentences } from "@/lib/tasks/explainTask";
import { ProcedureLinks } from "@/components/sop/ProcedureLinks";
import { useRelatedProcedures } from "@/lib/sop/useRelatedProcedures";

/* "Need help?" on the task detail: two optional, clearly separate things. Explain reads the task back in plain
   words from its own stored fields (no AI call, no cost, nothing invented). Ask Assistant opens the assistant
   about this task; it is offered only when the server will let this person use the task as context. Neither
   changes the task. */

interface Props {
  task: Task;
  viewer: Viewer;
  zone: string | null;
  language: string;
  now: Date;
  offline: boolean;
  /** Present only when the assistant exists on this screen and may be pointed at this task. */
  onAskAssistant?: () => void;
  /** Open the assistant about this task, ready for a procedure question (nothing is asked until they send it). */
  onFindProcedure?: () => void;
  /** Open one of the hotel's procedures (the caller closes this sheet first). */
  onOpenProcedure?: (documentId: string) => void;
}

export function TaskHelpCard({ task, viewer, zone, language, now, offline, onAskAssistant, onFindProcedure, onOpenProcedure }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // Only the hotel's own procedures that match this task, from the list already on the phone; no model, no cost.
  const related = useRelatedProcedures([task.title, task.description, task.task_type], !!onOpenProcedure);

  const lines = useMemo(
    () => (open ? explainSentences(task, viewer, { now, zone, language }, t) : []),
    [open, task, viewer, now, zone, language, t],
  );

  return (
    <View style={styles.section} testID="task-help">
      <View style={styles.titleRow}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textMuted }]}>
          {t("tasks.hk.help.title")}
        </Text>
      </View>
      <Button
        label={t(open ? "tasks.hk.help.hide" : "tasks.hk.help.explain")}
        onPress={() => setOpen((value) => !value)}
        variant="secondary"
        icon="help-circle-outline"
        testID="task-help-explain"
      />
      {open ? (
        <View
          style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          accessibilityLiveRegion="polite"
          testID="task-help-explanation"
        >
          {lines.map((line, index) => (
            <Text key={index} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]} testID={`explain-line-${index}`}>
              {line}
            </Text>
          ))}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.source, { color: theme.textMuted }]}>
            {t("tasks.hk.help.source")}
          </Text>
        </View>
      ) : null}
      {onOpenProcedure ? <ProcedureLinks docs={related} onOpen={onOpenProcedure} /> : null}
      {onFindProcedure ? (
        <Button
          label={t("tasks.hk.help.findProcedure")}
          onPress={onFindProcedure}
          variant="secondary"
          icon="book-outline"
          disabled={offline}
          testID="task-help-procedure"
        />
      ) : null}
      {onAskAssistant ? (
        <>
          <Button
            label={t("tasks.hk.help.ask")}
            onPress={onAskAssistant}
            variant="secondary"
            icon="chatbubbles-outline"
            disabled={offline}
            testID="task-help-ask"
          />
          {offline ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
              {t("tasks.hk.help.askOffline")}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  line: { fontSize: 14.5, lineHeight: 21 },
  source: { fontSize: 12.5, lineHeight: 18, paddingTop: 2 },
  note: { fontSize: 12.5, lineHeight: 18 },
});
