import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { issueKeepsWork, type SyncIssue } from "@/lib/engineering/syncStatusModel";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

type T = (key: string, options?: Record<string, unknown>) => string;

/** The work-order id an issue points at, when it has one. */
export const issueWorkOrderId = (issue: SyncIssue): string | null => (issue.source === "action" || issue.source === "claim" ? issue.woId : null);

/** One short line: what happened. Shared by the list row, the sheet and the row's spoken label. */
export function issueWhat(issue: SyncIssue, t: T): string {
  switch (issue.source) {
    case "action":
      return issue.stuck ? t("engineeringSync.state.stuck") : t(`engineeringSync.refused.${issue.reason ?? "unknown"}`, { defaultValue: t("engineeringSync.refused.unknown") });
    case "claim":
      return t(`workQueue.claim${issue.reason === "conflict" ? "Conflict" : issue.reason === "forbidden" ? "Forbidden" : "Gone"}`);
    case "report":
      return issue.message || t("engineeringSync.refused.unknown");
    case "pm":
      if (issue.stop) return t(`engineeringSync.pm.stop.${issue.stop}`, { defaultValue: t("engineeringSync.pm.stop.invalid") });
      return issue.unknownOutcome ? t("engineeringSync.pm.unknownNote") : t("engineeringSync.sheet.rejected");
  }
}

/** The row title: what kind of change and which work item. */
export function issueTitle(issue: SyncIssue, t: T): string {
  switch (issue.source) {
    case "action":
      return `${t(`engineeringSync.kind.${issue.kind}`)}${issue.label ? ` · ${issue.label}` : ""}`;
    case "claim":
      return issue.label ?? t("engineeringSync.kind.claim");
    case "report":
      return issue.title || t("engineeringSync.kind.report");
    case "pm":
      return issue.label;
  }
}

function sheetTitle(issue: SyncIssue, t: T): string {
  if (issue.source === "claim") return t("engineeringSync.sheet.claimTitle");
  if (issue.source === "report") return t("engineeringSync.sheet.reportTitle");
  if (issue.source === "pm") return t("engineeringSync.sheet.pmTitle");
  return t(issue.stuck ? "engineeringSync.sheet.stuckTitle" : "engineeringSync.sheet.orderTitle");
}

function keptText(issue: SyncIssue, t: T): string {
  if (issue.source === "pm") return t(issue.stop === "unreadable" ? "engineeringSync.sheet.notReadable" : "engineeringSync.sheet.keptPm");
  return t(issueKeepsWork(issue) ? "engineeringSync.sheet.kept" : "engineeringSync.sheet.notKept");
}

function nextText(issue: SyncIssue, t: T): string {
  switch (issue.source) {
    case "claim":
      return t("engineeringSync.sheet.nextClaim");
    case "report":
      return t("engineeringSync.sheet.nextReport");
    case "pm":
      return t("engineeringSync.sheet.nextInspection");
    case "action":
      return t(issue.stuck ? "engineeringSync.sheet.nextRetry" : issue.woId ? "engineeringSync.sheet.nextViewOrder" : "engineeringSync.sheet.nextReport");
  }
}

interface Props {
  issue: SyncIssue | null;
  onClose: () => void;
  onViewOrder: (woId: string) => void;
  onOpenInspection: (scheduleId: string) => void;
  onRetryAction: (queueId: number) => void;
  onRetryPm: (rowId: number) => void;
  onSubmitAnyway: (rowId: number) => void;
  /** Asks for the discard confirmation; nothing is removed by this sheet itself. */
  onDiscard: (issue: SyncIssue) => void;
  /** Asks for the dismiss confirmation (refused claims and reports: removes only the notice). */
  onDismiss: (issue: SyncIssue) => void;
}

/**
 * What happened, whether the person's work is still on this phone, and the next step. Only actions the queue says are safe
 * are offered: Retry only when the row ran out of automatic tries (never for a refusal that can't succeed unchanged), and
 * Submit anyway only for the stops the PM runner lists. Viewing a work order never resolves a conflict.
 */
export function SyncIssueSheet({ issue, onClose, onViewOrder, onOpenInspection, onRetryAction, onRetryPm, onSubmitAnyway, onDiscard, onDismiss }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const woId = issue ? issueWorkOrderId(issue) : null;
  const title = issue ? issueTitle(issue, t) : "";

  const rows: [string, string][] = issue
    ? [
        [t("engineeringSync.sheet.what"), issueWhat(issue, t)],
        [t("engineeringSync.sheet.work"), keptText(issue, t)],
        [t("engineeringSync.sheet.next"), nextText(issue, t)],
      ]
    : [];

  return (
    <BottomSheet
      visible={issue !== null}
      title={issue ? sheetTitle(issue, t) : ""}
      onClose={onClose}
      testID="esync-issue-sheet"
      footer={
        issue ? (
          <View style={styles.actions}>
            {woId ? (
              <Button
                label={t("engineeringSync.viewOrder")}
                accessibilityLabel={t("engineeringSync.viewOrderA11y", { label: issue.source === "claim" || issue.source === "action" ? (issue.label ?? woId) : woId })}
                onPress={() => onViewOrder(woId)}
                testID="esync-sheet-view"
              />
            ) : null}
            {issue.source === "pm" && issue.canOpen && issue.scheduleId ? (
              <Button label={t("engineeringSync.reviewInspection")} onPress={() => onOpenInspection(issue.scheduleId as string)} testID="esync-sheet-open" />
            ) : null}
            {issue.source === "action" && issue.canRetry ? <Button label={t("common.retry")} variant="secondary" onPress={() => onRetryAction(issue.queueId)} testID="esync-sheet-retry" /> : null}
            {issue.source === "pm" && issue.canRetry ? <Button label={t("engineeringSync.pm.retry")} variant="secondary" onPress={() => onRetryPm(issue.rowId)} testID="esync-sheet-retry" /> : null}
            {issue.source === "pm" && issue.canSubmitAnyway ? <Button label={t("engineeringSync.pm.submitAnyway")} variant="secondary" onPress={() => onSubmitAnyway(issue.rowId)} testID="esync-sheet-anyway" /> : null}
            {issue.source === "action" || issue.source === "pm" ? (
              <Button label={t("engineeringSync.discardChange")} variant="ghost" onPress={() => onDiscard(issue)} testID="esync-sheet-discard" />
            ) : (
              <Button label={t("engineeringSync.dismissNotice")} variant="ghost" onPress={() => onDismiss(issue)} testID="esync-sheet-dismiss" />
            )}
            <Button label={t("engineeringSync.close")} variant="ghost" onPress={onClose} testID="esync-sheet-close" />
          </View>
        ) : undefined
      }
    >
      {issue ? (
        <View style={styles.body}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} testID="esync-sheet-title">
            {title}
          </Text>
          {rows.map(([label, value], index) => (
            <View key={label} style={styles.block} testID={`esync-sheet-row-${index}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                {label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  title: { fontSize: 17, fontWeight: "800" },
  block: { gap: 2 },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 15, lineHeight: 21 },
  actions: { gap: 8 },
});
