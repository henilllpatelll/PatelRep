import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { AckRow, BlockerNotice, MetaRow, Section, StepIndicator, SummaryGrid, UnfinishedList, noticeText } from "@/components/supervisor/handoff/HandoffParts";
import { DraftField } from "@/components/supervisor/commsParts";
import { HandoffNotesAssist } from "@/components/supervisor/handoff/HandoffNotesAssist";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { HANDOFF_NOTES_MAX } from "@/lib/housekeeping/supervisorHandoff";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { useShiftHandoff } from "@/lib/housekeeping/useShiftHandoff";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Shift handoff ─────────────────────────────────────────────────────────
   A full-height sheet over Today (no new navigation destination):
   Prepare → Review → Confirm → Saved. See lib/housekeeping/supervisorHandoff.ts for what the figures mean
   and useShiftHandoff for the rules. Submitting records status; it never completes work or clocks anyone out. */

interface Props {
  visible: boolean;
  today: SupervisorToday;
  refresh: () => Promise<void>;
  /** `${tenantId}:${userId}`. */
  scope: string | null;
  isOnline: boolean;
  supervisorName: string;
  language: string;
  onClose: () => void;
}

/** A sheet that is not showing holds nothing; the kept draft (not component state) carries the note across opens. */
export function ShiftHandoffSheet(props: Props) {
  if (!props.visible) return null;
  return <HandoffSheet {...props} />;
}

