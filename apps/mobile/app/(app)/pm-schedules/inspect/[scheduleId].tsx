import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewInstance } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { PmChecklistItem } from "@/components/engineering/pm/PmChecklistItem";
import { PmReadingInput } from "@/components/engineering/pm/PmReadingInput";
import { PmExtrasSection } from "@/components/engineering/pm/PmExtrasSection";
import { PmReviewSection } from "@/components/engineering/pm/PmReviewSection";
import { type PmRecordedSummary } from "@/components/engineering/pm/PmCompletionSummary";
import { PmRecordedView } from "@/components/engineering/pm/PmRecordedView";
import { PmFailureSheet } from "@/components/engineering/pm/PmFailureSheet";
import { PmQueuedNotice } from "@/components/engineering/pm/PmQueuedNotice";
import { PmInspectionGate, inspectionReady } from "@/components/engineering/pm/PmInspectionGate";
import { PmInspectionHeader } from "@/components/engineering/pm/PmInspectionHeader";
import { PmStepper } from "@/components/engineering/pm/PmStepper";
import { locationLabel } from "@/components/engineering/pm/pmUi";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmCompletionResult } from "@/lib/api/pm";
import { usePmSchedules } from "@/lib/engineering/usePmSchedules";
import { usePmInspection, type SubmitOutcome } from "@/lib/engineering/usePmInspection";
import { localPhotoRefs } from "@/lib/engineering/pmChecklist";
import { queuedState } from "@/lib/engineering/pmSyncState";
import { usePmSyncActivity } from "@/lib/engineering/pmSyncRunner";
import { evidenceSummary, issueSection, sectionStatuses, PM_SECTIONS, type PmInspectionIssue, type PmSection } from "@/lib/engineering/pmChecklist";
import { canCompletePm } from "@/lib/engineering/roles";
import { assetRoute } from "@/lib/engineering/routes";
import { parseReading } from "@/lib/engineering/pmReadings";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

function apiMessage(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return error instanceof Error && error.message ? error.message : null;
}

/** Space the scroll area keeps free of the pinned footer. */
const FOOTER_ROOM = 170;

