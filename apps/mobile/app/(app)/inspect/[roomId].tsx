import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { ChecklistItemRow } from "@/components/supervisor/inspect/workspace/ChecklistItemRow";
import { ContextSheet } from "@/components/supervisor/inspect/workspace/ContextSheet";
import { DiscardSheet, ResumeSheet, SaveExitSheet, StartOverSheet } from "@/components/supervisor/inspect/workspace/DraftSheets";
import { GuidanceSheet } from "@/components/supervisor/inspect/workspace/GuidanceSheet";
import { IssueSheet } from "@/components/supervisor/inspect/workspace/IssueSheet";
import { ChangeAnswerSheet, CorrectionSheet } from "@/components/supervisor/inspect/workspace/IssueSheets";
import { PhotoViewer } from "@/components/supervisor/inspect/workspace/PhotoViewer";
import { MoreSheet } from "@/components/supervisor/inspect/workspace/MoreSheet";
import { ProgressCard } from "@/components/supervisor/inspect/workspace/ProgressCard";
import { ReinspectionPanel } from "@/components/supervisor/inspect/workspace/ReinspectionPanel";
import { ReviewView, type RecheckLine } from "@/components/supervisor/inspect/workspace/ReviewView";
import { ApprovedView, CorrectionRequestedView, PROBLEM_REASONS, ProblemBanner, UncertainView } from "@/components/supervisor/inspect/workspace/ResultViews";
import { RoomSummary } from "@/components/supervisor/inspect/workspace/RoomSummary";
import { SectionHeader } from "@/components/supervisor/inspect/workspace/SectionHeader";
import { BlockedView, TemplateChangedView, UnavailableView, WorkspaceLoading } from "@/components/supervisor/inspect/workspace/StateViews";
import { WorkspaceFooter } from "@/components/supervisor/inspect/workspace/WorkspaceFooter";
import { WorkspaceHeader } from "@/components/supervisor/inspect/workspace/WorkspaceHeader";
import { normalizeRoomIdParam } from "@/lib/housekeeping/inspectionTarget";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { itemsToRecheck } from "@/lib/inspections/corrections";
import { planCorrection } from "@/lib/inspections/correctionPlan";
import type { Answer } from "@/lib/inspections/types";
import { inspectionHref, originHref, parseOrigin } from "@/lib/inspections/route";
import { useActiveInspection } from "@/lib/inspections/useActiveInspection";
import { NA_POLICY, buildReview, failedCount, hasProgress, recheckStanding } from "@/lib/inspections/workspace";
import { progressText, reviewedLine, roomFacts, saveText } from "@/lib/inspections/workspaceText";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";

/* ─── Inspect a room — the active inspection workspace ──────────────────────
   One full-screen route for every way into an inspection. It resolves the room by its stable id against the verified
   queue, shows the hotel's configured checklist, and keeps the supervisor's answers durable on the phone. Nothing is sent
   until the supervisor chooses "Approve room" or "Submit & request correction" on the review; the room's status changes
   only when the server confirms the inspection, and every outcome screen states what the server recorded (or that the
   outcome is not yet known). Reporting an issue (description, severity, one photo) happens in a bottom drawer and is saved
   into the same on-phone draft. The screen is only mounted while focused, so leaving it always releases its timers and
   subscriptions, and coming back starts from what is saved. */

type Sheet = null | "more" | "context" | "saveExit" | "discard" | "startOver";

export default function ActiveInspectionRoute() {
  // Focus is tracked with expo-router's own hook (the app may not import react-navigation directly).
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused ? <ActiveInspectionScreen /> : null;
}

function ActiveInspectionScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const language = i18n.language === "es" ? "es" : "en";
  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  useHotelTimezone();

  const params = useLocalSearchParams<{ roomId?: string | string[]; roomNumber?: string | string[]; from?: string | string[] }>();
  const roomId = normalizeRoomIdParam(params.roomId);
  const labelParam = normalizeRoomIdParam(params.roomNumber);
  const origin = parseOrigin(normalizeRoomIdParam(params.from));

  const hotelId = useAppStore((state) => state.user?.tenant_id ?? null);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const scopeKey = hotelId && userId ? `${hotelId}:${userId}` : null;

  const inspection = useActiveInspection(roomId);
  const { phase, item, template, draft, mode } = inspection;
  const room = item?.roomNumber ?? labelParam ?? "";

  const [sheet, setSheet] = useState<Sheet>(null);
  const [guidanceId, setGuidanceId] = useState<string | null>(null);
  const [failure, setFailure] = useState<null | "save" | "discard" | "resume">(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ uri: string; itemId: string } | null>(null);
  const [pendingChange, setPendingChange] = useState<{ itemId: string; choice: Answer } | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [remotePhoto, setRemotePhoto] = useState<{ uri: string; label: string } | null>(null);
  const leaving = useRef(false);
  const handledFocus = useRef(0);
  const listRef = useRef<FlatList>(null);

  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    router.navigate(originHref(origin, roomId) as never);
  }, [origin, roomId]);

  // Another hotel or person signed in under this screen: nothing of the previous inspection stays on it.
  const firstScope = useRef(scopeKey);
  useEffect(() => {
    if (firstScope.current === scopeKey) return;
    firstScope.current = scopeKey;
    setSheet(null);
    setGuidanceId(null);
    setIssueId(null);
    setViewing(null);
    setPendingChange(null);
    setCorrectionOpen(false);
    leave();
  }, [scopeKey, leave]);

  /* ─── Leaving ─── */
  const requestBack = useCallback(async () => {
    if (sheet !== null || issueId !== null || viewing !== null || pendingChange !== null || correctionOpen) return;
    // While the inspection is being sent, going back would abandon a request in flight: wait for the answer.
    if (inspection.submission.kind === "submitting") return;
    if (inspection.submission.kind === "done" || inspection.submission.kind === "uncertain") return leave();
    if (inspection.submission.kind === "problem") return inspection.dismissProblem();
    if (phase.kind !== "active") return leave();
    if (mode === "review") return inspection.closeReview();
    const verdict = await inspection.requestLeave();
    if (verdict === "leave") leave();
    else {
      setFailure(null);
      setSheet("saveExit");
    }
  }, [sheet, issueId, viewing, pendingChange, correctionOpen, phase.kind, mode, inspection, leave]);

  // Registered once per focus; the handler always calls the latest `requestBack`.
  const requestBackRef = useRef(requestBack);
  requestBackRef.current = requestBack;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        void requestBackRef.current();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  const saveAndExit = useCallback(async () => {
    const ok = await inspection.saveAndExit();
    if (ok) {
      setSheet(null);
      leave();
    } else setFailure("save");
  }, [inspection, leave]);

  const confirmDiscard = useCallback(async () => {
    const ok = await inspection.discard();
    if (ok) {
      setSheet(null);
      leave();
    } else setFailure("discard");
  }, [inspection, leave]);

  const confirmStartOver = useCallback(async () => {
    const ok = await inspection.startOver();
    if (ok) setSheet(null);
    else setFailure("discard");
  }, [inspection]);

  const resume = useCallback(async () => {
    setFailure(null);
    const result = await inspection.resume();
    if (result === "unavailable") setFailure("resume");
  }, [inspection]);

  const review = useCallback(() => {
    const readiness = inspection.openReview();
    if (!readiness) return;
    if (readiness.kind === "unanswered") toast.error(t("inspect.workspace.review.missing", { count: readiness.remaining }));
    else if (readiness.kind === "invalid") {
      toast.error(t(readiness.code === "na_note_required" ? "inspect.workspace.review.naNote" : "inspect.workspace.review.naNotAllowed"));
    } else if (readiness.kind === "no_answers") toast.error(t("inspect.workspace.review.noAnswers"));
  }, [inspection, toast, t]);

  const send = useCallback(async () => {
    const refusal = await inspection.submit();
    if (!refusal) return;
    const reason = refusal === "no_session" || refusal === "not_ready" || refusal === "incomplete" ? "checklist_incomplete" : refusal;
    toast.error(t(`inspect.result.problem.${PROBLEM_REASONS.has(reason) ? reason : "rejected"}`));
  }, [inspection, toast, t]);

  const nextRoom = useCallback(() => {
    const next = inspection.nextRoom();
    if (next) router.replace(inspectionHref(next.roomId, next.roomNumber, "queue") as never);
    else leave();
  }, [inspection, leave]);

  const viewCorrections = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    router.navigate({ pathname: "/(app)/inspect", params: { tab: "corrections" } } as never);
  }, []);

  const viewRoom = useCallback(() => {
    setSheet(null);
    if (roomId) router.navigate({ pathname: "/(app)/room-board", params: { roomId } } as never);
  }, [roomId]);

  /* ─── Derived text ─── */
  const ctx = useMemo(() => ({ timeZone: hotelTimezone, language }), [hotelTimezone, language]);
  const facts = useMemo(() => (item && template ? roomFacts(item, template, ctx, t) : null), [item, template, ctx, t]);
  const progress = useMemo(
    () => (inspection.progress && draft ? progressText(inspection.progress, failedCount(draft.answers), t) : null),
    [inspection.progress, draft, t],
  );
  const recheck = useMemo(() => (item ? itemsToRecheck(item.reinspection) : new Set<string>()), [item]);
  const reviewModel = useMemo(() => (mode === "review" && template && draft ? buildReview(template, draft, inspection.lostPhotos) : null), [mode, template, draft, inspection.lostPhotos]);
  const plan = useMemo(() => (mode === "review" && template && draft && item ? planCorrection(template, draft.answers, item) : null), [mode, template, draft, item]);
  const outcome: "passed" | "failed" = (reviewModel?.failed ?? 0) > 0 ? "failed" : "passed";
  const recheckLines = useMemo<RecheckLine[]>(
    () =>
      mode === "review" && template && draft
        ? inspection.recheckIds.flatMap((id) => {
            const found = template.items.find((candidate) => candidate.id === id);
            return found ? [{ id, label: found.description, standing: recheckStanding(draft.answers, id) }] : [];
          })
        : [],
    [mode, template, draft, inspection.recheckIds],
  );
  const submission = inspection.submission;
  const sending = submission.kind === "submitting";
  const unclassified = reviewModel?.outstanding ?? 0;
  const canSend = Boolean(inspection.evaluation?.canSubmit) && unclassified === 0 && recheckLines.every((line) => line.standing !== "unchecked") && inspection.isOnline && !sending;
  const sendHint = !inspection.isOnline
    ? t("inspect.result.needsConnection")
    : !inspection.evaluation?.canSubmit || unclassified > 0
      ? t("inspect.result.checklistIncomplete")
      : recheckLines.some((line) => line.standing === "unchecked")
        ? t("inspect.result.problem.reinspection_unverified")
        : null;
  const nextAvailable = submission.kind === "done" ? inspection.nextRoom() !== null : false;
  const issueItem = useMemo(() => template?.items.find((candidate) => candidate.id === issueId) ?? null, [template, issueId]);
  const viewingItem = useMemo(() => template?.items.find((candidate) => candidate.id === viewing?.itemId) ?? null, [template, viewing]);
  const guidanceItem = useMemo(() => template?.items.find((candidate) => candidate.id === guidanceId) ?? null, [template, guidanceId]);
  const save = saveText(inspection.save, draft && hasProgress(draft) && inspection.save.status === "idle" ? draft.updatedAt : null, ctx, t);
  const total = template?.items.length ?? 0;
  const answered = draft ? Object.keys(draft.answers).length : 0;

  /* ─── Scrolling to an item the supervisor was sent to ─── */
  const focusNonce = inspection.focus?.nonce;
  useEffect(() => {
    // The checklist is not mounted while the review is showing; a request made from there waits for it.
    if (!inspection.focus || mode !== "checklist" || inspection.focus.nonce === handledFocus.current) return;
    handledFocus.current = inspection.focus.nonce;
    const index = inspection.rows.findIndex((row) => row.kind === "item" && row.item.id === inspection.focus?.itemId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.15, animated: true });
    // Only a new request scrolls; rows changing while answering must not.
  }, [focusNonce, mode]);

  const goToFromReview = useCallback(
    (itemId: string) => {
      inspection.closeReview();
      inspection.goTo(itemId);
    },
    [inspection],
  );

  const confirmChange = useCallback(() => {
    if (!pendingChange) return;
    inspection.answer(pendingChange.itemId, pendingChange.choice, { confirmed: true });
    setPendingChange(null);
  }, [inspection, pendingChange]);

  const renderRow = useCallback(
    ({ item: row }: ListRenderItemInfo<(typeof inspection.rows)[number]>) =>
      row.kind === "section" ? (
        <View style={styles.sectionGap}>
          <SectionHeader summary={row.summary} expanded={row.expanded} t={t} onToggle={inspection.toggleSection} />
        </View>
      ) : (
        <ChecklistItemRow
          item={row.item}
          answer={row.answer}
          failedBefore={recheck.has(row.item.id)}
          policy={NA_POLICY}
          t={t}
          photoUri={draft?.photos[row.item.id] ?? null}
          photoLost={inspection.lostPhotos.has(row.item.id)}
          onAnswer={inspection.answer}
          onNote={inspection.setNote}
          onGuidance={setGuidanceId}
          onEditIssue={setIssueId}
          onConfirmChange={(itemId, choice) => setPendingChange({ itemId, choice })}
          onPhotoUnreadable={inspection.photoUnreadable}
        />
      ),
    // `inspection` changes every render; only the stable callbacks it carries are used.
    [recheck, t, draft?.photos, inspection.lostPhotos, inspection.toggleSection, inspection.answer, inspection.setNote, inspection.photoUnreadable],
  );

  const intro = (
    <View style={styles.intro}>
      {inspection.notice ? (
        <View style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="workspace-notice">
          <Ionicons name="information-circle-outline" size={18} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
            {t(`inspect.workspace.notice.${inspection.notice}`)}
          </Text>
          <Button label={t("common.close")} variant="ghost" size="sm" onPress={inspection.dismissNotice} testID="workspace-notice-close" />
        </View>
      ) : null}
      {facts ? <RoomSummary facts={facts} t={t} /> : null}
      {item?.reinspection.isReinspection && template && draft ? (
        <ReinspectionPanel
          context={item.reinspection}
          template={template}
          answers={draft.answers}
          timeZone={hotelTimezone}
          language={language}
          t={t}
          onGoToItem={inspection.goTo}
          onViewPhoto={(uri, label) => setRemotePhoto({ uri, label })}
        />
      ) : null}
      {progress && inspection.progress ? (
        <ProgressCard text={progress} hasIssues={draft ? failedCount(draft.answers) > 0 : false} hasOpenItems={inspection.progress.answered < inspection.progress.total} t={t} onNext={inspection.goToNext} />
      ) : null}
    </View>
  );

  /* ─── What fills the screen ─── */
  let body: ReactNode;
  let footer: ReactNode = null;
  if (submission.kind === "done") {
    const result = submission.result;
    body = (
      <Pad>
        {result.outcome === "passed" ? (
          <ApprovedView result={result} timeZone={hotelTimezone ?? null} language={language} hasNext={nextAvailable} t={t} onNext={nextRoom} onQueue={leave} />
        ) : (
          <CorrectionRequestedView result={result} busy={false} online={inspection.isOnline} hasNext={nextAvailable} t={t} onNext={nextRoom} onCorrections={viewCorrections} onQueue={leave} onRetry={() => void send()} />
        )}
      </Pad>
    );
  } else if (submission.kind === "uncertain") {
    body = (
      <Pad>
        <UncertainView view={submission} online={inspection.isOnline} t={t} onCheck={() => void inspection.checkSubmission()} onSendAgain={() => void send()} onQueue={leave} />
      </Pad>
    );
  } else if (phase.kind === "loading") {
    body = <WorkspaceLoading t={t} />;
  } else if (phase.kind === "unavailable") {
    body = (
      <Pad>
        <UnavailableView reason={phase.reason} t={t} onBack={leave} onRetry={phase.reason === "read_failed" ? inspection.retryRead : inspection.retry} onContinueWithoutDraft={inspection.continueWithoutDraft} />
      </Pad>
    );
  } else if (phase.kind === "blocked") {
    body = (
      <Pad>
        {facts ? <RoomSummary facts={facts} t={t} /> : null}
        <BlockedView issue={phase.issue} room={room} t={t} onBack={leave} onViewRoom={viewRoom} />
      </Pad>
    );
  } else if (phase.kind === "template_changed") {
    body = (
      <Pad>
        {facts ? <RoomSummary facts={facts} t={t} /> : null}
        <TemplateChangedView plan={phase.plan} busy={inspection.busy} t={t} onKeep={() => void inspection.applyCarryOver()} onStartOver={() => { setFailure(null); setSheet("startOver"); }} onBack={leave} />
      </Pad>
    );
  } else if (phase.kind === "resume") {
    body = <Pad>{facts ? <RoomSummary facts={facts} t={t} /> : null}</Pad>;
  } else if (mode === "review" && reviewModel) {
    body = (
      <Pad>
        {submission.kind === "problem" ? (
          <ProblemBanner view={submission} retryable={submission.reason === "evidence_upload_failed"} t={t} onBack={inspection.dismissProblem} onRetry={() => void send()} />
        ) : null}
        <ReviewView
          model={reviewModel}
          plan={plan}
          room={room}
          outcome={outcome}
          notes={inspection.notes}
          notesEditable={!sending}
          recheck={recheckLines}
          t={t}
          onNotes={inspection.setNotes}
          onGoToItem={goToFromReview}
          onOpenCorrection={() => setCorrectionOpen(true)}
        />
      </Pad>
    );
    footer = (
      <WorkspaceFooter
        saveText={save.text}
        saveTone={save.tone}
        offline={!inspection.isOnline}
        primaryLabel={t(outcome === "passed" ? "inspect.result.approveRoom" : "inspect.result.submitCorrection")}
        primaryIcon={outcome === "passed" ? "checkmark" : "send"}
        primaryLoading={sending}
        primaryDisabled={!canSend || submission.kind === "problem"}
        hint={submission.kind === "problem" ? null : sendHint}
        onPrimary={() => void send()}
        secondaryLabel={t("inspect.workspace.reviewScreen.back")}
        onSecondary={inspection.closeReview}
        onRetrySave={() => void inspection.retrySave()}
        bottomInset={insets.bottom}
        t={t}
        primaryTestID="workspace-submit"
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={inspection.rows}
        extraData={inspection.lostPhotos}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ListHeaderComponent={intro}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={9}
        onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index - 80), animated: true })}
        testID="workspace-list"
      />
    );
    footer = (
      <WorkspaceFooter saveText={save.text} saveTone={save.tone} offline={!inspection.isOnline} primaryLabel={t("inspect.workspace.review.cta")} primaryIcon="arrow-forward" onPrimary={review} onRetrySave={() => void inspection.retrySave()} bottomInset={insets.bottom} t={t} />
    );
  }

  const reviewedText = reviewedLine(phase.kind === "resume" ? Object.keys(phase.stored.answers).length : answered, total, t);
  const savedAt = phase.kind === "resume" ? formatHotelTime(new Date(phase.stored.updatedAt), hotelTimezone, language) : null;

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="workspace-screen">
      <WorkspaceHeader
        title={t("inspect.workspace.title", { room })}
        topInset={insets.top}
        t={t}
        onBack={() => void requestBack()}
        onMore={phase.kind === "active" ? () => setSheet("more") : undefined}
      />
      <View style={styles.flex}>{body}</View>
      {footer}

      <MoreSheet visible={sheet === "more"} t={t} onClose={() => setSheet(null)} onContext={() => setSheet("context")} onSaveExit={() => { setFailure(null); setSheet("saveExit"); }} />
      {item && scopeKey ? (
        <ContextSheet visible={sheet === "context"} item={item} scopeKey={scopeKey} timeZone={hotelTimezone} language={language} now={inspection.queue.now} t={t} onClose={() => setSheet(null)} onViewRoom={() => viewRoom()} />
      ) : null}
      <SaveExitSheet
        visible={sheet === "saveExit"}
        room={room}
        reviewed={reviewedText}
        failed={failure === "save"}
        busy={inspection.busy}
        t={t}
        onKeep={() => {
          inspection.keepInspecting();
          setSheet(null);
        }}
        onSave={() => void saveAndExit()}
        onDiscard={() => { setFailure(null); setSheet("discard"); }}
        onExitUnsaved={leave}
      />
      <DiscardSheet visible={sheet === "discard"} room={room} busy={inspection.busy} failed={failure === "discard"} t={t} onKeep={() => setSheet("saveExit")} onDiscard={() => void confirmDiscard()} />
      <ResumeSheet
        visible={phase.kind === "resume" && sheet !== "startOver"}
        room={room}
        reviewed={reviewedText}
        savedAt={savedAt ? t("inspect.workspace.resume.lastSaved", { time: savedAt }) : null}
        busy={inspection.busy}
        error={failure === "resume"}
        t={t}
        onResume={() => void resume()}
        onStartOver={() => { setFailure(null); setSheet("startOver"); }}
        onLeave={leave}
      />
      <StartOverSheet
        visible={sheet === "startOver"}
        room={room}
        count={phase.kind === "resume" ? Object.keys(phase.stored.answers).length : phase.kind === "template_changed" ? phase.plan.carried + phase.plan.dropped : answered}
        busy={inspection.busy}
        failed={failure === "discard"}
        t={t}
        onKeep={() => setSheet(null)}
        onConfirm={() => void confirmStartOver()}
      />
      <GuidanceSheet item={guidanceItem} policy={NA_POLICY} t={t} onClose={() => setGuidanceId(null)} />
      <IssueSheet
        item={phase.kind === "active" && issueItem && draft?.answers[issueItem.id]?.result === "fail" ? issueItem : null}
        room={room}
        answer={issueItem && draft ? draft.answers[issueItem.id] : undefined}
        photoUri={issueItem && draft ? (draft.photos[issueItem.id] ?? null) : null}
        photoLost={issueItem ? inspection.lostPhotos.has(issueItem.id) : false}
        hidden={viewing !== null}
        t={t}
        onSave={inspection.saveIssue}
        onCapture={inspection.capturePhoto}
        onDiscardCapture={inspection.discardCapture}
        onUnreadable={inspection.photoUnreadable}
        onView={(uri) => issueItem && setViewing({ uri, itemId: issueItem.id })}
        onClose={() => setIssueId(null)}
      />
      <PhotoViewer uri={remotePhoto?.uri ?? null} label={remotePhoto?.label ?? ""} t={t} onClose={() => setRemotePhoto(null)} />
      <PhotoViewer uri={viewing?.uri ?? null} label={viewingItem?.description ?? ""} t={t} onClose={() => setViewing(null)} />
      <ChangeAnswerSheet visible={pendingChange !== null} busy={false} t={t} onKeep={() => setPendingChange(null)} onConfirm={confirmChange} />
      <CorrectionSheet plan={correctionOpen ? plan : null} t={t} onClose={() => setCorrectionOpen(false)} />
    </KeyboardAvoidingView>
  );
}

function Pad({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  intro: { gap: 10, marginBottom: 12 },
  pad: { padding: 16, gap: 12 },
  separator: { height: 8 },
  sectionGap: { marginTop: 8 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: R.md, padding: 10 },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
