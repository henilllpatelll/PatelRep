import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Kicker, LinkButton, MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { HomeModel, RecentSubmission } from "@/lib/housekeeping/homeModel";
import type { ConnectionNotice } from "@/lib/housekeeping/homeState";
import { describeNotice } from "@/lib/housekeeping/homeText";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { workedSeconds } from "@/lib/housekeeping/shiftLifecycle";
import { formatDuration } from "@/lib/housekeeping/shiftReview";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Connection notice (State 7 with cached rooms) ─────────────────────────── */

export function ConnectionNoticeBanner({
  notice,
  t,
  ctx,
  onOpenSync,
}: {
  notice: ConnectionNotice;
  t: Translate;
  ctx: TextContext;
  onOpenSync?: () => void;
}) {
  const theme = useTheme();
  const copy = describeNotice(notice, t, ctx);
  const icon = notice.kind === "offline" ? "cloud-offline-outline" : "time-outline";
  return (
    <View
      style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={`home-notice-${notice.kind}`}
    >
      <Ionicons name={icon} size={18} color={theme.status.pickup} />
      <View style={styles.bannerText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerTitle, { color: theme.textPrimary }]}>
          {copy.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerBody, { color: theme.textSecondary }]}>
          {copy.body}
        </Text>
        {onOpenSync ? <LinkButton label={t("home.header.syncOpen")} onPress={onOpenSync} testID="notice-sync-status" /> : null}
      </View>
    </View>
  );
}

/* ─── State 4: a room was just finished ─────────────────────────────────────── */

export function SubmissionBanner({
  submission,
  t,
  onDismiss,
  onOpenSync,
}: {
  submission: RecentSubmission;
  t: Translate;
  onDismiss: () => void;
  onOpenSync?: () => void;
}) {
  const theme = useTheme();
  const kind = submission.inspected ? "inspected" : submission.confirmed ? "submitted" : "queued";
  const color = kind === "queued" ? theme.status.pickup : kind === "inspected" ? theme.status.ready : theme.status.clean;
  const soft = kind === "queued" ? theme.status.pickupSoft : kind === "inspected" ? theme.status.readySoft : theme.status.cleanSoft;
  const line = kind === "queued" ? theme.status.pickupLine : kind === "inspected" ? theme.status.readyLine : theme.status.cleanLine;
  const icon = kind === "queued" ? "cloud-upload-outline" : "checkmark-circle";
  const title = t(`home.submitted.${kind}Title`, { room: submission.roomNumber });
  const body = t(`home.submitted.${kind}Body`);

  return (
    <View
      style={[styles.banner, { backgroundColor: soft, borderColor: line }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="submission-banner"
    >
      <Ionicons name={icon} size={22} color={color} />
      <View style={styles.bannerText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerTitle, { color: theme.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerBody, { color: theme.textSecondary }]}>
          {body}
        </Text>
        {kind === "queued" && onOpenSync ? <LinkButton label={t("home.header.syncOpen")} onPress={onOpenSync} testID="submission-sync-status" /> : null}
      </View>
      {kind !== "queued" ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          style={styles.dismiss}
          testID="submission-dismiss"
        >
          <Ionicons name="close" size={18} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── State 1: before the shift ─────────────────────────────────────────────── */

export function BeforeShiftState({
  model,
  t,
  onStart,
  onReview,
  onMarkNoteRead,
}: {
  model: HomeModel;
  t: Translate;
  onStart: () => void;
  onReview: () => void;
  onMarkNoteRead: () => void;
}) {
  const theme = useTheme();
  const { lifecycle, progress, alerts, supervisorInstruction: note } = model;
  const instructions: string[] = [];
  if (alerts.rush > 0) instructions.push(t("home.before.rush", { count: alerts.rush }));
  if (alerts.vip > 0) instructions.push(t("home.before.vip", { count: alerts.vip }));
  if (alerts.reclean > 0) instructions.push(t("home.before.reclean", { count: alerts.reclean }));

  return (
    <Card style={styles.stateCard} testID="shift-control-not-started">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
        {t("home.before.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]} testID="before-shift-summary">
        {t("home.before.assigned", { count: progress.assigned })}
      </Text>
      {instructions.length > 0 ? (
        <View style={styles.list} testID="before-shift-instructions">
          <Kicker>{t("home.before.instructions")}</Kicker>
          {instructions.map((line) => (
            <View key={line} style={styles.listRow}>
              <Ionicons name="flag-outline" size={15} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary, flex: 1 }]}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {note ? (
        <View style={[styles.note, { backgroundColor: theme.surfaceMuted }]} testID="before-shift-note">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerTitle, { color: theme.textPrimary }]}>
            {note.title}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerBody, { color: theme.textSecondary }]}>
            {note.body}
          </Text>
          <Button label={t("home.message.markRead")} onPress={onMarkNoteRead} variant="ghost" size="sm" testID="before-shift-mark-read" />
        </View>
      ) : null}
      {!model.sync.online ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("home.shift.needsConnection")}
        </Text>
      ) : null}
      <Button
        label={t("home.shift.start")}
        onPress={onStart}
        size="lg"
        disabled={!lifecycle.canStart}
        loading={lifecycle.busy}
        testID="shift-start"
      />
      <Button label={t("home.before.review")} onPress={onReview} variant="secondary" testID="shift-review" />
    </Card>
  );
}

/** Quiet "Start shift" row for when work is already open but the shift never started. */
export function ShiftStartNudge({ model, t, onStart }: { model: HomeModel; t: Translate; onStart: () => void }) {
  const theme = useTheme();
  const { lifecycle } = model;
  return (
    <View style={[styles.nudge, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]} testID="shift-start-nudge">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerBody, { color: theme.textSecondary, flex: 1 }]}>
        {t("home.before.nudge")}
      </Text>
      <Button label={t("home.shift.start")} onPress={onStart} size="sm" disabled={!lifecycle.canStart} loading={lifecycle.busy} testID="shift-start" />
    </View>
  );
}

/* ─── State 8: on break ─────────────────────────────────────────────────────── */

export function OnBreakState({
  model,
  t,
  ctx,
  onResume,
}: {
  model: HomeModel;
  t: Translate;
  ctx: TextContext;
  onResume: () => void;
}) {
  const theme = useTheme();
  const { lifecycle, progress } = model;
  const since = formatClock(lifecycle.onBreakSince, ctx);
  return (
    <Card style={styles.stateCard} testID="shift-control-break">
      <View style={styles.titleRow}>
        <Ionicons name="cafe-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
          {t("home.shift.onBreak")}
        </Text>
      </View>
      {since ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]} testID="break-since">
          {t("home.break.since", { time: since })}
        </Text>
      ) : null}
      {model.board.state === "ready" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]} testID="break-summary">
          {t("home.break.summary", { done: progress.completed, total: progress.serviceable })}
        </Text>
      ) : null}
      <Button label={t("home.shift.resume")} onPress={onResume} size="lg" disabled={!lifecycle.canEndBreak} loading={lifecycle.busy} testID="shift-resume" />
      {!model.sync.online ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("home.shift.needsConnection")}
        </Text>
      ) : null}
    </Card>
  );
}

