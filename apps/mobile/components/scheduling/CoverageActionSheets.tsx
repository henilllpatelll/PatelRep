import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { TextField } from "@/components/scheduling/formParts";
import { Button } from "@/components/ui/Button";
import {
  assignGap, classifyCoverageFailure, createOffer, newOpenShiftKey, postOpenShift, waiveGap,
  type CoverageCandidate, type CoverageFailure, type CoverageGap,
} from "@/lib/api/schedulingCoverage";
import type { ShiftTemplate } from "@/lib/api/schedulingManage";
import { candidateFlagText, failureText, gapTitle, gapWindow, warningsToAcknowledge } from "@/lib/scheduling/coverageText";
import { addDaysToYmd, formatLongDate, formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* Small coverage drawers: Offer Shift (offer vs. assign now), Waive/Cancel, and Post Open Shift.
   Each runs one server call at a time, keeps a failure on screen in words, and reports `stale` when the gap moved so
   the caller reloads instead of showing a state the server no longer holds. */

function useOneAtATime() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CoverageFailure | null>(null);
  const run = async <T,>(job: () => Promise<T>, onStale: () => void): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      return await job();
    } catch (caught) {
      const classified = classifyCoverageFailure(caught);
      setFailure(classified);
      if (classified.stale) onStale();
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, failure, run, clear: () => setFailure(null) };
}

/* ─── Offer Shift ─────────────────────────────────────────────────────────── */

interface OfferProps {
  gap: CoverageGap | null;
  candidate: CoverageCandidate | null;
  isOnline: boolean;
  zone: string | null;
  language?: string;
  /** The gap changed on the server (a new copy is passed) or moved under us (reload). */
  onResult: (gap: CoverageGap | null, outcome: "offered" | "assigned" | "stale") => void;
  onClose: () => void;
  t: Translate;
}

export function OfferShiftSheet({ gap, candidate, isOnline, zone, language, onResult, onClose, t }: OfferProps) {
  const theme = useTheme();
  const { busy, failure, run, clear } = useOneAtATime();
  const [acknowledged, setAcknowledged] = useState(false);
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    setAcknowledged(false);
    setOffered(false);
    clear();
    // a new candidate starts clean
  }, [candidate?.userId, gap?.id]);

  if (!gap || !candidate) return null;
  const needsAck = warningsToAcknowledge(candidate);
  const warnings = candidate.warnings.filter((w) => w !== "availability_unknown");
  const blockedAck = needsAck.length > 0 && !acknowledged;
  const stale = () => onResult(null, "stale");

  const assign = async () => {
    const saved = await run(() => assignGap(gap.id, candidate.userId, gap.version, acknowledged), stale);
    if (saved) onResult(saved, "assigned");
  };
  const offer = async () => {
    const saved = await run(() => createOffer(gap.id, candidate.userId, gap.version), stale);
    if (saved) {
      setOffered(true);
      onResult(saved.gap, "offered");
    }
  };

  return (
    <CoverageSheet
      visible
      title={offered ? t("teamSchedule.coverage.offer.created") : t("teamSchedule.coverage.offer.title")}
      subtitle={candidate.name}
      closeLabel={offered ? t("teamSchedule.coverage.done") : t("common.close")}
      onClose={onClose}
      testID="offer-sheet"
      footer={
        offered ? (
          <Button label={t("teamSchedule.coverage.done")} onPress={onClose} testID="offer-done" />
        ) : (
          <>
            <Button label={t("teamSchedule.coverage.offer.assignNow")} icon="person-add-outline" onPress={() => void assign()} loading={busy} disabled={busy || !isOnline || blockedAck} testID="offer-assign" />
            <Button label={t("teamSchedule.coverage.offer.createOffer")} icon="paper-plane-outline" variant="secondary" onPress={() => void offer()} disabled={busy || !isOnline} testID="offer-create" />
          </>
        )
      }
    >
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {gapTitle(gap, t)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
          {formatLongDate(gap.workDate, language)} · {gapWindow(gap, zone, language, t)}
        </Text>
        {candidate.existingShifts.length > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="offer-existing">
            {t("teamSchedule.coverage.offer.alsoScheduled", { shifts: candidate.existingShifts.slice(0, 3).map((s) => `${formatLongDate(s.workDate, language)} ${formatWallClock(s.workDate, s.startTime, s.workDate, zone, language)}`).join(", ") })}
          </Text>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("teamSchedule.coverage.offer.noOtherShifts")}
          </Text>
        )}
      </View>

      {offered ? (
        <SheetNotice text={t("teamSchedule.coverage.offer.notDelivered", { name: candidate.name })} testID="offer-not-delivered" />
      ) : (
        <>
          <SheetNotice text={t("teamSchedule.coverage.offer.availabilityUnknown")} testID="offer-availability" />
          {warnings.map((code) => (
            <SheetNotice key={code} tone="warn" text={candidateFlagText(code, t)} testID={`offer-warning-${code}`} />
          ))}
          {needsAck.length > 0 ? (
            <Pressable onPress={() => setAcknowledged((held) => !held)} accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }} testID="offer-acknowledge" style={[styles.ack, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}>
              <Ionicons name={acknowledged ? "checkbox" : "square-outline"} size={22} color={acknowledged ? theme.primaryAction : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.ackText, { color: theme.textPrimary }]}>
                {t("teamSchedule.coverage.offer.acknowledge")}
              </Text>
            </Pressable>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.offer.explain")}
          </Text>
        </>
      )}
      {!isOnline ? <SheetNotice tone="warn" text={t("teamSchedule.manage.offline")} testID="offer-offline" /> : null}
      {failure ? <SheetNotice tone="error" text={failureText(failure, t)} testID="offer-failure" /> : null}
    </CoverageSheet>
  );
}

