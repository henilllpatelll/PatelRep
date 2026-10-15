import { useCallback, useEffect, useRef, useState } from "react";
import { CompletedShiftSummarySheet } from "@/components/home/CompletedShiftSummarySheet";
import { FinishShiftReviewSheet, type ClockOutError } from "@/components/home/FinishShiftReviewSheet";
import { MarkCleanConfirmationSheet } from "@/components/home/MarkCleanConfirmationSheet";
import { ShiftBriefingSheet } from "@/components/home/ShiftBriefingSheet";
import { SyncStatusSheet } from "@/components/home/SyncStatusSheet";
import type { HomeSheetState } from "@/components/home/useHomeSheet";
import {
  buildBriefingFromModel,
  buildBriefingPlan,
  reconcileBriefing,
  restrictedRoomNumbers,
} from "@/lib/housekeeping/homeBriefing";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { buildShiftReview, type ReviewItem } from "@/lib/housekeeping/shiftReview";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import { buildSyncStatusView } from "@/lib/housekeeping/syncStatus";
import { useReviewExtras } from "@/lib/housekeeping/useReviewExtras";
import type { BriefingController } from "@/lib/housekeeping/useShiftBriefing";
import type { ShiftController } from "@/lib/housekeeping/useShiftLifecycle";
import type { RecapController } from "@/lib/housekeeping/useShiftRecap";
import type { SyncRunController } from "@/lib/housekeeping/useSyncRun";
import { useToast } from "@/lib/theme/useToast";

/** Where the Phase 4 drawers send the person. Every destination already exists elsewhere in the app. */
export interface HomeServiceGo {
  openRoom: (roomId: string) => void;
  openWorkOrder: (workOrderId: string) => void;
  openTasks: () => void;
  openLostFound: () => void;
  /** The existing Copilot (never a second chat). */
  openCopilot: () => void;
}

interface Props {
  model: HomeModel;
  sheet: HomeSheetState | null;
  visible: boolean;
  /** Changes on every open; see useHomeSheet. */
  epoch: number;
  onClose: () => void;
  /** Open (or swap to) another drawer. */
  onOpenSheet: (next: HomeSheetState) => void;
  isOnline: boolean;
  language: string;
  userId: string | undefined;
  lastSyncedAt: string | null;
  t: Translate;
  ctx: TextContext;
  go: HomeServiceGo;
  shift: ShiftController;
  briefing: BriefingController;
  recap: RecapController;
  syncRun: SyncRunController;
  /** The server confirmed a room's completion. */
  onRoomConfirmed: (roomId: string) => void;
}

/**
 * The drawers that finish the shift: Mark Clean, Finish Shift review, the
 * completed-shift summary, Sync Status and the shift briefing. Like the Phase 3
 * drawers they are drawn from the live HomeModel on every render, only one is
 * open at a time, and any navigation closes the drawer first. Nothing here is
 * automatic: clock-out, a sync retry and an AI request each need a tap.
 */
