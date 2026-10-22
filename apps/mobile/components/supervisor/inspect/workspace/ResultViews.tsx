import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { newCorrectionStatus, ownerState, type InspectionResult } from "@/lib/inspections/outcome";
import type { SubmissionView } from "@/lib/inspections/useInspectionSubmit";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* What the supervisor sees once the server has answered (or has not). Every sentence here is a fact the server
   confirmed: "approved" only after a recorded pass, "remains blocked" for every failure, an owner only by the name the
   server returned, and never that someone has seen, accepted or been told of the work. */

type Language = "en" | "es";

function Card({ children, testID }: { children: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={testID}>
      {children}
    </View>
  );
}

function Fact({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textMuted }]}>
        {label.toUpperCase()}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function completedLine(result: InspectionResult, timeZone: string | null, language: Language, t: Translate): string | null {
  if (result.completedAtMs === null) return null;
  const time = formatHotelTime(new Date(result.completedAtMs), timeZone, language);
  return time ? t("inspect.result.completedAt", { time }) : null;
}

export const PROBLEM_REASONS: ReadonlySet<string> = new Set([
  "room_changed",
  "template_changed",
  "account_changed",
  "invalid",
  "forbidden",
  "evidence_upload_failed",
  "id_conflict",
  "not_found",
  "rejected",
  "busy",
  "offline",
  "checklist_incomplete",
  "room_not_awaiting",
  "reinspection_unverified",
  "photo_missing",
]);

export function ApprovedView({
  result,
  timeZone,
  language,
  hasNext,
  t,
  onNext,
  onQueue,
}: {
  result: InspectionResult;
  timeZone: string | null;
  language: Language;
  hasNext: boolean;
  t: Translate;
  onNext: () => void;
  onQueue: () => void;
}) {
  const theme = useTheme();
  const completed = completedLine(result, timeZone, language, t);
  return (
    <Card testID="result-approved">
      <Ionicons name="checkmark-circle" size={44} color={theme.status.ready} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="result-title">
        {t("inspect.result.approved.title", { room: result.roomNumber })}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ready, { color: theme.status.ready }]} testID="result-ready">
        {t("inspect.result.approved.ready")}
      </Text>
      {result.isReinspection ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="result-verified">
          {t("inspect.result.approved.correctionsVerified")}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {t("inspect.result.approved.passed")}
      </Text>
      {completed ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="result-time">
          {completed}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
        {t("inspect.result.approved.pmsNote")}
      </Text>
      <View style={styles.actions}>
        {hasNext ? <Button label={t("inspect.result.next")} icon="arrow-forward" size="lg" onPress={onNext} testID="result-next" /> : null}
        <Button label={t("inspect.result.backToQueue")} variant={hasNext ? "secondary" : "primary"} size="lg" onPress={onQueue} testID="result-queue" />
        {!hasNext ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]} testID="result-no-next">
            {t("inspect.result.noNext")}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export function CorrectionRequestedView({
  result,
  busy,
  online,
  hasNext,
  t,
  onNext,
  onCorrections,
  onQueue,
  onRetry,
}: {
  result: InspectionResult;
  busy: boolean;
  online: boolean;
  hasNext: boolean;
  t: Translate;
  onNext: () => void;
  onCorrections: () => void;
  onQueue: () => void;
  /** Finish creating the correction by resending the SAME submission. */
  onRetry: () => void;
}) {
  const theme = useTheme();
  const owner = ownerState(result.correction);
  const status = newCorrectionStatus(result);
  const pending = status === "pending_repair";
  const ownerText =
    owner.kind === "named" ? owner.name : owner.kind === "unnamed" ? t("inspect.result.correction.ownerUnnamed") : owner.kind === "unassigned" ? t("inspect.result.correction.unassigned") : t("inspect.result.correction.ownerUnknown");
  const issues = result.failedLabels.length > 0 ? result.failedLabels.join(", ") : t("inspect.result.correction.issuesNone");
  return (
    <Card testID="result-correction">
      <Ionicons name={pending ? "alert-circle" : "checkmark-circle"} size={44} color={pending ? theme.status.pickup : theme.status.ready} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="result-title">
        {t(pending ? "inspect.result.correction.pendingTitle" : "inspect.result.correction.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blocked, { color: theme.status.dirty }]} testID="result-blocked">
        {t("inspect.result.correction.blocked", { room: result.roomNumber })}
      </Text>
      {pending ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="result-pending-body">
          {t("inspect.result.correction.pendingBody")}
        </Text>
      ) : null}
      {result.isReinspection ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("inspect.result.correction.stillFailing")}
        </Text>
      ) : null}
      <Fact label={t("inspect.result.correction.issue")} value={issues} testID="result-issues" />
      {!pending ? <Fact label={t("inspect.result.correction.assignedTo")} value={ownerText} testID="result-owner" /> : null}
      {!pending ? <Fact label={t("inspect.result.correction.status")} value={t(`inspect.result.correction.statusValue.${status}`)} testID="result-status" /> : null}
      {!pending && result.correction?.priority === "urgent" ? <Fact label={t("inspect.result.correction.priority")} value={t("inspect.result.correction.urgent")} testID="result-priority" /> : null}
      <View style={styles.actions}>
        {pending ? (
          <>
            <Button label={t("inspect.result.correction.retry")} icon="refresh" size="lg" loading={busy} disabled={!online} onPress={onRetry} testID="result-retry" />
            {!online ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.status.pickup }]}>
                {t("inspect.result.needsConnection")}
              </Text>
            ) : null}
            <Button label={t("inspect.result.backToQueue")} variant="secondary" size="lg" disabled={busy} onPress={onQueue} testID="result-queue" />
          </>
        ) : (
          <>
            {hasNext ? <Button label={t("inspect.result.next")} icon="arrow-forward" size="lg" onPress={onNext} testID="result-next" /> : null}
            <Button label={t("inspect.result.viewCorrections")} variant={hasNext ? "secondary" : "primary"} size="lg" onPress={onCorrections} testID="result-corrections" />
            <Button label={t("inspect.result.backToQueue")} variant="ghost" size="lg" onPress={onQueue} testID="result-queue" />
          </>
        )}
      </View>
    </Card>
  );
}