/* ─── Waive / cancel ──────────────────────────────────────────────────────── */

interface WaiveProps {
  gap: CoverageGap | null;
  isOnline: boolean;
  onResult: (gap: CoverageGap | null) => void;
  onClose: () => void;
  t: Translate;
}

export function WaiveGapSheet({ gap, isOnline, onResult, onClose, t }: WaiveProps) {
  const { busy, failure, run, clear } = useOneAtATime();
  const [reason, setReason] = useState("");
  useEffect(() => {
    setReason("");
    clear();
    // a different gap starts clean
  }, [gap?.id]);
  if (!gap) return null;
  const cancel = gap.source === "open_shift";
  const submit = async () => {
    const saved = await run(() => waiveGap(gap.id, gap.version, reason.trim()), () => onResult(null));
    if (saved) onResult(saved);
  };
  return (
    <CoverageSheet
      visible
      title={t(cancel ? "teamSchedule.coverage.waive.cancelTitle" : "teamSchedule.coverage.waive.title")}
      subtitle={t(cancel ? "teamSchedule.coverage.waive.cancelHint" : "teamSchedule.coverage.waive.hint")}
      closeLabel={t("common.close")}
      onClose={onClose}
      testID="waive-sheet"
      footer={<Button label={t(cancel ? "teamSchedule.coverage.waive.cancelConfirm" : "teamSchedule.coverage.waive.confirm")} variant="destructive" onPress={() => void submit()} loading={busy} disabled={busy || !isOnline || reason.trim().length === 0} testID="waive-confirm" />}
    >
      <TextField label={t("teamSchedule.coverage.waive.reason")} value={reason} onChangeText={setReason} placeholder={t("teamSchedule.coverage.waive.reasonPlaceholder")} testID="waive-reason" maxLength={120} />
      {!isOnline ? <SheetNotice tone="warn" text={t("teamSchedule.manage.offline")} testID="waive-offline" /> : null}
      {failure ? <SheetNotice tone="error" text={failureText(failure, t)} testID="waive-failure" /> : null}
    </CoverageSheet>
  );
}

/* ─── Post an open shift ──────────────────────────────────────────────────── */