export function HomeServiceSheets({
  model,
  sheet,
  visible,
  epoch,
  onClose,
  onOpenSheet,
  isOnline,
  language,
  userId,
  lastSyncedAt,
  t,
  ctx,
  go,
  shift,
  briefing,
  recap,
  syncRun,
  onRoomConfirmed,
}: Props) {
  const toast = useToast();
  const [clockOutError, setClockOutError] = useState<ClockOutError>(null);
  const [clockedOutHere, setClockedOutHere] = useState(false);
  const clockingOut = useRef(false);

  // A fresh review starts clean, whatever the last attempt did.
  const reviewing = sheet?.kind === "finishShift";
  useEffect(() => {
    if (reviewing) {
      setClockOutError(null);
      setClockedOutHere(false);
    }
  }, [reviewing, epoch]);
  const extras = useReviewExtras(reviewing && visible, isOnline, userId);

  // The last retry's result belongs to that visit; a fresh drawer starts without it.
  const { clearLast } = syncRun;
  const syncOpen = sheet?.kind === "sync";
  useEffect(() => {
    if (syncOpen) clearLast();
  }, [syncOpen, epoch, clearLast]);

  const then = useCallback(
    <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A) => {
        onClose();
        action(...args);
      },
    [onClose],
  );

  // Clock-out is claimed only after the server confirms; a second tap shares the first request.
  const handleClockOut = useCallback(async () => {
    if (clockingOut.current) return;
    clockingOut.current = true;
    setClockOutError(null);
    try {
      const result = await shift.end();
      if (result.ok) {
        setClockedOutHere(true);
        onClose();
        toast.success(t("home.endOfShift.clockedOut"));
      } else if (result.reason === "offline") setClockOutError("offline");
      else if (result.reason === "not_allowed") setClockOutError("not_allowed");
      else if (result.reason === "failed") setClockOutError("failed");
    } finally {
      clockingOut.current = false;
    }
  }, [shift, onClose, toast, t]);

  const openReviewItem = useCallback(
    (item: ReviewItem) => {
      const target = item.target;
      if (target.type === "sync") {
        onOpenSheet({ kind: "sync" });
        return;
      }
      onClose();
      if (target.type === "room") go.openRoom(target.roomId);
      else if (target.type === "workOrder") go.openWorkOrder(target.workOrderId);
      else if (target.type === "tasks") go.openTasks();
      else go.openLostFound();
    },
    [go, onClose, onOpenSheet],
  );

  if (!sheet) return null;

  switch (sheet.kind) {
    case "markClean":
      return (
        <MarkCleanConfirmationSheet
          key={epoch}
          visible={visible}
          roomId={sheet.roomId}
          model={model}
          isOnline={isOnline}
          t={t}
          ctx={ctx}
          onClose={onClose}
          onOpenRoom={then(go.openRoom)}
          onOpenSync={() => onOpenSheet({ kind: "sync" })}
          onConfirmed={onRoomConfirmed}
        />
      );
    case "finishShift": {
      const ended = model.lifecycle.state === "ended" || model.lifecycle.state === "not_started";
      return (
        <FinishShiftReviewSheet
          visible={visible}
          review={buildShiftReview(model, extras)}
          clockingOut={model.lifecycle.state === "ending"}
          error={clockOutError}
          alreadyEnded={ended && !clockedOutHere}
          language={language}
          timeZone={model.timeZone}
          t={t}
          ctx={ctx}
          onClockOut={() => void handleClockOut()}
          onOpenItem={openReviewItem}
          onOpenSync={() => onOpenSheet({ kind: "sync" })}
          onClose={onClose}
        />
      );
    }
    case "summary":
      return (
        <CompletedShiftSummarySheet
          visible={visible}
          summary={buildShiftSummary(model, new Date())}
          language={language}
          timeZone={model.timeZone}
          online={isOnline}
          recap={recap.ai}
          recapStatus={recap.status}
          t={t}
          onRequestRecap={() => void recap.request()}
          onOpenItem={openReviewItem}
          onOpenSync={() => onOpenSheet({ kind: "sync" })}
          onClose={onClose}
        />
      );
    case "sync":
      return (
        <SyncStatusSheet
          visible={visible}
          view={buildSyncStatusView({ model, lastSyncedAt, syncing: syncRun.syncing })}
          syncing={syncRun.syncing}
          lastRun={syncRun.last}
          t={t}
          ctx={ctx}
          onRetry={() => void syncRun.run()}
          onOpenRoom={then(go.openRoom)}
          onOpenTasks={then(go.openTasks)}
          onClose={onClose}
        />
      );
    case "briefing": {
      const local = buildBriefingFromModel(model, t);
      const known = model.dashboard.all.map((entry) => entry.room.room_number);
      const shown = briefing.ai ? reconcileBriefing(briefing.ai, local, known, restrictedRoomNumbers(model)) : local;
      return (
        <ShiftBriefingSheet
          visible={visible}
          plan={buildBriefingPlan(model, new Date())}
          briefing={shown}
          status={briefing.status}
          online={isOnline}
          t={t}
          ctx={ctx}
          onNewBriefing={() => void briefing.request({ force: true })}
          onAskAi={then(go.openCopilot)}
          onOpenRoom={then(go.openRoom)}
          onClose={onClose}
        />
      );
    }
    default:
      return null;
  }
}
