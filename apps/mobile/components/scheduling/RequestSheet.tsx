import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { TextField } from "@/components/scheduling/formParts";
import { Fact, FailureNotice, SectionTitle, StatePill, toneOf } from "@/components/scheduling/requestParts";
import { ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { Button } from "@/components/ui/Button";
import {
  approveSwap, approveTimeOff, cancelSwap, cancelTimeOff, denySwap, denyTimeOff, fetchSwap, fetchTimeOff, respondToSwap,
  type ImpactShift, type RequestItem, type ShiftBrief, type SwapRequest, type TimeOffRequest, type TimelineEvent,
} from "@/lib/api/schedulingRequests";
import { useRemote, useRequestAction } from "@/lib/scheduling/requestHooks";
import { clockLabel, dateRangeLabel, findingText, reasonText, statusText, SWAP_ACK_WARNINGS } from "@/lib/scheduling/requestsModel";
import { formatLongDate, formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* One drawer for a time-off request or a shift swap, for the supervisor deciding it and for the employee following it.
   Everything on screen is read from the server; the buttons shown are the ones the server says are allowed right now
   (`can`), and a decision that lands on a record someone else just changed reloads it instead of overwriting. */

export type SheetOutcome = "approved" | "denied" | "cancelled" | "accepted" | "declined" | "reloaded";

interface Props {
  item: RequestItem | null;
  isOnline: boolean;
  language?: string;
  onClose: () => void;
  /** The record changed on the server: the list behind the drawer should re-read. */
  onChanged: (outcome: SheetOutcome) => void;
  t: Translate;
}

function shiftLine(shift: ShiftBrief | null, language: string | undefined, t: Translate): string {
  if (!shift) return "—";
  const window = `${clockLabel(shift.startTime, language)} – ${clockLabel(shift.endTime, language)}`;
  return t("teamSchedule.requests.swap.shiftLine", { date: formatShortDate(shift.workDate, language), shift: shift.shiftName ?? t("teamSchedule.coverage.shiftFallback"), window });
}

function eventText(event: TimelineEvent, t: Translate): string {
  return t(`teamSchedule.requests.event.${event.action}`, { defaultValue: event.action });
}

function Timeline({ events, language, t }: { events: TimelineEvent[]; language?: string; t: Translate }) {
  const theme = useTheme();
  if (events.length === 0) {
    return (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
        {t("teamSchedule.requests.detail.noTimeline")}
      </Text>
    );
  }
  return (
    <View style={styles.timeline} testID="request-timeline">
      {events.map((event) => (
        <View key={event.id} style={styles.event}>
          <Ionicons name="ellipse" size={8} color={theme.textMuted} style={styles.eventDot} />
          <View style={styles.eventText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
              {eventText(event, t)}
              {event.actorName ? ` · ${event.actorName}` : ""}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {[event.at ? formatShortDate(event.at.slice(0, 10), language) : null, event.reason].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ImpactList({ shifts, language, t }: { shifts: ImpactShift[]; language?: string; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.impactList} testID="leave-impact-list">
      {shifts.map((shift) => {
        const coverage = shift.coverage;
        const line = !coverage
          ? t("teamSchedule.requests.detail.coverageOpen")
          : coverage.status === "filled"
            ? coverage.replacement?.name ? t("teamSchedule.requests.detail.coverageFilled", { name: coverage.replacement.name }) : t("teamSchedule.requests.detail.coverageFilledUnknown")
            : coverage.status === "waived" ? t("teamSchedule.requests.detail.coverageWaived")
              : coverage.status === "offered" ? t("teamSchedule.requests.detail.coverageOffered") : t("teamSchedule.requests.detail.coverageOpen");
        return (
          <View key={shift.id} style={[styles.impactRow, { backgroundColor: theme.surfaceSubtle, borderColor: shift.resolved ? theme.borderSubtle : theme.status.pickup }]} testID={`leave-impact-${shift.id}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
              {shiftLine(shift, language, t)}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
              {shift.overlap === "full" ? t("teamSchedule.requests.detail.overlapFull") : t("teamSchedule.requests.detail.overlapPartial")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: shift.resolved ? theme.textSecondary : theme.status.pickup }]}>
              {line}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Time off ────────────────────────────────────────────────────────────── */

function TimeOffBody({ initial, isOnline, language, onClose, onChanged, t }: { initial: RequestItem } & Omit<Props, "item">) {
  const theme = useTheme();
  const action = useRequestAction();
  const detail = useRemote<TimeOffRequest>(() => fetchTimeOff(initial.id), [initial.id]);
  const [local, setLocal] = useState<TimeOffRequest | null>(null);
  const [mode, setMode] = useState<"view" | "deny" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  const request = local ?? detail.data;
  useEffect(() => setLocal(null), [detail.data]);

  if (!request) {
    return detail.status === "failed" && detail.failure
      ? <FailureNotice failure={detail.failure} t={t} testID="request-load-failed" />
      : <ScheduleSkeleton rows={3} />;
  }
  const reload = () => {
    setNotice({ text: t("teamSchedule.requests.detail.reloaded"), tone: "warn" });
    setMode("view");
    void detail.refresh();
  };
  const finish = (next: TimeOffRequest, outcome: SheetOutcome, text: string, tone: "info" | "warn" = "info") => {
    setLocal(next);
    setMode("view");
    setReason("");
    setNotice({ text, tone });
    onChanged(outcome);
  };
  const offline = !isOnline;
  const manager = request.viewer === "manager";
  const reasonOk = reason.trim().length > 0;
  const impact = request.impact;
  const unresolved = impact.unresolvedCount ?? 0;

  const approve = async () => {
    const result = await action.run(() => approveTimeOff(request.id, request.version), reload);
    if (!result) return;
    finish(result.request, "approved", t("teamSchedule.requests.detail.approvedNotice"));
  };
  const deny = async () => {
    const result = await action.run(() => denyTimeOff(request.id, request.version, reason.trim()), reload);
    if (result) finish(result, "denied", t("teamSchedule.requests.detail.deniedNotice"));
  };
  const cancel = async () => {
    const result = await action.run(() => cancelTimeOff(request.id, request.version, reason.trim() || null), reload);
    if (!result) return;
    const review = result.impact.shifts.filter((s) => s.coverage && (s.coverage.status === "filled" || s.coverage.status === "waived")).length;
    finish(result, "cancelled", review > 0 && manager ? t("teamSchedule.requests.detail.cancelReview", { count: review }) : request.status === "pending" ? t("teamSchedule.requests.detail.withdrawn") : t("teamSchedule.requests.detail.cancelledNotice"), review > 0 ? "warn" : "info");
  };
  const openSchedule = () => {
    onClose();
    router.push({ pathname: "/(app)/team-schedule", params: { date: impact.shifts[0]?.workDate ?? request.startDate } } as never);
  };

  return (
    <>
      {offline ? <SheetNotice tone="warn" text={t("teamSchedule.requests.offline")} testID="request-offline" /> : null}
      {detail.failure && detail.data ? <FailureNotice failure={detail.failure} t={t} testID="request-refresh-failed" /> : null}
      {notice ? <SheetNotice tone={notice.tone} text={notice.text} testID="request-notice" /> : null}
      <StatePill text={statusText(request.status, t)} tone={toneOf(request.status)} testID="request-status" />
      <View style={styles.facts}>
        <Fact label={t("teamSchedule.requests.detail.employee")}>{`${request.user.name ?? t("teamSchedule.unnamed")}${request.user.role ? ` · ${roleLabel(request.user.role, t)}` : ""}`}</Fact>
        <Fact label={t("teamSchedule.requests.detail.type")}>{t("teamSchedule.requests.card.timeOff")}</Fact>
        <Fact label={t("teamSchedule.requests.detail.dates")}>
          {request.partial
            ? `${formatLongDate(request.startDate, language)} · ${clockLabel(request.startTime, language)} – ${clockLabel(request.endTime, language)}`
            : dateRangeLabel(request.startDate, request.endDate, language)}
        </Fact>
        <Fact label={t("teamSchedule.requests.detail.reason")}>{reasonText(request.reason, t)}</Fact>
        <Fact label={t("teamSchedule.requests.detail.note")}>{request.note ?? t("teamSchedule.requests.detail.noNote")}</Fact>
        {request.createdAt ? <Fact label={t("teamSchedule.requests.detail.submitted")}>{formatLongDate(request.createdAt.slice(0, 10), language)}</Fact> : null}
        {request.decidedBy ? <Fact label={t("teamSchedule.requests.detail.decisionBy", { name: request.decidedBy.name ?? "—" })}>{request.decisionReason ?? ""}</Fact> : null}
        {request.cancelReason ? <Fact label={t("teamSchedule.requests.detail.cancelReason")}>{request.cancelReason}</Fact> : null}
      </View>

      <SectionTitle>{t("teamSchedule.requests.detail.impact")}</SectionTitle>
      {!impact.verified ? (
        <SheetNotice tone="warn" text={t("teamSchedule.requests.detail.impactUnknown")} testID="leave-impact-unknown" />
      ) : impact.shifts.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]} testID="leave-impact-none">
          {t("teamSchedule.requests.detail.impactOk")}
        </Text>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]} testID="leave-impact-summary">
            {t("teamSchedule.requests.detail.impactBody", { count: impact.shiftCount ?? impact.shifts.length })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
            {request.status === "approved" ? t("teamSchedule.requests.detail.impactApproved") : request.status === "pending" ? t("teamSchedule.requests.detail.impactPending") : ""}
          </Text>
          <ImpactList shifts={impact.shifts} language={language} t={t} />
          <SheetNotice
            tone={unresolved > 0 ? "warn" : "info"}
            text={unresolved > 0 ? t("teamSchedule.requests.detail.unresolved", { count: unresolved }) : t("teamSchedule.requests.detail.allResolved")}
            testID="leave-unresolved"
          />
        </>
      )}

      {request.status === "approved" && manager && unresolved > 0 ? (
        <Button label={t("teamSchedule.requests.detail.followUpOpen")} icon="calendar-outline" variant="secondary" onPress={openSchedule} testID="request-open-schedule" />
      ) : null}

      <SectionTitle>{t("teamSchedule.requests.detail.timeline")}</SectionTitle>
      <Timeline events={request.timeline} language={language} t={t} />

      {action.failure ? <FailureNotice failure={action.failure} t={t} testID="request-action-failed" /> : null}

      {mode === "deny" || mode === "cancel" ? (
        <View style={styles.reasonBox}>
          <TextField
            label={t(mode === "deny" ? "teamSchedule.requests.detail.denyReason" : "teamSchedule.requests.detail.cancelReason")}
            value={reason}
            onChangeText={setReason}
            placeholder={t("teamSchedule.requests.detail.denyReasonHint")}
            testID="request-reason"
            maxLength={120}
          />
          <Button
            label={t(mode === "deny" ? "teamSchedule.requests.detail.confirmDeny" : "teamSchedule.requests.detail.confirmCancel")}
            variant="destructive"
            loading={action.busy}
            disabled={offline || (mode === "deny" || request.status === "approved" ? !reasonOk : false)}
            onPress={() => void (mode === "deny" ? deny() : cancel())}
            testID="request-confirm-reason"
          />
          <Button label={t("teamSchedule.requests.detail.back")} variant="ghost" onPress={() => { setMode("view"); setReason(""); action.clear(); }} testID="request-back" />
        </View>
      ) : (
        <View style={styles.actions}>
          {request.can.approve ? <Button label={t("teamSchedule.requests.detail.approve")} icon="checkmark" loading={action.busy} disabled={offline} onPress={() => void approve()} testID="request-approve" /> : null}
          {request.can.deny ? <Button label={t("teamSchedule.requests.detail.deny")} variant="secondary" disabled={offline || action.busy} onPress={() => { action.clear(); setMode("deny"); }} testID="request-deny" /> : null}
          {request.can.cancel ? (
            <Button
              label={t(request.status === "approved" ? "teamSchedule.requests.detail.cancelApproved" : "teamSchedule.requests.detail.withdraw")}
              variant="secondary"
              loading={action.busy && mode === "view" && !request.can.approve}
              disabled={offline || action.busy}
              onPress={() => { action.clear(); if (request.can.cancelNeedsReason) setMode("cancel"); else void cancel(); }}
              testID="request-cancel"
            />
          ) : null}
        </View>
      )}
    </>
  );
}

/* ─── Shift swap ──────────────────────────────────────────────────────────── */

function SwapBody({ initial, isOnline, language, onChanged, t }: { initial: RequestItem } & Omit<Props, "item" | "onClose">) {
  const theme = useTheme();
  const action = useRequestAction();
  const detail = useRemote<SwapRequest>(() => fetchSwap(initial.id), [initial.id]);
  const [local, setLocal] = useState<SwapRequest | null>(null);
  const [mode, setMode] = useState<"view" | "deny" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  const swap = local ?? detail.data;
  useEffect(() => setLocal(null), [detail.data]);
  const acks = useMemo(() => (swap?.analysis?.warnings ?? []).filter((w) => SWAP_ACK_WARNINGS.includes(w.code)), [swap]);

  if (!swap) {
    return detail.status === "failed" && detail.failure
      ? <FailureNotice failure={detail.failure} t={t} testID="request-load-failed" />
      : <ScheduleSkeleton rows={3} />;
  }
  const reload = () => {
    setNotice({ text: t("teamSchedule.requests.detail.reloaded"), tone: "warn" });
    setMode("view");
    setAck(false);
    void detail.refresh();
  };
  const finish = (next: SwapRequest, outcome: SheetOutcome, text: string) => {
    setLocal(next);
    setMode("view");
    setReason("");
    setNotice({ text, tone: "info" });
    onChanged(outcome);
  };
  const offline = !isOnline;
  const blockers = swap.analysis?.blockers ?? [];
  const nameOf = (id: string | null) => (id === swap.requester.id ? swap.requester.name : id === swap.counterpart.id ? swap.counterpart.name : null) ?? "";
  const respond = async (accept: boolean) => {
    const next = await action.run(() => respondToSwap(swap.id, swap.version, accept), reload);
    if (next) finish(next, accept ? "accepted" : "declined", accept ? t("teamSchedule.requests.swap.waitingSupervisor") : t("teamSchedule.requests.status.declined"));
  };
  const approve = async () => {
    const next = await action.run(() => approveSwap(swap.id, swap.version, ack), reload);
    if (next) finish(next, "approved", t("teamSchedule.requests.swap.approvedNotice"));
  };
  const deny = async () => {
    const next = await action.run(() => denySwap(swap.id, swap.version, reason.trim()), reload);
    if (next) finish(next, "denied", t("teamSchedule.requests.detail.deniedNotice"));
  };
  const cancel = async () => {
    const next = await action.run(() => cancelSwap(swap.id, swap.version, reason.trim() || null), reload);
    if (next) finish(next, "cancelled", t("teamSchedule.requests.detail.withdrawn"));
  };
  const open = swap.status === "proposed" || swap.status === "accepted";

  return (
    <>
      {offline ? <SheetNotice tone="warn" text={t("teamSchedule.requests.offline")} testID="request-offline" /> : null}
      {detail.failure && detail.data ? <FailureNotice failure={detail.failure} t={t} testID="request-refresh-failed" /> : null}
      {notice ? <SheetNotice tone={notice.tone} text={notice.text} testID="request-notice" /> : null}
      <StatePill text={statusText(swap.status, t)} tone={toneOf(swap.status)} testID="request-status" />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
        {swap.status === "proposed" && swap.viewer === "requester" ? t("teamSchedule.requests.swap.waitingCoworker", { name: swap.counterpart.name ?? "—" })
          : swap.status === "accepted" && swap.viewer !== "manager" ? t("teamSchedule.requests.swap.waitingSupervisor")
            : swap.viewer === "counterpart" && swap.status === "proposed" ? t("teamSchedule.requests.swap.acceptNote") : ""}
      </Text>

      {[
        { person: swap.requester, give: swap.requesterShift, take: swap.counterpartShift },
        { person: swap.counterpart, give: swap.counterpartShift, take: swap.requesterShift },
      ].map(({ person, give, take }) => (
        <View key={person.id} style={[styles.swapCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID={`swap-person-${person.id}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
            {`${person.name ?? t("teamSchedule.unnamed")}${person.role ? ` · ${roleLabel(person.role, t)}` : ""}`}
          </Text>
          <Fact label={t("teamSchedule.requests.swap.gives")}>{shiftLine(give, language, t)}</Fact>
          <Fact label={t("teamSchedule.requests.swap.receives")}>{shiftLine(take, language, t)}</Fact>
        </View>
      ))}
      {swap.note ? <Fact label={t("teamSchedule.requests.swap.yourNote")}>{swap.note}</Fact> : null}
      {swap.responseNote ? <Fact label={t("teamSchedule.requests.swap.responseNote")}>{swap.responseNote}</Fact> : null}
      {swap.decisionReason ? <Fact label={t("teamSchedule.requests.detail.decisionReason")}>{swap.decisionReason}</Fact> : null}

      {swap.analysis ? (
        <>
          <SectionTitle>{t("teamSchedule.requests.swap.checks")}</SectionTitle>
          {blockers.length === 0 && swap.analysis.warnings.length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]} testID="swap-checks-ok">
              {t("teamSchedule.requests.swap.checksOk")}
            </Text>
          ) : null}
          {blockers.map((finding, i) => (
            <SheetNotice key={`b-${finding.code}-${i}`} tone="error" text={`${findingText(finding.code, t)}${nameOf(finding.userId) ? ` (${nameOf(finding.userId)})` : ""}`} testID={`swap-blocker-${finding.code}`} />
          ))}
          {swap.analysis.warnings.map((finding, i) => (
            <SheetNotice key={`w-${finding.code}-${i}`} tone="warn" text={`${findingText(finding.code, t)}${nameOf(finding.userId) ? ` (${nameOf(finding.userId)})` : ""}`} testID={`swap-warning-${finding.code}`} />
          ))}
        </>
      ) : null}

      <SectionTitle>{t("teamSchedule.requests.detail.timeline")}</SectionTitle>
      <Timeline events={swap.timeline} language={language} t={t} />

      {action.failure ? <FailureNotice failure={action.failure} t={t} testID="request-action-failed" /> : null}

      {mode === "deny" || mode === "cancel" ? (
        <View style={styles.reasonBox}>
          <TextField
            label={t(mode === "deny" ? "teamSchedule.requests.swap.denyReason" : "teamSchedule.requests.swap.cancelReason")}
            value={reason}
            onChangeText={setReason}
            placeholder={t("teamSchedule.requests.detail.denyReasonHint")}
            testID="request-reason"
            maxLength={120}
          />
          <Button
            label={t(mode === "deny" ? "teamSchedule.requests.swap.confirmDeny" : "teamSchedule.requests.swap.cancel")}
            variant="destructive"
            loading={action.busy}
            disabled={offline || (mode === "deny" && reason.trim().length === 0)}
            onPress={() => void (mode === "deny" ? deny() : cancel())}
            testID="request-confirm-reason"
          />
          <Button label={t("teamSchedule.requests.detail.back")} variant="ghost" onPress={() => { setMode("view"); setReason(""); action.clear(); }} testID="request-back" />
        </View>
      ) : (
        <View style={styles.actions}>
          {swap.can.respond ? (
            <>
              <Button label={t("teamSchedule.requests.swap.accept")} icon="checkmark" loading={action.busy} disabled={offline || blockers.length > 0} onPress={() => void respond(true)} testID="swap-accept" />
              <Button label={t("teamSchedule.requests.swap.decline")} variant="secondary" disabled={offline || action.busy} onPress={() => void respond(false)} testID="swap-decline" />
            </>
          ) : null}
          {swap.can.approve ? (
            <>
              <SheetNotice text={t("teamSchedule.requests.swap.approveNote")} testID="swap-approve-note" />
              {acks.length > 0 ? (
                <Pressable onPress={() => setAck((held) => !held)} accessibilityRole="checkbox" accessibilityState={{ checked: ack }} testID="swap-acknowledge" style={[styles.ack, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}>
                  <Ionicons name={ack ? "checkbox" : "square-outline"} size={22} color={ack ? theme.primaryAction : theme.textMuted} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.ackText, { color: theme.textPrimary }]}>
                    {t("teamSchedule.requests.swap.acknowledge")}
                  </Text>
                </Pressable>
              ) : null}
              <Button label={t("teamSchedule.requests.swap.approve")} icon="swap-horizontal" loading={action.busy} disabled={offline || blockers.length > 0 || (acks.length > 0 && !ack)} onPress={() => void approve()} testID="swap-approve" />
            </>
          ) : null}
          {swap.can.deny ? <Button label={t("teamSchedule.requests.swap.deny")} variant="secondary" disabled={offline || action.busy} onPress={() => { action.clear(); setMode("deny"); }} testID="swap-deny" /> : null}
          {swap.can.cancel && open ? <Button label={t("teamSchedule.requests.swap.cancel")} variant="ghost" disabled={offline || action.busy} onPress={() => { action.clear(); setMode("cancel"); }} testID="swap-cancel" /> : null}
        </View>
      )}
    </>
  );
}

/* ─── The drawer ──────────────────────────────────────────────────────────── */

export function RequestSheet({ item, isOnline, language, onClose, onChanged, t }: Props) {
  if (!item) return null;
  const title = t(item.type === "time_off" ? "teamSchedule.requests.card.timeOff" : "teamSchedule.requests.swap.title");
  return (
    <CoverageSheet visible title={title} subtitle={item.user.name} closeLabel={t("teamSchedule.requests.detail.close")} onClose={onClose} testID="request-sheet">
      {item.type === "time_off"
        ? <TimeOffBody key={item.id} initial={item} isOnline={isOnline} language={language} onClose={onClose} onChanged={onChanged} t={t} />
        : <SwapBody key={item.id} initial={item} isOnline={isOnline} language={language} onChanged={onChanged} t={t} />}
    </CoverageSheet>
  );
}

const styles = StyleSheet.create({
  facts: { gap: 10 },
  value: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: "700" },
  muted: { fontSize: 13, lineHeight: 18 },
  timeline: { gap: 8 },
  event: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  eventDot: { marginTop: 7 },
  eventText: { flex: 1, gap: 1 },
  impactList: { gap: 8 },
  impactRow: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  swapCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  reasonBox: { gap: 10 },
  actions: { gap: 10 },
  ack: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12 },
  ackText: { flex: 1 },
});