export function UncertainView({
  view,
  online,
  t,
  onCheck,
  onSendAgain,
  onQueue,
}: {
  view: Extract<SubmissionView, { kind: "uncertain" }>;
  online: boolean;
  t: Translate;
  onCheck: () => void;
  onSendAgain: () => void;
  onQueue: () => void;
}) {
  const theme = useTheme();
  const canSendAgain = view.lastCheck === "not_recorded" || view.lastCheck === "incomplete";
  return (
    <Card testID="result-uncertain">
      <Ionicons name="time-outline" size={40} color={theme.status.pickup} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
        {t("inspect.result.uncertain.kicker")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="result-title">
        {t("inspect.result.uncertain.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="result-uncertain-body">
        {t(canSendAgain ? `inspect.result.uncertain.${view.lastCheck}` : view.lastCheck === "unknown" ? "inspect.result.uncertain.unknown" : "inspect.result.uncertain.body")}
      </Text>
      {!canSendAgain ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]}>
          {t("inspect.result.uncertain.dontResubmit")}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
        {t(`inspect.result.uncertain.reason.${view.reason}`)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]}>
        {t("inspect.result.uncertain.kept")}
      </Text>
      <View style={styles.actions}>
        {canSendAgain ? (
          <Button label={t("inspect.result.uncertain.sendAgain")} icon="send" size="lg" disabled={!online || view.checking} onPress={onSendAgain} testID="result-send-again" />
        ) : (
          <Button label={t("inspect.result.uncertain.check")} icon="refresh" size="lg" loading={view.checking} disabled={!online} onPress={onCheck} testID="result-check" />
        )}
        {!online ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.status.pickup }]} testID="result-offline">
            {t("inspect.result.needsConnection")}
          </Text>
        ) : null}
        <Button label={t("inspect.result.backToQueue")} variant="secondary" size="lg" disabled={view.checking} onPress={onQueue} testID="result-queue" />
      </View>
    </Card>
  );
}

/** Shown above the review after the server (or the app) refused the submission: nothing was recorded. */
export function ProblemBanner({
  view,
  retryable,
  t,
  onBack,
  onRetry,
}: {
  view: Extract<SubmissionView, { kind: "problem" }>;
  retryable: boolean;
  t: Translate;
  onBack: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  // A reason we have wording for is shown in the supervisor's language; only an unknown refusal falls back to the server's text.
  const message = PROBLEM_REASONS.has(view.reason) ? t(`inspect.result.problem.${view.reason}`) : view.message || t("inspect.result.problem.rejected");
  return (
    <View style={[styles.banner, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert" testID="result-problem">
      <Ionicons name="alert-circle-outline" size={20} color={theme.status.dirty} />
      <View style={styles.flex}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerTitle, { color: theme.textPrimary }]}>
          {t("inspect.result.problem.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]} testID="result-problem-message">
          {message}
        </Text>
        <View style={styles.bannerActions}>
          {retryable ? <Button label={t("inspect.result.problem.retry")} size="md" onPress={onRetry} testID="result-problem-retry" /> : null}
          <Button label={t("inspect.result.problem.back")} variant="secondary" size="md" onPress={onBack} testID="result-problem-back" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 4 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 18, gap: 10, alignItems: "flex-start" },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "800" },
  ready: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  blocked: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  small: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  fact: { gap: 2, alignSelf: "stretch" },
  factLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  factValue: { fontSize: 15.5, lineHeight: 22, fontWeight: "700" },
  actions: { alignSelf: "stretch", gap: 8, marginTop: 8 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, padding: 12 },
  bannerTitle: { fontSize: 15, lineHeight: 21, fontWeight: "800" },
  bannerActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
});
