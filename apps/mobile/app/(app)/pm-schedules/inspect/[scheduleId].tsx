import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewInstance } from "react-native";
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
import { PmCompletionSummary, type PmRecordedSummary } from "@/components/engineering/pm/PmCompletionSummary";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmCompletionResult } from "@/lib/api/pm";
import { usePmSchedules } from "@/lib/engineering/usePmSchedules";
import { usePmInspection, type SubmitOutcome } from "@/lib/engineering/usePmInspection";
import { canCompletePm } from "@/lib/engineering/roles";
import { isSafeRouteId, pmRecordRoute } from "@/lib/engineering/routes";
import { parseReading } from "@/lib/engineering/pmReadings";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

type Step = "fill" | "review";

function apiMessage(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return error instanceof Error && error.message ? error.message : null;
}

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

  const [step, setStep] = useState<Step>("fill");
  const [attempted, setAttempted] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [recorded, setRecorded] = useState<{ result: PmCompletionResult; summary: PmRecordedSummary } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<string, number>());

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const jumpTo = useCallback((itemId: string) => {
    setStep("fill");
    setExpanded((cur) => new Set(cur).add(itemId));
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, (offsets.current.get(itemId) ?? 0) - 80), animated: true }), 60);
  }, []);

  const unansweredFirst = progress?.unansweredIds[0] ?? progress?.evidenceMissingIds[0] ?? null;
  const goReview = () => {
    setAttempted(true);
    setOutcome(null);
    setStep("review");
  };

  const complete = async () => {
    if (!schedule || !progress) return;
    const summary: PmRecordedSummary = {
      scheduleName: schedule.name,
      assetName: schedule.assetName,
      passed: progress.passed,
      failed: progress.failed,
      notApplicable: progress.notApplicable,
    };
    const result = await inspection.submit();
    setOutcome(result);
    if (result.kind === "recorded") setRecorded({ result: result.result, summary });
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <Pressable
        onPress={() => (step === "review" && !recorded ? setStep("fill") : router.back())}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        testID="pm-inspect-back"
      >
        <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
      </Pressable>
      <View style={styles.headerCopy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerTitle, { color: theme.shell.ink }]} numberOfLines={1} accessibilityRole="header">
          {schedule?.name ?? t("pm.inspection")}
        </Text>
        {schedule?.assetName ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerSub, { color: theme.shell.ink3 }]} numberOfLines={1}>
            {schedule.assetName}
          </Text>
        ) : null}
      </View>
    </View>
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
        <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + 24 }]}>
          <PmCompletionSummary
            summary={recorded.summary}
            result={recorded.result}
            onViewRecord={() => router.replace((pmRecordRoute(recorded.result.id, schedule.id) ?? "/(app)/pm-schedules") as never)}
            onOpenWorkOrder={(id) => {
              if (isSafeRouteId(id)) router.push(`/(app)/work-orders/${id}` as never);
            }}
            onDone={() => router.replace("/(app)/pm-schedules" as never)}
          />
        </ScrollView>
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

  /* ── body ── */
  let body: React.ReactNode;
  if (inspection.loading) {
    body = <EngineeringState status="loading" emptyTitle="" />;
  } else if (inspection.failure) {
    body = <EngineeringState status={inspection.failure === "forbidden" ? "forbidden" : inspection.failure === "offline" ? "offline" : "error"} onRetry={inspection.reload} emptyTitle="" />;
  } else if (inspection.checklistIssue) {
    const issue = inspection.checklistIssue.state;
    body = (
      <Card style={styles.configCard} testID="pm-checklist-unavailable">
        <Ionicons name="alert-circle-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]} accessibilityRole="header">
          {t(`pm.binding.${issue}.title`)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t(`pm.binding.${issue}.body`)}
        </Text>
      </Card>
    );
  } else if (inspection.templates.length === 0) {
    body = (
      <Card style={styles.configCard} testID="pm-no-templates">
        <Ionicons name="construct-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]}>
          {t("pm.config.noTemplatesTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.config.noTemplatesBody")}
        </Text>
      </Card>
    );
  } else if (!draft) {
    body = (
      <View style={styles.stack} testID="pm-template-picker">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
          {t("pm.chooseChecklist")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.chooseChecklistBody")}
        </Text>
        {inspection.templates.map((tpl) => (
          <Pressable
            key={tpl.id}
            onPress={() => inspection.chooseTemplate(tpl.id)}
            style={[styles.templateRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="button"
            testID={`pm-template-${tpl.id}`}
          >
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]}>
                {tpl.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("pm.stepsCount", { count: tpl.items.length })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
          </Pressable>
        ))}
      </View>
    );
  } else if (compatibility !== "ok" || !template || !progress) {
    body = (
      <Card style={styles.configCard} testID="pm-draft-incompatible">
        <Ionicons name="alert-circle-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.configTitle, { color: theme.textPrimary }]}>
          {compatibility === "template_missing" ? t("pm.draft.templateMissingTitle") : t("pm.draft.templateChangedTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {compatibility === "template_missing" ? t("pm.draft.templateMissingBody") : t("pm.draft.templateChangedBody")}
        </Text>
        {compatibility === "template_changed" ? <Button label={t("pm.draft.useUpdated")} onPress={inspection.useCurrentChecklist} testID="pm-draft-rebase" /> : null}
        <Button label={t("pm.draft.discard")} variant="secondary" onPress={() => void inspection.discard()} testID="pm-draft-discard-now" />
      </Card>
    );
  } else if (step === "review") {
    body = (
      <PmReviewSection schedule={schedule} template={template} draft={draft} progress={progress} meters={inspection.meters} technician={technician} onJump={jumpTo} />
    );
  } else {
    body = (
      <View style={styles.stack}>
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
          <View key={item.id} onLayout={(e: LayoutChangeEvent) => offsets.current.set(item.id, e.nativeEvent.layout.y)}>
            <PmChecklistItem
              index={index}
              item={item}
              answer={draft.items[item.id]}
              expanded={expanded.has(item.id)}
              online={isOnline}
              uploading={inspection.uploading.has(item.id)}
              showUnanswered={attempted}
              showEvidenceMissing={attempted}
              onToggle={() => toggle(item.id)}
              onResult={(result) => {
                inspection.setResult(item.id, result);
              }}
              onNote={(note) => inspection.patchItem(item.id, { note })}
              onAddPhoto={(uri, signal) => inspection.attachPhoto(item.id, uri, `${schedule.name}: ${item.label}`, signal)}
              onRemovePhoto={(id) => void inspection.removePhoto(item.id, id)}
            />
          </View>
        ))}

        {inspection.meters.length > 0 ? (
          <View style={styles.stack} testID="pm-readings">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
              {t("pm.readings")}
            </Text>
            <Card style={styles.readingsCard}>
              {inspection.meters.map((meter) => (
                <PmReadingInput
                  key={meter.id}
                  meter={meter}
                  value={draft.readings[meter.id]?.value ?? ""}
                  onChange={(value) => inspection.patch((d) => ({ ...d, readings: { ...d.readings, [meter.id]: { value, note: d.readings[meter.id]?.note ?? "" } } }))}
                  showError={attempted || parseReading(draft.readings[meter.id]?.value).kind === "invalid" || readingInvalid.has(meter.id)}
                />
              ))}
            </Card>
          </View>
        ) : null}

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
        />

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
  const showFooter = !!draft && !!template && !!progress && compatibility === "ok";
  const outcomeText =
    outcome?.kind === "refused"
      ? ((outcome.error as { status?: number } | null)?.status === 403
          ? t("pm.errors.forbidden")
          : (outcome.error as { status?: number } | null)?.status === 404
            ? t("pm.errors.scheduleGone")
            : `${t("pm.errors.refused")}${apiMessage(outcome.error) ? ` ${apiMessage(outcome.error)}` : ""}`)
      : outcome?.kind === "unknown"
        ? t("pm.errors.unknown")
        : outcome?.kind === "blocked" && outcome.issues.length > 0
          ? t("pm.errors.incomplete")
          : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {header}
      <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 160 }]} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>

      {showFooter ? (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: insets.bottom + 12 }]}>
          {outcomeText ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: outcome?.kind === "unknown" ? theme.status.pickup : theme.status.dirty }]} accessibilityLiveRegion="polite" testID="pm-outcome">
              {outcomeText}
            </Text>
          ) : null}
          {step === "fill" ? (
            <Button
              label={t("pm.reviewInspection")}
              onPress={() => {
                goReview();
              }}
              size="lg"
              testID="pm-review-button"
              accessibilityLabel={unansweredFirst ? `${t("pm.reviewInspection")}. ${t("pm.progress", { done: progress!.answered, total: progress!.total })}` : t("pm.reviewInspection")}
            />
          ) : (
            <>
              {!isOnline ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.outcome, { color: theme.status.pickup }]} testID="pm-offline-submit">
                  {t("pm.needsConnection")}
                </Text>
              ) : null}
              <Button
                label={t("pm.completeInspection")}
                onPress={() => void complete()}
                size="lg"
                loading={inspection.submitting}
                disabled={blocked || !isOnline || inspection.submitting}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  headerSub: { fontSize: 13 },
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
  outcome: { fontSize: 13, lineHeight: 18 },
});