function formatDay(date: string | null, language: string): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(language.startsWith("es") ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function HandoffSheet({ today, refresh, scope, isOnline, supervisorName, language, onClose }: Omit<Props, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const flow = useShiftHandoff({ today, refresh, scope, isOnline });
  const { step, report, blockers, notice, phase, saved } = flow;
  const busy = phase !== "idle";

  const dirty = flow.notes.trim().length > 0 && step !== "saved";
  const requestClose = useDiscardGuard({ dirty, busy, onClose, onDiscard: flow.actions.discard });

  // Say out loud what a screen-reader user cannot see happen.
  useEffect(() => {
    if (step === "saved") AccessibilityInfo.announceForAccessibility?.(t("supervisorHandoff.saved.title"));
  }, [step, t]);
  useEffect(() => {
    if (phase === "submitting") AccessibilityInfo.announceForAccessibility?.(t("supervisorHandoff.actions.submit"));
  }, [phase, t]);

  const noticeNode = notice
    ? (() => {
        const { text, tone } = noticeText(notice, t);
        return <SheetNotice tone={tone} text={text} testID={`handoff-notice-${notice.kind}`} />;
      })()
    : null;
  const verifyingNode = phase === "verifying" ? <SheetNotice text={t("supervisorHandoff.failure.verifying")} testID="handoff-verifying" /> : null;
  const timeOf = (instant: number | string | null) => (instant === null ? null : formatHotelTime(typeof instant === "number" ? new Date(instant) : instant, report.timeZone, language));

  const openReport = () => {
    if (!saved) return;
    onClose();
    router.push(`/(app)/logbook/${encodeURIComponent(saved.id)}` as never);
  };

  const title = step === "confirm" ? t("supervisorHandoff.confirm.title") : t("supervisorHandoff.title");

  /* ── Footer per step ── */
  let footer: React.ReactNode;
  if (step === "prepare") {
    footer = (
      <View style={styles.footerRow}>
        <Button label={t("supervisorHandoff.actions.cancel")} onPress={requestClose} variant="secondary" disabled={busy} style={styles.flex1} testID="handoff-cancel" />
        <Button
          label={t("supervisorHandoff.actions.review")}
          onPress={flow.actions.toReview}
          disabled={!flow.ready || blockers.length > 0 || flow.unresolved || busy}
          style={styles.flex2}
          testID="handoff-review"
        />
      </View>
    );
  } else if (step === "review") {
    footer = (
      <View style={styles.footerRow}>
        <Button label={t("supervisorHandoff.actions.backToEdit")} onPress={flow.actions.back} variant="secondary" style={styles.flex1} testID="handoff-back" />
        <Button
          label={t("supervisorHandoff.actions.continue")}
          onPress={flow.actions.toConfirm}
          disabled={!flow.acknowledged || blockers.length > 0}
          style={styles.flex1}
          testID="handoff-continue"
        />
      </View>
    );
  } else if (step === "confirm") {
    footer = (
      <View style={styles.footerStack}>
        <View style={styles.footerRow}>
          <Button label={t("supervisorHandoff.actions.backToReview")} onPress={flow.actions.back} variant="secondary" disabled={busy} style={styles.flex1} testID="handoff-back" />
          <Button
            label={t("supervisorHandoff.actions.submit")}
            onPress={flow.actions.submit}
            loading={phase === "submitting"}
            disabled={!flow.canSubmit}
            style={styles.flex1}
            testID="handoff-submit"
          />
        </View>
        <Button label={t("supervisorHandoff.actions.cancel")} onPress={requestClose} variant="ghost" disabled={busy} testID="handoff-cancel" />
      </View>
    );
  } else {
    footer = (
      <View style={styles.footerRow}>
        <Button label={t("supervisorHandoff.actions.done")} onPress={onClose} variant="secondary" style={styles.flex1} testID="handoff-done" />
        <Button label={t("supervisorHandoff.actions.viewReport")} onPress={openReport} style={styles.flex2} testID="handoff-view-report" />
      </View>
    );
  }

  const blockersNode = (
    <BlockerNotice blockers={blockers} isOnline={isOnline} refreshing={flow.refreshing} onRefresh={flow.actions.refresh} t={t} />
  );

  return (
    <BottomSheet visible title={title} onClose={requestClose} tall grabber footer={footer} scrollKey={notice?.kind ?? null} testID="handoff-sheet">
      {step !== "saved" ? <StepIndicator step={step} t={t} /> : null}

      {step === "prepare" ? (
        <View testID="handoff-step-prepare">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lead, { color: theme.textSecondary }]}>
            {t("supervisorHandoff.subtitle")}
          </Text>
          {flow.unresolved ? (
            <View style={styles.stack}>
              {noticeNode}
              <Button label={t("supervisorHandoff.actions.checkAgain")} onPress={flow.actions.checkAgain} loading={phase === "verifying"} variant="secondary" size="sm" icon="refresh" testID="handoff-check-again" />
            </View>
          ) : (
            <>
              {noticeNode}
              {verifyingNode}
            </>
          )}
          {blockersNode}
          <Section title={t("supervisorHandoff.summary.title")}>
            <SummaryGrid report={report} t={t} />
          </Section>
          <Section title={t("supervisorHandoff.unfinished.title")}>
            <UnfinishedList report={report} t={t} />
          </Section>
          <View style={styles.notes}>
            <DraftField
              label={t("supervisorHandoff.notes.label")}
              value={flow.notes}
              onChangeText={flow.setNotes}
              placeholder={t("supervisorHandoff.notes.placeholder")}
              max={HANDOFF_NOTES_MAX}
              counterText={t("supervisorHandoff.notes.counter", { count: flow.notes.trim().length, max: HANDOFF_NOTES_MAX })}
              minHeight={120}
              editable={flow.ready && !busy}
              testID="handoff-notes"
            />
            <HandoffNotesAssist today={today} notes={flow.notes} setNotes={flow.setNotes} disabled={!flow.ready || busy} language={language} />
          </View>
        </View>
      ) : null}

      {step === "review" ? (
        <View testID="handoff-step-review">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lead, { color: theme.textSecondary }]}>
            {t("supervisorHandoff.review.hint")}
          </Text>
          {flow.changes.length > 0 ? (
            <SheetNotice
              tone="warn"
              text={t("supervisorHandoff.review.changed", { what: flow.changes.map((key) => t(`supervisorHandoff.review.changes.${key}`)).join(", ") })}
              testID="handoff-changed"
            />
          ) : null}
          {noticeNode}
          {blockersNode}
          <Section title={t("supervisorHandoff.summary.title")}>
            <SummaryGrid report={report} t={t} />
          </Section>
          <Section title={t("supervisorHandoff.unfinished.title")}>
            <UnfinishedList report={report} t={t} />
          </Section>
          <Section
            title={t("supervisorHandoff.notes.label")}
            action={<Button label={t("supervisorHandoff.actions.edit")} onPress={flow.actions.back} variant="ghost" size="sm" testID="handoff-edit-notes" />}
          >
            <View style={[styles.noteBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} testID="handoff-review-notes">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: flow.notes.trim() ? theme.textPrimary : theme.textMuted }]}>
                {flow.notes.trim() || t("supervisorHandoff.notes.none")}
              </Text>
            </View>
          </Section>
          <Section title={t("supervisorHandoff.review.meta")}>
            <View style={[styles.meta, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
              <MetaRow testID="handoff-meta-date" label={t("supervisorHandoff.review.date")} value={formatDay(report.reportDate, language)} />
              <MetaRow label={t("supervisorHandoff.review.supervisor")} value={supervisorName || "—"} />
              <MetaRow label={t("supervisorHandoff.review.asOf")} value={timeOf(report.dataAsOf) ?? "—"} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.covers, { color: theme.textMuted }]}>
                {t("supervisorHandoff.review.covers")}
              </Text>
            </View>
          </Section>
          <View style={styles.notes}>
            <AckRow checked={flow.acknowledged} onChange={flow.setAcknowledged} disabled={blockers.length > 0} label={t("supervisorHandoff.review.ack")} />
          </View>
        </View>
      ) : null}

      {step === "confirm" ? (
        <View testID="handoff-step-confirm" style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lead, { color: theme.textPrimary, fontWeight: "600" }]}>
            {t("supervisorHandoff.confirm.description")}
          </Text>
          {["records", "open", "clock"].map((key) => (
            <View key={key} style={styles.point}>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.status.ready} style={styles.pointIcon} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pointText, { color: theme.textSecondary }]}>
                {t(`supervisorHandoff.confirm.${key}`)}
              </Text>
            </View>
          ))}
          {!isOnline ? <SheetNotice tone="warn" text={t("supervisorHandoff.blockers.offline")} testID="handoff-offline" /> : null}
          {noticeNode}
          {verifyingNode}
          {flow.unresolved ? (
            <Button label={t("supervisorHandoff.actions.checkAgain")} onPress={flow.actions.checkAgain} loading={phase === "verifying"} variant="secondary" size="sm" icon="refresh" testID="handoff-check-again" />
          ) : null}
          {isOnline ? blockersNode : null}
        </View>
      ) : null}

      {step === "saved" && saved ? (
        <View testID="handoff-step-saved" style={styles.stack}>
          <View style={styles.savedHead} accessibilityLiveRegion="polite">
            <View style={[styles.savedIcon, { backgroundColor: theme.status.readySoft ?? theme.surfaceMuted }]}>
              <Ionicons name="checkmark" size={30} color={theme.status.ready} />
            </View>
            <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.savedTitle, { color: theme.textPrimary }]}>
              {t("supervisorHandoff.saved.title")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.savedBody, { color: theme.textSecondary }]}>
              {saved.replay ? t("supervisorHandoff.saved.previously") : t("supervisorHandoff.saved.body")}
            </Text>
          </View>
          <View style={[styles.meta, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
            <MetaRow testID="handoff-saved-ref" label={t("supervisorHandoff.saved.reference")} value={`#${saved.id.slice(0, 8).toUpperCase()}`} />
            <MetaRow label={t("supervisorHandoff.saved.savedAt")} value={timeOf(saved.createdAt) ?? "—"} />
            <MetaRow label={t("supervisorHandoff.saved.date")} value={formatDay(saved.reportDate, language)} />
          </View>
          <SheetNotice text={t("supervisorHandoff.saved.stillOpen")} testID="handoff-still-open" />
          <SheetNotice
            tone={saved.managers === "failed" || saved.managers === "unknown" ? "warn" : "info"}
            text={t(`supervisorHandoff.saved.managers${saved.managers === "complete" ? "Complete" : saved.managers === "none_needed" ? "None" : saved.managers === "failed" ? "Failed" : "Unknown"}`)}
            testID="handoff-managers"
          />
          {noticeNode}
          {saved.managers === "failed" ? (
            <Button label={t("supervisorHandoff.actions.notifyAgain")} onPress={flow.actions.notifyAgain} loading={phase === "submitting"} disabled={!isOnline} variant="secondary" size="sm" testID="handoff-notify-again" />
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14.5, lineHeight: 21, marginTop: 8 },
  stack: { gap: 12, marginTop: 8 },
  notes: { marginTop: 18 },
  noteBox: { borderWidth: 1, borderRadius: R.md, padding: 12 },
  noteText: { fontSize: 14.5, lineHeight: 21 },
  meta: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  covers: { fontSize: 12, lineHeight: 16, marginTop: 4 },
  point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  pointIcon: { marginTop: 1 },
  pointText: { flex: 1, fontSize: 14.5, lineHeight: 21 },
  footerRow: { flexDirection: "row", gap: 10 },
  footerStack: { gap: 4 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  savedHead: { alignItems: "center", gap: 8, paddingVertical: 8 },
  savedIcon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  savedTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  savedBody: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
});
