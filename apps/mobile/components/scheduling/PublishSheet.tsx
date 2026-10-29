import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { ImpactPerson, ReviewIssue } from "@/lib/api/schedulingRevisions";
import { impactLine, issueText, notificationHeadline, pushLines, rangeText, stampText } from "@/lib/scheduling/publishText";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { usePublishFlow } from "@/lib/scheduling/usePublishFlow";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  /** The draft being published; null = closed. */
  revisionId: string | null;
  zone: string | null;
  language?: string;
  isOnline: boolean;
  onClose: () => void;
  /** The publication committed: the schedule and the drafts should be re-read. */
  onPublished: () => void;
  onViewPublished: () => void;
  onViewDetails: (revisionId: string) => void;
  t: Translate;
}

const GROUP_AFTER = 6;

/** Review → explicit confirmation → publish → what happened. "Published" is only ever shown from the server's committed answer. */
export function PublishSheet(props: Props) {
  if (!props.revisionId) return null;
  return <PublishBody {...props} revisionId={props.revisionId} />;
}

function PublishBody({ revisionId, zone, language, isOnline, onClose, onPublished, onViewPublished, onViewDetails, t }: Props & { revisionId: string }) {
  const theme = useTheme();
  const flow = usePublishFlow(revisionId);
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { phase, review } = flow;
  const done = phase === "published" && flow.result !== null;

  const close = () => {
    if (done) onPublished();
    onClose();
  };

  const title = t(done ? "teamSchedule.publish.doneTitle" : "teamSchedule.publish.title");
  const busy = phase === "publishing";
  const footer = done ? (
    <View style={styles.footer}>
      <Button label={t("teamSchedule.publish.viewPublished")} onPress={() => { onPublished(); onViewPublished(); }} testID="publish-view-published" />
      <Button label={t("teamSchedule.publish.viewDetails")} variant="secondary" onPress={() => { onPublished(); onViewDetails(revisionId); }} testID="publish-view-details" />
    </View>
  ) : phase === "review" && review ? (
    <View style={styles.footer}>
      <Pressable
        onPress={() => setConfirmed((held) => !held)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed, disabled: !review.canPublish }}
        disabled={!review.canPublish}
        style={[styles.confirm, { borderColor: confirmed ? theme.primaryAction : theme.border, opacity: review.canPublish ? 1 : 0.5 }]}
        testID="publish-confirm-check"
      >
        <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={24} color={confirmed ? theme.primaryAction : theme.textSecondary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.confirmText, { color: theme.textPrimary }]}>
          {t("teamSchedule.publish.confirmText", { changes: t("teamSchedule.publish.confirmChanges", { count: review.summary.totalChanges }), employees: t("teamSchedule.publish.confirmEmployees", { count: review.summary.employeesAffected }) })}
        </Text>
      </Pressable>
      <Button
        label={t("teamSchedule.publish.publishCount", { count: review.summary.totalChanges })}
        onPress={() => void flow.publish()}
        disabled={!review.canPublish || !confirmed || !isOnline}
        testID="publish-confirm"
      />
    </View>
  ) : phase === "unconfirmed" ? (
    <View style={styles.footer}>
      <Button label={t("teamSchedule.publish.checkAgain")} onPress={() => void flow.retryUnconfirmed()} disabled={!isOnline} testID="publish-check-again" />
    </View>
  ) : phase === "failed" || phase === "review_failed" ? (
    <View style={styles.footer}>
      <Button label={t(phase === "failed" ? "teamSchedule.publish.reviewAgain" : "common.retry")} onPress={() => void flow.reload()} testID="publish-reload" />
    </View>
  ) : undefined;

  return (
    <BottomSheet visible title={title} onClose={busy ? () => undefined : close} footer={footer} tall testID="publish-sheet" scrollKey={phase === "failed" || phase === "unconfirmed" ? phase : null}>
      {phase === "review_loading" ? <Muted text={t("teamSchedule.publish.loading")} testID="publish-loading" /> : null}
      {phase === "review_failed" ? <Notice tone="error" text={t("teamSchedule.publish.reviewFailed")} testID="publish-review-failed" /> : null}

      {phase === "failed" && flow.failure ? (
        <View style={styles.block}>
          <Notice tone="error" text={t(`teamSchedule.publish.failure.${flow.failure.kind}`)} testID="publish-failed" />
          {flow.failure.blocking.map((issue, index) => (
            <IssueRow key={`${issue.code}-${index}`} issue={issue} tone="block" t={t} />
          ))}
        </View>
      ) : null}
      {phase === "unconfirmed" ? <Notice tone="error" text={t("teamSchedule.publish.unconfirmed")} testID="publish-unconfirmed" /> : null}
      {phase === "publishing" ? <Muted text={t("teamSchedule.publish.publishing")} testID="publish-publishing" /> : null}

      {done && flow.result ? (
        <View style={styles.block} testID="publish-done">
          <View style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={28} color={theme.status.ready} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.doneTitle, { color: theme.textPrimary }]}>
              {t("teamSchedule.publish.done")}
            </Text>
          </View>
          {review?.dateRange ? <Line label={t("teamSchedule.publish.dateRange")} value={rangeText(review.dateRange, language)} /> : null}
          <Line label={t("teamSchedule.publish.employees")} value={String(flow.result.employeesAffected)} />
          <Line label={t("teamSchedule.publish.shifts")} value={t("teamSchedule.publish.counts", { created: flow.result.created, updated: flow.result.updated, cancelled: flow.result.cancelled })} />
          {flow.result.publishedAt ? <Line label={t("teamSchedule.publish.publishedAt")} value={stampText(flow.result.publishedAt, zone, language)} /> : null}
          <View style={[styles.notify, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="publish-notify">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
              {t("teamSchedule.publish.notify.title")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="publish-notify-headline">
              {notificationHeadline(flow.notifications, flow.notificationsFailed, t)}
            </Text>
            {pushLines(flow.notifications, t).map((line) => (
              <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
                {line}
              </Text>
            ))}
            {flow.notifications && flow.notifications.total > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
                {t("teamSchedule.publish.notify.noConfirmation")}
              </Text>
            ) : null}
            {flow.notifications?.state === "failed" ? (
              <Button label={t("teamSchedule.publish.notify.retry")} size="sm" variant="secondary" onPress={() => void flow.retryFailedNotifications()} testID="publish-notify-retry" />
            ) : null}
          </View>
        </View>
      ) : null}

      {phase === "review" && review ? (
        <View style={styles.block}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="publish-subtitle">
            {[rangeText(review.dateRange, language), review.department, t("teamSchedule.publish.status.draft")].filter(Boolean).join(" · ")}
          </Text>
          <View style={styles.tiles}>
            <Tile label={t("teamSchedule.publish.tile.new")} value={review.summary.created} testID="publish-tile-new" />
            <Tile label={t("teamSchedule.publish.tile.modified")} value={review.summary.modified} testID="publish-tile-modified" />
            <Tile label={t("teamSchedule.publish.tile.cancelled")} value={review.summary.cancelled} testID="publish-tile-cancelled" />
            <Tile label={t("teamSchedule.publish.tile.reassigned")} value={review.summary.reassigned} testID="publish-tile-reassigned" />
            <Tile label={t("teamSchedule.publish.tile.employees")} value={review.summary.employeesAffected} testID="publish-tile-employees" />
          </View>

          {review.blocking.length > 0 ? (
            <View style={styles.block} testID="publish-blocking">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.destructiveAction }]}>
                {t("teamSchedule.publish.blocking", { count: review.blocking.length })}
              </Text>
              {review.blocking.map((issue, index) => (
                <IssueRow key={`${issue.code}-${index}`} issue={issue} tone="block" t={t} />
              ))}
            </View>
          ) : null}
          {review.warnings.length > 0 ? (
            <View style={styles.block} testID="publish-warnings">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.status.pickup }]}>
                {t("teamSchedule.publish.warnings", { count: review.warnings.length })}
              </Text>
              {review.warnings.map((issue, index) => (
                <IssueRow key={`${issue.code}-${index}`} issue={issue} tone="warn" t={t} />
              ))}
            </View>
          ) : null}

          <ImpactList people={review.impact} expanded={expanded} onExpand={() => setExpanded(true)} zone={zone} language={language} t={t} />

          <View style={[styles.note, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="publish-forecast">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
              {t(review.forecast.available ? "teamSchedule.publish.forecast.available" : "teamSchedule.publish.forecast.unavailable")}
            </Text>
          </View>

          {!isOnline ? <Muted text={t("teamSchedule.publish.offline")} testID="publish-offline" /> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Tile({ label, value, testID }: { label: string; value: number; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function Muted({ text, testID }: { text: string; testID: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID={testID}>
      {text}
    </Text>
  );
}

function Notice({ text, testID }: { tone?: "error"; text: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.noticeBox, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert" testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

function IssueRow({ issue, tone, t }: { issue: ReviewIssue; tone: "block" | "warn"; t: Translate }) {
  const theme = useTheme();
  const color = tone === "block" ? theme.destructiveAction : theme.status.pickup;
  return (
    <View style={styles.issue} accessible accessibilityLabel={issueText(issue, t)}>
      <Ionicons name={tone === "block" ? "close-circle-outline" : "alert-circle-outline"} size={18} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.flex, { color: theme.textPrimary }]}>
        {issueText(issue, t)}
      </Text>
    </View>
  );
}

function ImpactList({ people, expanded, onExpand, zone, language, t }: { people: readonly ImpactPerson[]; expanded: boolean; onExpand: () => void; zone: string | null; language?: string; t: Translate }) {
  const theme = useTheme();
  const shown = expanded ? people : people.slice(0, GROUP_AFTER);
  if (people.length === 0) return null;
  return (
    <View style={styles.block} testID="publish-impact">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
        {t("teamSchedule.publish.impactTitle", { count: people.length })}
      </Text>
      {shown.map((person) => (
        <View key={person.userId} style={[styles.person, { borderColor: theme.borderSubtle }]} testID={`publish-impact-${person.userId}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.personName, { color: theme.textPrimary }]}>
            {person.name || t("teamSchedule.unnamed")}
          </Text>
          {person.items.map((item) => (
            <Text key={`${item.changeId}-${item.kind}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
              {impactLine(item, zone, language, t)}
            </Text>
          ))}
        </View>
      ))}
      {!expanded && people.length > GROUP_AFTER ? (
        <Button label={t("teamSchedule.publish.showAll", { count: people.length - GROUP_AFTER })} size="sm" variant="ghost" onPress={onExpand} testID="publish-impact-more" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10, marginBottom: 14 },
  footer: { gap: 10 },
  flex: { flex: 1 },
  body: { fontSize: 14, lineHeight: 20 },
  muted: { fontSize: 13, lineHeight: 18 },
  h2: { fontSize: 15, fontWeight: "700" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { minWidth: 96, flexGrow: 1, borderWidth: 1, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 },
  tileValue: { fontSize: 22, fontWeight: "800" },
  tileLabel: { fontSize: 12.5, fontWeight: "600" },
  issue: { flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: 28 },
  person: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  personName: { fontSize: 14.5, fontWeight: "700" },
  note: { borderWidth: 1, borderRadius: R.md, padding: 12 },
  noticeBox: { borderWidth: 1, borderRadius: R.md, padding: 12 },
  confirm: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1.5, borderRadius: R.md, padding: 12, minHeight: MIN_TARGET },
  confirmText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  doneTitle: { fontSize: 18, fontWeight: "800", flex: 1 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineValue: { fontSize: 14, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  notify: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
});
