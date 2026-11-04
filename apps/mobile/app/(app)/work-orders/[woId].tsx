import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { enqueueAction } from "@/lib/offline/db";
import { useAppStore } from "@/stores/appStore";
import {
  acknowledgeWorkOrder,
  addWorkOrderComment,
  arriveAtWorkOrder,
  claimWorkOrder,
  completeWorkOrder,
  pauseWorkOrderLabor,
  saveDiagnosis,
  startWorkOrderLabor,
  transitionWorkOrder,
  uploadWorkOrderPhoto,
  type DiagnosisPayload,
} from "@/lib/api/workOrders";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import { useSecondTicker, useWorkOrderDetail } from "@/lib/engineering/useWorkOrderDetail";
import { useCompletionDraft } from "@/lib/engineering/useWorkOrderDrafts";
import { isActionAlreadyQueued } from "@/lib/engineering/queuedActions";
import {
  buildCompletionBody,
  buildTimeline,
  deriveRepairActions,
  formatStopwatch,
  interpretCompletionError,
  offlineCompletionBlock,
  summarizeLabor,
  type CompletionOutcome,
  type PhotoType,
  type StagedPart,
} from "@/lib/engineering/repairWorkspace";
import { formatDuration, type HoldReasonCode, type WorkOrder } from "@/lib/engineering/workOrders";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { StateBlock } from "@/components/ui/StateBlock";
import { Button } from "@/components/ui/Button";
import { useAiCapability } from "@/lib/ai/capabilities";
import { canOfferAssist } from "@/lib/engineering/repairAssist";
import { canManageTeam, isAssignable, teamScope } from "@/lib/engineering/teamModel";
import { RepairAssistSheet } from "@/components/engineering/workorder/RepairAssistSheet";
import { AssignTechnicianSheet } from "@/components/engineering/team/AssignTechnicianSheet";
import { WorkOrderHeader, WorkOrderSummary } from "@/components/engineering/workorder/WorkOrderHeader";
import { WorkOrderActionBar, type BarAction } from "@/components/engineering/workorder/WorkOrderActionBar";
import { WorkOrderReportedIssue } from "@/components/engineering/workorder/WorkOrderReportedIssue";
import { WorkOrderAssetContext } from "@/components/engineering/workorder/WorkOrderAssetContext";
import { WorkOrderPmSource } from "@/components/engineering/workorder/WorkOrderPmSource";
import { WorkOrderRepairTools, type ToolId } from "@/components/engineering/workorder/WorkOrderRepairTools";
import { WorkOrderTabs, type DetailTab } from "@/components/engineering/workorder/WorkOrderTabs";
import { WorkOrderProgress } from "@/components/engineering/workorder/WorkOrderProgress";
import { WorkOrderNextAction } from "@/components/engineering/workorder/WorkOrderNextAction";
import { WorkOrderChecklist } from "@/components/engineering/workorder/WorkOrderChecklist";
import { useWorkOrderChecklist } from "@/lib/engineering/useWorkOrderChecklist";
import { checklistEditing, checklistGate } from "@/lib/engineering/workOrderChecklist";
import { deriveNextStep, deriveRepairProgress } from "@/lib/engineering/repairProgress";
import { WorkOrderActivityTimeline } from "@/components/engineering/workorder/WorkOrderActivityTimeline";
import { WorkOrderRecordCard } from "@/components/engineering/workorder/WorkOrderRecordCard";
import { WorkOrderCompletionResult, type CompletionSummary } from "@/components/engineering/workorder/WorkOrderCompletionResult";
import { MoreActionsSheet, type MoreAction } from "@/components/engineering/workorder/MoreActionsSheet";
import { LaborSheet } from "@/components/engineering/workorder/LaborSheet";
import { DiagnosisSheet } from "@/components/engineering/workorder/DiagnosisSheet";
import { EvidenceSheet } from "@/components/engineering/workorder/EvidenceSheet";
import { PartsSheet } from "@/components/engineering/workorder/PartsSheet";
import { HoldSheet } from "@/components/engineering/workorder/HoldSheet";
import { EscalationSheet } from "@/components/engineering/workorder/EscalationSheet";
import { NoteSheet } from "@/components/engineering/workorder/NoteSheet";
import { CompletionSheet } from "@/components/engineering/workorder/CompletionSheet";