interface PostProps {
  visible: boolean;
  templates: readonly ShiftTemplate[] | null;
  templatesFailed: boolean;
  initialDate: string;
  today: string;
  isOnline: boolean;
  language?: string;
  onPosted: (gap: CoverageGap) => void;
  onClose: () => void;
  t: Translate;
}

/** Posts a shift nobody holds. Not offered to employees to claim in this release (no employee claim screen or
 *  notification exists yet), so it is always posted as supervisor-managed. */
export function PostOpenShiftSheet({ visible, templates, templatesFailed, initialDate, today, isOnline, language, onPosted, onClose, t }: PostProps) {
  const theme = useTheme();
  const { busy, failure, run, clear } = useOneAtATime();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const key = useRef(newOpenShiftKey());
  useEffect(() => {
    if (!visible) return;
    setTemplateId(null);
    setDate(initialDate < today ? today : initialDate);
    key.current = newOpenShiftKey();
    clear();
    // opening starts clean
  }, [visible]);
  if (!visible) return null;
  const usable = (templates ?? []).filter((template) => template.isActive && !template.archived);
  const submit = async () => {
    if (!templateId) return;
    const saved = await run(() => postOpenShift({ shiftId: templateId, workDate: date, claimable: false, idempotencyKey: key.current }), () => undefined);
    if (saved) onPosted(saved);
  };
  return (
    <CoverageSheet
      visible
      title={t("teamSchedule.coverage.post.title")}
      subtitle={t("teamSchedule.coverage.post.hint")}
      closeLabel={t("common.close")}
      onClose={onClose}
      testID="post-open-sheet"
      footer={<Button label={t("teamSchedule.coverage.post.confirm")} icon="add" onPress={() => void submit()} loading={busy} disabled={busy || !isOnline || !templateId} testID="post-open-confirm" />}
    >
      <View style={[styles.card, styles.dateRow, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <Pressable onPress={() => setDate(addDaysToYmd(date, -1))} disabled={date <= today} accessibilityRole="button" accessibilityLabel={t("teamSchedule.prevDay")} testID="post-open-prev" style={[styles.step, date <= today && styles.dim]}>
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.title, styles.dateText, { color: theme.textPrimary }]} testID="post-open-date">
          {formatLongDate(date, language)}
        </Text>
        <Pressable onPress={() => setDate(addDaysToYmd(date, 1))} accessibilityRole="button" accessibilityLabel={t("teamSchedule.nextDay")} testID="post-open-next" style={styles.step}>
          <Ionicons name="chevron-forward" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>
      {templatesFailed ? (
        <SheetNotice tone="error" text={t("teamSchedule.coverage.post.templatesFailed")} testID="post-open-templates-failed" />
      ) : usable.length === 0 ? (
        <SheetNotice text={t("teamSchedule.coverage.post.noTemplates")} testID="post-open-no-templates" />
      ) : (
        usable.map((template) => {
          const selected = template.id === templateId;
          return (
            <Pressable key={template.id} onPress={() => setTemplateId(template.id)} accessibilityRole="radio" accessibilityState={{ selected }} testID={`post-open-template-${template.id}`} style={[styles.template, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                {template.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {formatWallClock(date, template.startTime, `${date}T00:00:00Z`, null, language)} – {formatWallClock(date, template.endTime, `${date}T00:00:00Z`, null, language)}
              </Text>
            </Pressable>
          );
        })
      )}
      {!isOnline ? <SheetNotice tone="warn" text={t("teamSchedule.manage.offline")} testID="post-open-offline" /> : null}
      {failure ? <SheetNotice tone="error" text={failureText(failure, t)} testID="post-open-failure" /> : null}
    </CoverageSheet>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 4 },
  title: { fontSize: 16.5, fontWeight: "800" },
  body: { fontSize: 14.5, lineHeight: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  ack: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  ackText: { flex: 1 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateText: { flex: 1, textAlign: "center" },
  step: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.4 },
  template: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 2, minHeight: MIN_TARGET },
});