export default function PmInspectionScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const canInspect = canCompletePm(user?.effective_role ?? user?.role);
  const data = usePmSchedules();
  const schedule = useMemo(() => data.schedules.find((s) => s.id === scheduleId) ?? null, [data.schedules, scheduleId]);
  const inspection = usePmInspection(canInspect ? schedule : null);
  const { draft, template, progress, compatibility } = inspection;

  const syncingRows = usePmSyncActivity((s) => s.active);
  const [section, setSection] = useState<PmSection>("checklist");
  const [attempted, setAttempted] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [failureItem, setFailureItem] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [recorded, setRecorded] = useState<{ result: PmCompletionResult; summary: PmRecordedSummary } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  /** Where each field sits inside its block, and where each block starts, so "Fix this" can scroll to the exact field. */
  const anchors = useRef(new Map<string, number>());
  const bases = useRef(new Map<string, number>());
  const mark = (key: string) => (e: LayoutChangeEvent) => anchors.current.set(key, e.nativeEvent.layout.y);
  const markBase = (key: string) => (e: LayoutChangeEvent) => bases.current.set(key, e.nativeEvent.layout.y);

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [section]);

  const scrollToField = useCallback((key: string, base: string | null) => {
    setTimeout(() => {
      const y = (anchors.current.get(key) ?? 0) + (base ? bases.current.get(base) ?? 0 : 0);
      scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }, 80);
  }, []);

  const fixIssue = useCallback(
    (issue: PmInspectionIssue) => {
      setSection(issueSection(issue));
      switch (issue.code) {
        case "unanswered":
        case "evidence_required":
        case "finding_required":
          setExpanded((cur) => new Set(cur).add(issue.itemId));
          // A failed step is fixed in the failure sheet, where its finding and photo live together.
          if (draft?.items[issue.itemId]?.result === "failed" && issue.code !== "unanswered") setFailureItem(issue.itemId);
          else scrollToField(`item:${issue.itemId}`, "checklist");
          break;
        case "reading_invalid":
          scrollToField(`reading:${issue.meterId}`, "readings");
          break;
        case "labor_invalid":
          scrollToField("labor", "extras");
          break;
        case "part_invalid":
          scrollToField(`part:${issue.partId}`, "extras");
          break;
        default:
          scrollToField(`defect:${issue.defectId}`, "extras");
      }
    },
    [draft, scrollToField],
  );

  const goReview = () => {
    setAttempted(true);
    setOutcome(null);
    setSection("review");
  };
  const select = (next: PmSection) => (next === "review" ? goReview() : setSection(next));
  const sectionLabel = (s: PmSection) => t(`pm.stepper.${s}`);

  // Screen readers hear how a submission ended; the on-screen text is the same words.
  useEffect(() => {
    if (!outcome) return;
    if (outcome.kind === "queued") AccessibilityInfo.announceForAccessibility(t("pm.queued.announce"));
    else if (outcome.kind === "unknown") AccessibilityInfo.announceForAccessibility(t("pm.submit.announceUnknown"));
    else if (outcome.kind === "refused") AccessibilityInfo.announceForAccessibility(t("pm.submit.announceRejected"));
  }, [outcome, t]);

  const complete = async () => {
    if (!schedule || !progress || !draft || !template) return;
    const summary: PmRecordedSummary = {
      scheduleName: schedule.name,
      assetName: schedule.assetName,
      assetId: schedule.assetId,
      technician: user?.preferred_name || user?.full_name || null,
      passed: progress.passed,
      failed: progress.failed,
      notApplicable: progress.notApplicable,
      readings: inspection.meters.filter((m) => parseReading(draft.readings[m.id]?.value).kind === "ok").length,
      photos: evidenceSummary(template, draft).photos,
    };
    const result = await inspection.submit();
    setOutcome(result);
    if (result.kind === "recorded") {
      AccessibilityInfo.announceForAccessibility(t("pm.submit.announceRecorded"));
      setRecorded({ result: result.result, summary });
    }
  };

  const title = schedule ? (schedule.assetName ? `${schedule.assetName} — ${schedule.name}` : schedule.name) : t("pm.inspection");
  const subtitle = schedule ? [schedule.assetTag, locationLabel(schedule, t)].filter(Boolean).join(" · ") || null : null;
  const checklistLabel = template ? (template.version != null ? t("pm.header.checklist", { name: template.name, version: template.version }) : template.name) : null;
  const equipmentRoute = schedule ? assetRoute(schedule.assetId) : null;
  const header = (
    <PmInspectionHeader
      title={title}
      subtitle={subtitle}
      checklist={checklistLabel}
      saveState={recorded ? "idle" : inspection.saveState}
      onBack={() => (section !== "checklist" && !recorded && draft ? setSection(PM_SECTIONS[Math.max(0, PM_SECTIONS.indexOf(section) - 1)]) : router.back())}
      onOpenEquipment={equipmentRoute && !recorded ? () => router.push(equipmentRoute as never) : null}
    />
  );

  if (!canInspect) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <View style={styles.pad}>
          <EngineeringState status="forbidden" emptyTitle="" />
        </View>
      </View>
    );
  }

  if (recorded && schedule) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <PmRecordedView scheduleId={schedule.id} summary={recorded.summary} result={recorded.result} />
      </View>
    );
  }

  // A completion already frozen for this schedule: the form is not offered again, so one inspection cannot be recorded twice.
  if (inspection.queued && schedule) {
    const row = inspection.queued;
    const state = queuedState({ phase: row.data?.phase ?? "queued", stop: row.data ? row.lastError : "unreadable", attempts: row.attempts, active: syncingRows.includes(row.rowId) });
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <PmQueuedNotice state={state} onOpenSync={() => router.push("/(app)/engineering-sync" as never)} onBack={() => router.back()} />
      </View>
    );
  }

  // The schedule list is still loading, failed, or the schedule is gone: never start an inspection against nothing.
  if (!schedule) {
    const status = data.loading && !data.hasData ? "loading" : data.failure && !data.hasData ? (data.failure === "forbidden" ? "forbidden" : data.failure === "offline" ? "offline" : "error") : "empty";
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {header}
        <View style={styles.pad}>
          <EngineeringState status={status} onRetry={() => void data.reload()} emptyIcon="calendar-outline" emptyTitle={t("pm.detail.notFound")} emptyBody={t("pm.detail.notFoundBody")} />
        </View>
      </View>
    );
  }

  const invalidPartIds = new Set(inspection.issues.flatMap((i) => (i.code === "part_invalid" ? [i.partId] : [])));
  const invalidDefectIds = new Set(inspection.issues.flatMap((i) => (i.code === "defect_invalid" ? [i.defectId] : [])));
  const laborInvalid = inspection.issues.some((i) => i.code === "labor_invalid");
  const readingInvalid = new Set(inspection.issues.flatMap((i) => (i.code === "reading_invalid" ? [i.meterId] : [])));
  const blocked = inspection.issues.length > 0 || compatibility !== "ok";
  const technician = user?.preferred_name || user?.full_name || null;
  const ready = inspectionReady(inspection);
  const failing = failureItem && template ? template.items.find((i) => i.id === failureItem) ?? null : null;

  /* ── body ── */
  let body: React.ReactNode;
  if (!ready || !draft || !template || !progress) {
    body = <PmInspectionGate inspection={inspection} />;
  } else if (section === "review") {
    body = (
      <PmReviewSection
        schedule={schedule}
        template={template}
        draft={draft}
        progress={progress}
        meters={inspection.meters}
        technician={technician}
        issues={inspection.issues}
        onFix={fixIssue}
      />
    );
  } else if (section === "measurements") {
    body = (
      <View style={styles.stack} testID="pm-readings">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.measure.intro")}
        </Text>
        {inspection.meters.length === 0 ? (
          <Card style={styles.configCard} testID="pm-no-meters">
            <Ionicons name="speedometer-outline" size={22} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]}>
              {t("pm.measure.none")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
              {t("pm.measure.noneBody")}
            </Text>
          </Card>
        ) : (
          <View onLayout={markBase("readings")}>
            <Card style={styles.readingsCard}>
              {inspection.meters.map((meter) => (
                <View key={meter.id} onLayout={mark(`reading:${meter.id}`)}>
                  <PmReadingInput
                    meter={meter}
                    value={draft.readings[meter.id]?.value ?? ""}
                    onChange={(value) => inspection.patch((d) => ({ ...d, readings: { ...d.readings, [meter.id]: { value, note: d.readings[meter.id]?.note ?? "" } } }))}
                    showError={attempted || parseReading(draft.readings[meter.id]?.value).kind === "invalid" || readingInvalid.has(meter.id)}
                  />
                </View>
              ))}
            </Card>
          </View>
        )}
      </View>
    );
  } else if (section === "findings") {
    body = (
      <View style={styles.stack}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.findings.intro")}
        </Text>
        <View onLayout={markBase("extras")}>
          <PmExtrasSection
            draft={draft}
            patch={inspection.patch}
            online={isOnline}
            uploading={inspection.uploading.has("general")}
            showErrors={attempted}
            invalidPartIds={invalidPartIds}
            invalidDefectIds={invalidDefectIds}
            laborInvalid={laborInvalid}
            onAddPhoto={(uri, signal) => inspection.attachPhoto("general", uri, schedule.name, signal)}
            onRemovePhoto={(id) => void inspection.removePhoto("general", id)}
            onAnchor={(key, y) => anchors.current.set(key, y)}
          />
        </View>
      </View>
    );
  } else {
    body = (
      <View style={styles.stack} onLayout={markBase("checklist")}>
        <Card style={styles.progressCard} testID="pm-progress">
          <View style={styles.progressRow}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]}>
              {t("pm.progress", { done: progress.answered, total: progress.total })}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {progress.percent}%
            </Text>
          </View>
          <View
            style={[styles.bar, { backgroundColor: theme.surfaceSubtle }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: progress.total, now: progress.answered }}
          >
            <View style={[styles.barFill, { width: `${progress.percent}%`, backgroundColor: theme.status.ready }]} />
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="pm-draft-label">
            {t("pm.localDraftSaved")}
          </Text>
        </Card>

        {template.items.map((item, index) => (
          <View key={item.id} onLayout={mark(`item:${item.id}`)}>
            <PmChecklistItem
              index={index}
              item={item}
              answer={draft.items[item.id]}
              expanded={expanded.has(item.id)}
              online={isOnline}
              uploading={inspection.uploading.has(item.id)}
              showUnanswered={attempted}
              showEvidenceMissing={attempted}
              showFindingMissing={attempted}
              onToggle={() => toggle(item.id)}
              onOpenFailure={() => setFailureItem(item.id)}
              onResult={(result) => {
                inspection.setResult(item.id, result);
              }}
              onNote={(note) => inspection.patchItem(item.id, { note })}
              onAddPhoto={(uri, signal) => inspection.attachPhoto(item.id, uri, `${schedule.name}: ${item.label}`, signal)}
              onRemovePhoto={(id) => void inspection.removePhoto(item.id, id)}
            />
          </View>
        ))}

        {confirmDiscard ? (
          <Card style={styles.configCard} testID="pm-discard-confirm">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textPrimary }]}>
              {t("pm.draft.discardConfirm")}
            </Text>
            <Button
              label={t("pm.draft.discard")}
              variant="destructive"
              onPress={async () => {
                await inspection.discard();
                setConfirmDiscard(false);
                setAttempted(false);
                setExpanded(new Set());
                setSection("checklist");
              }}
              testID="pm-discard-yes"
            />
            <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirmDiscard(false)} />
          </Card>
        ) : (
          <Pressable onPress={() => setConfirmDiscard(true)} style={styles.discard} accessibilityRole="button" testID="pm-discard">
            <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("pm.draft.discard")}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  /* ── footer ── */
  const refusedStatus = outcome?.kind === "refused" ? (outcome.error as { status?: number } | null)?.status : undefined;
  const outcomeText =
    outcome?.kind === "refused"
      ? refusedStatus === 403
        ? t("pm.errors.forbidden")
        : refusedStatus === 404
          ? t("pm.errors.scheduleGone")
          : `${t("pm.errors.refused")}${apiMessage(outcome.error) ? ` ${apiMessage(outcome.error)}` : ""}`
      : outcome?.kind === "unknown"
        ? t("pm.errors.unknown")
        : outcome?.kind === "blocked" && outcome.issues.length > 0
          ? t("pm.errors.incomplete")
          : outcome?.kind === "photo_missing"
            ? t("pm.errors.photoMissing")
            : outcome?.kind === "already_queued"
              ? t("pm.errors.alreadyQueued")
              : outcome?.kind === "queue_failed"
                ? t("pm.errors.queueFailed")
                : null;
  const outcomeTitle = outcome?.kind === "refused" ? t("pm.submit.rejectedTitle") : outcome?.kind === "unknown" ? t("pm.submit.unknownTitle") : null;
  // Offline, or holding a photo that is only on this phone: the button saves the inspection for the sync instead of
  // completing it, and says so. Completing means the server confirmed it.
  const savesForSync = !isOnline || (draft != null && localPhotoRefs(draft).length > 0);
  const sectionIndex = PM_SECTIONS.indexOf(section);
  const nextSection = PM_SECTIONS[Math.min(PM_SECTIONS.length - 1, sectionIndex + 1)];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {header}
      {ready ? (
        <View style={styles.stepper}>
          <PmStepper current={section} status={sectionStatuses(template!, draft!, inspection.meters, inspection.issues, attempted)} onSelect={select} />
        </View>
      ) : null}
      <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + FOOTER_ROOM }]} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>

      {ready ? (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: insets.bottom + 12 }]}>
          {outcomeText ? (
            <View accessibilityLiveRegion="polite">
              {outcomeTitle ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcomeTitle, { color: outcome?.kind === "unknown" ? theme.status.pickup : theme.status.dirty }]}>
                  {outcomeTitle}
                </Text>
              ) : null}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: outcome?.kind === "unknown" ? theme.status.pickup : theme.status.dirty }]} testID="pm-outcome">
                {outcomeText}
              </Text>
            </View>
          ) : null}
          {section !== "review" ? (
            <Button
              label={section === "findings" ? t("pm.reviewInspection") : t("pm.stepper.next", { name: sectionLabel(nextSection) })}
              onPress={() => (section === "findings" ? goReview() : setSection(nextSection))}
              size="lg"
              testID={section === "findings" ? "pm-review-button" : "pm-next-button"}
              accessibilityLabel={
                section === "findings" ? `${t("pm.reviewInspection")}. ${t("pm.progress", { done: progress!.answered, total: progress!.total })}` : t("pm.stepper.next", { name: sectionLabel(nextSection) })
              }
            />
          ) : (
            <>
              {!isOnline || savesForSync ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: theme.status.pickup }]} testID="pm-offline-submit">
                  {t(isOnline ? "pm.photosPendingNote" : "pm.saveForSyncNote")}
                </Text>
              ) : null}
              {inspection.submitting ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: theme.textSecondary }]} accessibilityLiveRegion="polite" testID="pm-submitting">
                  {t("pm.submit.sending")}
                </Text>
              ) : null}
              <Button
                label={savesForSync ? t("pm.saveForSync") : outcome?.kind === "unknown" ? t("pm.submit.retry") : t("pm.completeInspection")}
                onPress={() => void complete()}
                size="lg"
                loading={inspection.submitting}
                disabled={blocked || inspection.submitting}
                testID="pm-complete-button"
              />
              {blocked && inspection.issues.length > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: theme.status.dirty }]} testID="pm-blocked-note">
                  {t("pm.errors.incomplete")}
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {failing && draft ? (
        <PmFailureSheet
          visible
          equipmentName={schedule.assetName}
          stepLabel={failing.label}
          note={draft.items[failing.id]?.note ?? ""}
          evidence={draft.items[failing.id]?.evidence ?? []}
          uploading={inspection.uploading.has(failing.id)}
          online={isOnline}
          onNote={(note) => inspection.patchItem(failing.id, { note })}
          onAddPhoto={(uri, signal) => inspection.attachPhoto(failing.id, uri, `${schedule.name}: ${failing.label}`, signal)}
          onRemovePhoto={(id) => void inspection.removePhoto(failing.id, id)}
          onClose={() => setFailureItem(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepper: { paddingHorizontal: 16, paddingBottom: 4 },
  pad: { padding: 16 },
  content: { padding: 16 },
  stack: { gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  hint: { fontSize: 13, lineHeight: 18 },
  configCard: { padding: 16, gap: 10 },
  configTitle: { fontSize: 15, fontWeight: "700" },
  templateRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 60 },
  progressCard: { padding: 14, gap: 8 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  readingsCard: { padding: 14, gap: 16 },
  discard: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, justifyContent: "center", marginTop: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, gap: 8 },
  outcomeTitle: { fontSize: 14, fontWeight: "800" },
  outcome: { fontSize: 13, lineHeight: 18 },
});