/* ─── Work-order detail — the repair workspace ──────────────────────────────
   One screen, many sheets. Everything shown is a server record: arrival, labor sessions, diagnosis, evidence,
   parts and history. Actions follow the API's state machine (see deriveRepairActions).

   Offline: claim and a plain completion queue (the existing sync); every other action needs a connection, because
   a labor session, arrival or inventory movement made offline would be a record the server never confirmed. */

type Sheet = "more" | "labor" | "diagnosis" | "evidence" | "parts" | "hold" | "escalate" | "note" | "complete" | "assist" | "assign" | null;

export default function WorkOrderDetailScreen() {
  const { woId } = useLocalSearchParams<{ woId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const { isOnline, user } = useAppStore();
  const locale = user?.language_pref === "es" ? "es" : "en";
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const userId = user?.id ?? null;

  const detail = useWorkOrderDetail(String(woId), userId);
  const checklist = useWorkOrderChecklist(String(woId));
  const assistSwitchedOn = useAiCapability("repairAssist");
  const { wo, secondary, sectionFailed, queued, skewMs } = detail;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const draftState = useCompletionDraft(String(woId), wo, wo ? workOrderLabel(wo) : null);
  const { draft, editDraft, restored } = draftState;
  const [result, setResult] = useState<CompletionSummary | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");

  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // A status change (completed, put on hold, reopened) changes whether the checklist is editable: re-read it.
  const lastStatus = useRef<string | null>(null);
  const status = wo?.status ?? null;
  const refreshChecklist = checklist.refresh;
  useEffect(() => {
    if (status && lastStatus.current && lastStatus.current !== status) void refreshChecklist();
    lastStatus.current = status;
  }, [status, refreshChecklist]);

  // Room context is the server's own lookup (the room board's rule, room-board roles only): absent or "unknown" shows nothing.
  const roomContext = wo?.room_context ?? null;
  const occupancy = roomContext?.occupancy === "occupied" || roomContext?.occupancy === "vacant" ? roomContext.occupancy : null;
  const availability = roomContext?.availability ?? null;

  const actions = useMemo(
    () => (wo ? deriveRepairActions({ wo, role, userId, sessions: secondary.labor }) : null),
    [wo, role, userId, secondary.labor]
  );
  const running = secondary.labor.some((s) => s.ended_at == null);
  const nowMs = useSecondTicker(running);
  const labor = useMemo(() => summarizeLabor(secondary.labor, userId, nowMs, skewMs), [secondary.labor, userId, nowMs, skewMs]);
  const timeline = useMemo(
    () =>
      wo
        ? buildTimeline({ timing: secondary.timing, audit: secondary.audit, comments: wo.work_order_comments ?? [], photos: wo.work_order_photos ?? [], createdAt: wo.created_at, viewerId: userId })
        : [],
    [wo, secondary.timing, secondary.audit, userId]
  );

  /** One mutation at a time. The ref is the guard (a second tap in the same tick sees it); state only drives the UI. */
  const mutate = useCallback(
    async (key: string, task: () => Promise<void>, fallback: string): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = key;
      setBusy(key);
      try {
        await task();
        return true;
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : fallback);
        return false;
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [toast]
  );

  if (detail.loading && !wo) {
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }
  if (!wo || !actions) {
    return (
      <StateBlock
        status="error"
        errorIcon={detail.failure === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
        errorMessage={t(detail.failure === "forbidden" ? "workOrders.repair.errorForbidden" : "workOrders.errorLoad")}
        onRetry={detail.failure === "forbidden" ? () => router.back() : () => void detail.refresh()}
        retryLabel={detail.failure === "forbidden" ? t("common.back") : t("common.retry")}
        style={[styles.center, { backgroundColor: theme.background }]}
      />
    );
  }

  const order: WorkOrder = wo;
  const technicianName = order.assigned_to_name ?? (order.assigned_to && order.assigned_to === userId ? user?.full_name ?? null : null);
  const photos = order.work_order_photos ?? [];
  const label = workOrderLabel(order);
  const closed = actions.block === "closed";
  const myRunning = labor.activeIsMine;

  const openSync = () => router.push("/(app)/engineering-sync" as never);
  const refreshAfter = (sections: Parameters<typeof detail.refresh>[0], opts?: Parameters<typeof detail.refresh>[1]) => detail.refresh(sections, opts);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  async function claim() {
    if (isOnline) {
      await mutate("claim", async () => {
        await claimWorkOrder(order.id);
        await refreshAfter(["labor", "history"]);
        toast.success(t("workOrders.repair.toast.claimed"));
      }, t("workOrders.alerts.claimFailed"));
      return;
    }
    // Offline: the existing queue keeps the claim; the order is NOT shown as claimed until the server confirms.
    await mutate("claim", async () => {
      // One intentional claim = one queued row, even across a restart or a second tap.
      if (queued.claim || (await isActionAlreadyQueued(order.id, "claim"))) {
        toast.info(t("workOrders.repair.toast.claimAlreadyQueued"));
        return;
      }
      await enqueueAction("work_order", "claim", { label }, order.id, label);
      toast.info(t("workOrders.repair.toast.claimQueued"));
      await refreshAfter([]);
    }, t("workOrders.alerts.claimFailed"));
  }

  async function startRepair() {
    await mutate("start", async () => {
      await startWorkOrderLabor(order.id);
      await refreshAfter(["labor", "history"], { startedLabor: true });
    }, t("workOrders.repair.toast.startFailed"));
  }

  async function startLabor() {
    await mutate("startLabor", async () => {
      await startWorkOrderLabor(order.id);
      await refreshAfter(["labor", "history"], { startedLabor: true });
    }, t("workOrders.repair.toast.laborFailed"));
  }

  async function pauseLabor() {
    await mutate("pauseLabor", async () => {
      await pauseWorkOrderLabor(order.id);
      await refreshAfter(["labor", "history"]);
    }, t("workOrders.repair.toast.laborFailed"));
  }

  async function resumeWork() {
    await mutate("resumeWork", async () => {
      await transitionWorkOrder(order.id, { status: "in_progress" });
      await refreshAfter(["labor", "history"]);
    }, t("workOrders.alerts.setStatusFailed"));
  }

  async function arrive() {
    await mutate("arrive", async () => {
      await arriveAtWorkOrder(order.id);
      await refreshAfter(["history"]);
    }, t("workOrders.alerts.arriveFailed"));
  }

  async function acknowledge() {
    await mutate("acknowledge", async () => {
      await acknowledgeWorkOrder(order.id);
      await refreshAfter(["history"]);
    }, t("workOrders.repair.toast.ackFailed"));
  }

  /** Sheets throw so they can show the error beside the field; they run inside `mutate`'s guard via this wrapper. */
  async function guarded(key: string, task: () => Promise<void>) {
    if (busyRef.current) throw new Error(t("workOrders.repair.toast.busy"));
    busyRef.current = key;
    setBusy(key);
    try {
      await task();
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  const holdWork = (input: { reason: HoldReasonCode; note: string; pauseLabor: boolean }) =>
    guarded("hold", async () => {
      // Holding does not stop labor on the server, so a pause is its own request, sent first.
      if (input.pauseLabor) await pauseWorkOrderLabor(order.id);
      try {
        await transitionWorkOrder(order.id, { status: "on_hold", reason_code: input.reason, reason_note: input.note || undefined });
      } finally {
        await refreshAfter(["labor", "history"]);
      }
    });

  const escalate = (note: string) =>
    guarded("escalate", async () => {
      await transitionWorkOrder(order.id, { status: "escalated", reason_note: note });
      await refreshAfter(["history"]);
    });

  const addNote = (text: string) =>
    guarded("note", async () => {
      const created = await addWorkOrderComment(order.id, text);
      if (created) detail.setOrder({ ...order, work_order_comments: [...(order.work_order_comments ?? []), created] });
      else await refreshAfter([]);
    });

  const saveCoding = (payload: DiagnosisPayload) =>
    guarded("diagnosis", async () => {
      await saveDiagnosis(order.id, payload);
      await refreshAfter(["history"]);
      toast.success(t("workOrders.repair.toast.diagnosisSaved"));
    });

  const attachPhoto = (input: { uri: string; photoType: PhotoType; caption: string; signal: AbortSignal }) =>
    guarded("evidence", async () => {
      const photo = await uploadWorkOrderPhoto(order.id, input.uri, { photoType: input.photoType, caption: input.caption, signal: input.signal });
      if (photo) detail.setOrder({ ...order, work_order_photos: [...(order.work_order_photos ?? []), photo] });
      toast.success(t("workOrders.repair.toast.photoAttached"));
    });

  /** Confirm Completion. Returns what happened; only a server-confirmed `completed` shows the success view. */
  async function submitCompletion(): Promise<CompletionOutcome> {
    const body = buildCompletionBody(draft, { hasAsset: Boolean(order.asset_id || order.assets?.id) });
    if (!isOnline) {
      // Queued completions skip the server's checklist check until replay, so only a confirmed-clear checklist may queue.
      const block = offlineCompletionBlock(draft, checklistGate(checklist.load));
      if (block != null) return { kind: "failed", message: t(`workOrders.repair.complete.offlineBlock.${block}`) };
      if (busyRef.current) return { kind: "failed", message: t("workOrders.repair.toast.busy") };
      busyRef.current = "complete";
      try {
        // A second tap, or a completion already waiting from before a restart, must not queue a second copy.
        if (queued.complete || (await isActionAlreadyQueued(order.id, "complete"))) {
          return { kind: "failed", message: t("workOrders.repair.complete.alreadyQueued") };
        }
        await enqueueAction("work_order", "complete", body, order.id, label);
      } finally {
        busyRef.current = null;
      }
      // The draft stays: this is only saved on the phone, and it is removed once the server confirms the completion.
      toast.info(t("workOrders.repair.complete.queued"));
      await refreshAfter([]);
      return { kind: "queued" };
    }
    if (busyRef.current) return { kind: "failed", message: t("workOrders.repair.toast.busy") };
    busyRef.current = "complete";
    setBusy("complete");
    try {
      await completeWorkOrder(order.id, body);
      const summary: CompletionSummary = {
        title: order.title,
        room: order.rooms?.room_number ?? null,
        verification: draft.verification,
        laborMinutes: labor.totalMinutes,
        partsCount: draft.parts.length,
        photoCount: photos.length,
        assetRestored: draft.assetRestoration === "restore",
      };
      setResult(summary);
      draftState.confirmed();
      await refreshAfter(["labor", "history", "parts"]);
      return { kind: "completed", followUpRequired: draft.verification === "follow_up_required" };
    } catch (err) {
      const outcome = interpretCompletionError(err, draft);
      if (outcome.kind === "rejected" && outcome.errors.checklist) void checklist.refresh();
      // The server may have recorded a failed test or changed the order under us: re-read so the screen tells the truth.
      await refreshAfter(["history"]);
      return outcome;
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  /** Review Completion reads the checklist again first, so it never judges readiness from an old read. */
  const openCompletion = () => {
    void checklist.refresh();
    setSheet("complete");
  };

  const onBar = (action: BarAction) => {
    if (action === "claim") void claim();
    else if (action === "start") void startRepair();
    else if (action === "resumeWork") void resumeWork();
    else if (action === "pauseLabor") void pauseLabor();
    else if (action === "startLabor") void startLabor();
    else if (action === "complete") openCompletion();
    else if (action === "hold") setSheet("hold");
  };

  const onTool = (tool: ToolId) => {
    if (tool === "arrive") void arrive();
    else if (tool === "acknowledge") void acknowledge();
    else if (tool === "resumeWork") void resumeWork();
    else if (tool === "assist") setSheet("assist");
    else setSheet(tool);
  };

  const onMore = (action: MoreAction) => {
    if (action === "resumeWork") {
      setSheet(null);
      void resumeWork();
    } else setSheet(action);
  };

  const laborLabel = labor.active ? formatStopwatch(labor.activeSeconds) : labor.recordedMinutes > 0 ? formatDuration(Math.round(labor.recordedMinutes)) : t("workOrders.repair.summary.noLabor");
  const showBar = actions.primary != null && !result;
  const manageable = canManageTeam(role) && isAssignable(order) && !result;
  const assistable = canOfferAssist({ capability: assistSwitchedOn, status: order.status, role }) && !result;
  const heldBanner = order.status === "on_hold";
  const editing = checklistEditing({
    actions,
    role,
    online: isOnline,
    snapshotEditable: checklist.load.phase !== "ready" || checklist.load.snapshot.editable,
  });
  const progress = deriveRepairProgress(order);
  const nextStep = deriveNextStep(order, actions);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <WorkOrderHeader wo={order} onBack={() => (router.canGoBack() ? router.back() : router.replace("/(app)/work-orders" as never))} onMore={closed || actions.block === "viewOnly" ? null : () => setSheet("more")} />

      {!result ? (
        <View style={styles.tabs}>
          <WorkOrderTabs value={tab} onChange={setTab} />
        </View>
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, showBar && styles.withBar]} keyboardShouldPersistTaps="handled">
        {result ? (
          <WorkOrderCompletionResult
            summary={result}
            onViewRecord={() => setResult(null)}
            onBack={() => (router.canGoBack() ? router.back() : router.replace("/(app)/work-orders"))}
          />
        ) : (
          <>
            {queued.complete ? <Banner icon="time-outline" tone="warn" text={t("workOrders.repair.banner.completeQueued")} testID="wo-banner-complete-queued" action={{ label: t("workOrders.repair.banner.viewSync"), onPress: openSync }} /> : null}
            {queued.claim ? <Banner icon="time-outline" tone="warn" text={t("workOrders.repair.banner.claimQueued")} testID="wo-banner-claim-queued" action={{ label: t("workOrders.repair.banner.viewSync"), onPress: openSync }} /> : null}
            {!isOnline ? <Banner icon="cloud-offline-outline" text={t("workOrders.repair.banner.offline")} testID="wo-banner-offline" /> : null}
            {detail.cachedAt ? <Banner icon="albums-outline" tone="warn" text={t("workOrders.repair.banner.cached", { time: new Date(detail.cachedAt).toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }) })} testID="wo-banner-cached" /> : null}
            {restored && !result ? (
              <Banner
                icon="document-text-outline"
                tone="warn"
                text={`${t("workOrders.repair.banner.draftRestored", { time: new Date(restored.savedAt).toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }) })}${restored.review !== "none" ? ` ${t(`workOrders.repair.banner.draftReview.${restored.review}`)}` : ""}`}
                testID="wo-banner-draft"
                action={
                  confirmingDiscard
                    ? { label: t("workOrders.repair.banner.draftDiscardConfirm"), onPress: () => (setConfirmingDiscard(false), draftState.discard()), testID: "wo-draft-discard-confirm" }
                    : { label: t("workOrders.repair.banner.draftDiscard"), onPress: () => setConfirmingDiscard(true), testID: "wo-draft-discard" }
                }
              />
            ) : null}
            {actions.block === "viewOnly" ? <Banner icon="eye-outline" text={t("workOrders.viewOnly")} testID="wo-view-only" /> : null}
            {actions.block === "claimedElsewhere" ? <Banner icon="information-circle-outline" text={t("workOrders.claimedElsewhere")} /> : null}
            {heldBanner ? (
              <Banner
                icon="pause-circle-outline"
                tone="warn"
                text={`${t("workOrders.repair.banner.onHold")}${order.hold_reason_code ? ` · ${t(`workOrders.holdReason.${order.hold_reason_code}`, { defaultValue: "" })}` : ""}${order.hold_reason_note ? ` — ${order.hold_reason_note}` : ""}`}
                testID="wo-banner-hold"
              />
            ) : null}
            {order.status === "escalated" ? <Banner icon="alert-circle-outline" tone="warn" text={t("workOrders.repair.banner.escalated")} testID="wo-banner-escalated" /> : null}
            {order.status === "cancelled" ? <Banner icon="close-circle-outline" text={t("workOrders.repair.banner.cancelled")} testID="wo-banner-cancelled" /> : null}

            {tab === "overview" ? (
              <>
                <WorkOrderProgress progress={progress} />
                <WorkOrderNextAction step={nextStep} barVisible={showBar} />
                <WorkOrderSummary wo={order} locale={locale} labor={labor} laborFailed={!!sectionFailed.labor} nowMs={nowMs} onOpenLabor={() => (setTab("work"), setSheet("labor"))} />
                {manageable ? (
                  <View style={styles.extras}>
                    <Button
                      label={order.assigned_to ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}
                      variant="secondary"
                      size="sm"
                      icon="person-add-outline"
                      onPress={() => setSheet("assign")}
                      disabled={!isOnline}
                      testID="wo-assign-open"
                    />
                  </View>
                ) : null}
                <WorkOrderReportedIssue wo={order} locale={locale} occupancy={occupancy} availability={availability} technicianName={technicianName} />
                <WorkOrderPmSource wo={order} language={locale} timezone={hotelTimezone} />
                <WorkOrderAssetContext wo={order} related={secondary.related} relatedFailed={!!sectionFailed.related} locale={locale} variant="summary" />
                {order.status === "completed" ? <WorkOrderRecordCard wo={order} labor={labor} consumed={secondary.parts} /> : null}
              </>
            ) : null}

            {tab === "checklist" ? (
              <WorkOrderChecklist
                load={checklist.load}
                pending={checklist.pending}
                itemErrors={checklist.itemErrors}
                stale={checklist.stale}
                canEdit={editing.canEdit}
                readOnlyReason={editing.reason}
                locale={locale}
                onToggle={(itemId, next) => void checklist.setDone(itemId, next)}
                onRetry={() => void checklist.refresh()}
                onReviewCompletion={actions.can.complete ? openCompletion : null}
              />
            ) : null}

            {tab === "work" ? (
              <WorkOrderRepairTools
                wo={order}
                actions={actions}
                locale={locale}
                online={isOnline}
                busy={busy}
                laborLabel={laborLabel}
                photoCount={photos.length}
                partsCount={secondary.parts.length + draft.parts.length}
                noteCount={(order.work_order_comments ?? []).length}
                assistable={assistable}
                onTool={onTool}
              />
            ) : null}

            {tab === "history" ? (
              <>
                <WorkOrderActivityTimeline items={timeline} locale={locale} failed={!!sectionFailed.history} />
                <WorkOrderAssetContext wo={order} related={secondary.related} relatedFailed={!!sectionFailed.related} locale={locale} variant="history" />
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {showBar ? <WorkOrderActionBar actions={actions} online={isOnline} busy={busy} laborRunning={myRunning} onAction={onBar} bottomInset={insets.bottom} /> : null}

      <MoreActionsSheet visible={sheet === "more"} onClose={() => setSheet(null)} actions={actions} online={isOnline} onPick={onMore} />
      <LaborSheet
        visible={sheet === "labor"}
        onClose={() => setSheet(null)}
        online={isOnline}
        locale={locale}
        userId={userId}
        sessions={secondary.labor}
        summary={labor}
        canStart={actions.can.startLabor && !myRunning}
        canPause={actions.can.pauseLabor}
        startVerb={actions.laborVerb}
        failedToLoad={!!sectionFailed.labor}
        onStart={async () => {
          await guarded("startLabor", async () => {
            await startWorkOrderLabor(order.id);
            await refreshAfter(["labor", "history"], { startedLabor: true });
          });
        }}
        onPause={async () => {
          await guarded("pauseLabor", async () => {
            await pauseWorkOrderLabor(order.id);
            await refreshAfter(["labor", "history"]);
          });
        }}
      />
      <DiagnosisSheet visible={sheet === "diagnosis"} onClose={() => setSheet(null)} online={isOnline} wo={order} onSave={saveCoding} />
      <EvidenceSheet visible={sheet === "evidence"} onClose={() => setSheet(null)} online={isOnline} canAdd={actions.can.evidence} photos={photos} onAttach={attachPhoto} />
      <PartsSheet
        visible={sheet === "parts"}
        onClose={() => setSheet(null)}
        online={isOnline}
        parts={draft.parts}
        freeText={draft.freeTextParts}
        recorded={secondary.parts}
        canEdit={actions.can.parts}
        onChange={(next: { parts: StagedPart[]; freeText: string }) => editDraft((d) => ({ ...d, parts: next.parts, freeTextParts: next.freeText }))}
      />
      <HoldSheet visible={sheet === "hold"} onClose={() => setSheet(null)} online={isOnline} label={label} workOrderId={order.id} laborRunning={myRunning} onConfirm={holdWork} />
      <EscalationSheet visible={sheet === "escalate"} onClose={() => setSheet(null)} online={isOnline} wo={order} onConfirm={escalate} />
      <AssignTechnicianSheet
        visible={sheet === "assign"}
        onClose={() => setSheet(null)}
        scope={teamScope(user)}
        online={isOnline}
        target={{ id: order.id, code: label, title: order.title, priority: order.priority, assignedTo: order.assigned_to ?? null, assignedToName: order.assigned_to_name }}
        onNeedsRefresh={() => void refreshAfter(["history"])}
        onAssigned={(tech, changed) => {
          toast.success(changed ? t("engineeringTeam.assign.done", { name: tech.name ?? t("engineeringTeam.technician") }) : t("engineeringTeam.assign.alreadyDone"));
          void refreshAfter(["history"]);
        }}
      />
      <RepairAssistSheet
        visible={sheet === "assist"}
        onClose={() => setSheet(null)}
        workOrderId={order.id}
        online={isOnline}
        language={locale}
        technicianNotes={draft.notes}
        onUseInCompletion={(text) => {
          editDraft((d) => ({ ...d, notes: text }));
          toast.info(t("repairAssist.addedToCompletion"));
        }}
        onSaveAsNote={addNote}
      />
      <NoteSheet visible={sheet === "note"} onClose={() => setSheet(null)} online={isOnline} workOrderId={order.id} onSave={addNote} />
      <CompletionSheet
        visible={sheet === "complete"}
        onClose={() => setSheet(null)}
        online={isOnline}
        wo={order}
        technicianName={technicianName}
        labor={labor}
        laborFailed={!!sectionFailed.labor}
        photoCount={photos.length}
        checklist={checklist.load}
        onViewChecklist={() => (setSheet(null), setTab("checklist"))}
        draft={draft}
        onDraft={editDraft}
        onEditParts={() => setSheet("parts")}
        onSubmit={submitCompletion}
      />
    </View>
  );
}

function Banner({ icon, text, tone = "muted", testID, action }: { icon: ComponentProps<typeof Ionicons>["name"]; text: string; tone?: "muted" | "warn"; testID?: string; action?: { label: string; onPress: () => void; testID?: string } }) {
  const theme = useTheme();
  const color = tone === "warn" ? theme.status.pickup : theme.textMuted;
  return (
    <View style={styles.banner} testID={testID} accessibilityLiveRegion="polite">
      <Ionicons name={icon} size={16} color={color} />
      <Text style={{ flex: 1, color, fontSize: 13, lineHeight: 18 }}>{text}</Text>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={8} style={styles.bannerAction} testID={action.testID}>
          <Text style={{ color: theme.primaryAction, fontSize: 13, fontWeight: "700" }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 16 },
  withBar: { paddingBottom: 150 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bannerAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  tabs: { paddingHorizontal: 18, paddingTop: 12 },
  extras: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