/* ─── State 6: confirmed zero assignments ───────────────────────────────────── */

export function NoAssignmentsState({
  t,
  refreshing,
  lastCheckedLabel,
  onRefresh,
  onOpenMyRooms,
}: {
  t: Translate;
  refreshing: boolean;
  lastCheckedLabel: string | null;
  onRefresh: () => void;
  onOpenMyRooms: () => void;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.stateCard} testID="board-empty">
      <Ionicons name="bed-outline" size={32} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
        {t("home.empty.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]}>
        {t("home.empty.body")}
      </Text>
      {lastCheckedLabel ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("home.empty.checked", { time: lastCheckedLabel })}
        </Text>
      ) : null}
      <Button label={t("home.empty.refresh")} onPress={onRefresh} loading={refreshing} icon="refresh" testID="empty-refresh" />
      <Button label={t("home.openMyRooms")} onPress={onOpenMyRooms} variant="secondary" testID="empty-my-rooms" />
    </Card>
  );
}

/* ─── State 7 without a cache ───────────────────────────────────────────────── */

export function DataUnavailableState({
  t,
  offline,
  retrying,
  onRetry,
}: {
  t: Translate;
  offline: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.stateCard} testID="board-unavailable">
      <Ionicons name={offline ? "cloud-offline-outline" : "alert-circle-outline"} size={32} color={theme.status.dirty} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
        {t("home.unavailable.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]}>
        {t(offline ? "home.unavailable.offlineBody" : "home.unavailable.body")}
      </Text>
      <Button label={t("home.board.retry")} onPress={onRetry} loading={retrying} icon="refresh" testID="unavailable-retry" />
    </Card>
  );
}

/* ─── All assigned work handled ─────────────────────────────────────────────── */

/**
 * Every room is accounted for. This only offers the review; clocking out is a
 * separate, deliberate step inside it, and nothing here changes the shift.
 */
export function AllHandledCard({
  model,
  t,
  onReview,
}: {
  model: HomeModel;
  t: Translate;
  onReview: () => void;
}) {
  const theme = useTheme();
  const { progress, endOfShift } = model;
  const lines: string[] = [t("home.endOfShift.roomsCompleted", { count: progress.completed })];
  if (endOfShift.exceptions.length > 0) lines.push(t("home.clockedOut.exceptions", { count: endOfShift.exceptions.length }));
  if (endOfShift.handoffs.length > 0) lines.push(t("home.clockedOut.handoffs", { count: endOfShift.handoffs.length }));
  if (model.sync.pending > 0) lines.push(t("home.sync.pending", { count: model.sync.pending }));

  return (
    <Card style={styles.stateCard} testID="all-handled">
      <View style={styles.titleRow}>
        <Ionicons name="checkmark-circle" size={24} color={theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
          {t("home.allHandled.title")}
        </Text>
      </View>
      <View style={styles.list}>
        {lines.map((line) => (
          <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]}>
            {line}
          </Text>
        ))}
      </View>
      <Button label={t("home.allHandled.review")} onPress={onReview} size="lg" testID="review-shift" />
    </Card>
  );
}

/* ─── State 9: clocked out ──────────────────────────────────────────────────── */

export function ClockedOutState({
  model,
  t,
  ctx,
  onViewSummary,
  onViewRooms,
  onStartNew,
  onOpenSync,
}: {
  model: HomeModel;
  t: Translate;
  ctx: TextContext;
  onViewSummary: () => void;
  onViewRooms: () => void;
  onStartNew: () => void;
  onOpenSync: () => void;
}) {
  const theme = useTheme();
  const { lifecycle, progress, endOfShift } = model;
  const usable = model.board.state === "ready" || model.board.state === "empty";
  const endedAt = formatClock(lifecycle.endedAt, ctx);
  const worked = workedSeconds(lifecycle, new Date());
  const duration = worked === null ? null : formatDuration(worked);

  // Recorded facts only: never "cleaned by you" for a room that is merely inspected.
  const lines: string[] = [];
  if (usable) {
    lines.push(t("home.endOfShift.roomsCompleted", { count: progress.completed }));
    if (endOfShift.exceptions.length > 0) lines.push(t("home.clockedOut.exceptions", { count: endOfShift.exceptions.length }));
    if (endOfShift.handoffs.length > 0) lines.push(t("home.clockedOut.handoffs", { count: endOfShift.handoffs.length }));
  }

  return (
    <Card style={styles.stateCard} testID="shift-control-ended">
      <View style={styles.titleRow}>
        <Ionicons name="checkmark-circle" size={24} color={theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.stateTitle, { color: theme.textPrimary }]}>
          {t("home.clockedOut.title")}
        </Text>
      </View>
      {endedAt ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textSecondary }]} testID="clocked-out-at">
          {t("home.shift.clockedOutAt", { time: endedAt })}
          {duration ? ` · ${t("home.endOfShift.shiftDuration", { duration })}` : ""}
        </Text>
      ) : null}
      {lines.length > 0 ? (
        <View style={styles.list} testID="clocked-out-summary">
          {lines.map((line) => (
            <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stateBody, { color: theme.textPrimary }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {model.sync.pending > 0 || model.sync.failed > 0 || model.sync.conflicts > 0 ? (
        <View style={[styles.note, { backgroundColor: theme.status.pickupSoft }]} testID="clocked-out-sync">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerBody, { color: theme.textPrimary }]}>
            {t("home.clockedOut.unsent", { count: model.sync.pending + model.sync.failed + model.sync.conflicts })}
          </Text>
          <LinkButton label={t("home.header.syncOpen")} onPress={onOpenSync} testID="clocked-out-sync-status" />
        </View>
      ) : null}
      <Button label={t("home.clockedOut.viewSummary")} onPress={onViewSummary} testID="clocked-out-summary-open" />
      <Button label={t("home.clockedOut.viewRooms")} onPress={onViewRooms} variant="secondary" testID="clocked-out-rooms" />
      <Button
        label={t("home.shift.startNew")}
        onPress={onStartNew}
        variant="ghost"
        disabled={!lifecycle.canStart}
        loading={lifecycle.busy}
        testID="shift-start-new"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  bannerText: { flex: 1, minWidth: 0, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  bannerBody: { fontSize: 13, lineHeight: 18 },
  dismiss: { width: MIN_TARGET - 8, height: MIN_TARGET - 8, alignItems: "center", justifyContent: "center", marginTop: -6, marginRight: -6 },
  stateCard: { gap: 12 },
  stateTitle: { fontSize: 22, fontWeight: "700", lineHeight: 28, flexShrink: 1 },
  stateBody: { fontSize: 15, lineHeight: 21 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hint: { fontSize: 12, lineHeight: 17 },
  list: { gap: 6 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  note: { borderRadius: 12, padding: 12, gap: 4 },
  nudge: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingVertical: 8, paddingLeft: 14, paddingRight: 8 },
});
