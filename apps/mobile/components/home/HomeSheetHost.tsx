import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform } from "react-native";
import { IssueDetailsSheet } from "@/components/home/IssueDetailsSheet";
import { RecommendationSheet } from "@/components/home/RecommendationSheet";
import { RoomActionsSheet } from "@/components/home/RoomActionsSheet";
import { ShiftProgressSheet } from "@/components/home/ShiftProgressSheet";
import { SupervisorMessageSheet, type MarkReadError } from "@/components/home/SupervisorMessageSheet";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import {
  buildProgressDetails,
  resolveIssueDetails,
  resolveRoomActions,
  resolveWhyRoom,
  type RoomActionId,
} from "@/lib/housekeeping/homeSheets";
import { resolveNotificationLink, senderOf, type NotificationLink } from "@/lib/housekeeping/notificationLinks";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { useToast } from "@/lib/theme/useToast";
import type { MarkReadResult } from "@/stores/homeBridgeStore";

/** Long enough for the slide-out to finish before the sheet's content is dropped. */
const CLOSE_MS = 280;
/** Screen readers need a beat after a modal closes before focus can move back. */
const FOCUS_RETURN_MS = 120;

/** Which drawer is open, and for what. Ids only: the content is always re-read from the live model. */
export type HomeSheetState =
  | { kind: "roomActions"; roomId: string }
  | { kind: "why"; roomId: string | null }
  | { kind: "issue"; itemId: string }
  | { kind: "message" }
  | { kind: "progress" };

/**
 * One drawer at a time. Opening replaces whatever was open; closing animates
 * out, then gives screen-reader focus back to the control that opened it.
 */
export function useHomeSheet() {
  const [sheet, setSheet] = useState<HomeSheetState | null>(null);
  const [visible, setVisible] = useState(false);
  const trigger = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const open = useCallback((next: HomeSheetState, opener?: RefObject<unknown>) => {
    if (timer.current) clearTimeout(timer.current);
    trigger.current = opener?.current ?? null;
    setSheet(next);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSheet(null);
      const target = trigger.current;
      trigger.current = null;
      if (!target || Platform.OS === "web") return;
      focusTimer.current = setTimeout(() => {
        try {
          const node = findNodeHandle(target as never);
          if (node) AccessibilityInfo.setAccessibilityFocus(node);
        } catch {
          // Focus return is a courtesy; never let it break the screen.
        }
      }, FOCUS_RETURN_MS);
    }, CLOSE_MS);
  }, []);

  return { sheet, visible, open, close };
}

export interface HomeSheetGo {
  /** The room screen, as Home's primary action opens it. */
  openRoom: (roomId: string) => void;
  /** The room screen with one of its existing forms / sheets opened. */
  roomAction: (roomId: string, action: Exclude<RoomActionId, "open">) => void;
  openWorkOrder: (workOrderId: string) => void;
  openMyRooms: () => void;
  openLink: (link: Exclude<NotificationLink, { kind: "none" }>) => void;
}

interface Props {
  model: HomeModel;
  sheet: HomeSheetState | null;
  visible: boolean;
  onClose: () => void;
  role: string | null | undefined;
  isOnline: boolean;
  pendingCount: number;
  language: string;
  t: Translate;
  ctx: TextContext;
  go: HomeSheetGo;
  markNoteRead: () => Promise<MarkReadResult>;
}

/**
 * Renders whichever drawer is open from the live HomeModel. Every drawer
 * re-resolves on each render, so a reassignment, a cleared restriction or a new
 * ranking while it is open shows up (or closes it safely) instead of leaving it
 * acting on a stale room. Navigation always closes the drawer first.
 */
export function HomeSheetHost({ model, sheet, visible, onClose, role, isOnline, pendingCount, language, t, ctx, go, markNoteRead }: Props) {
  const toast = useToast();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<MarkReadError>(null);
  const markingRef = useRef(false);

  // A fresh message drawer starts clean, whatever the last attempt did.
  const isMessage = sheet?.kind === "message";
  useEffect(() => {
    if (isMessage) setMarkError(null);
  }, [isMessage]);

  const then = useCallback(
    <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A) => {
        onClose();
        action(...args);
      },
    [onClose],
  );

  const handleMarkRead = useCallback(async () => {
    if (markingRef.current) return;
    markingRef.current = true;
    setMarking(true);
    setMarkError(null);
    try {
      const result = await markNoteRead();
      if (result.ok) {
        onClose();
        toast.success(t("home.message.markedRead"));
      } else {
        setMarkError(result.reason);
      }
    } finally {
      markingRef.current = false;
      setMarking(false);
    }
  }, [markNoteRead, onClose, toast, t]);

  const rooms = useMemo(() => model.dashboard.all.map((entry) => entry.room), [model.dashboard.all]);
  const note = model.supervisorInstruction;
  const message = useMemo(
    () =>
      note
        ? {
            id: note.id,
            title: note.title,
            body: note.body,
            createdAt: note.createdAt,
            sender: senderOf({ type: note.type ?? "", data: note.data }),
            link: resolveNotificationLink({ type: note.type ?? "", data: note.data }, rooms),
          }
        : null,
    [note, rooms],
  );

  if (!sheet) return null;

  switch (sheet.kind) {
    case "roomActions": {
      const view = resolveRoomActions({ model, roomId: sheet.roomId, role, isOnline, pendingCount });
      return (
        <RoomActionsSheet
          visible={visible}
          view={view}
          t={t}
          onClose={onClose}
          onSelect={then((roomId: string, action: RoomActionId) => (action === "open" ? go.openRoom(roomId) : go.roomAction(roomId, action)))}
        />
      );
    }
    case "why":
      return (
        <RecommendationSheet
          visible={visible}
          view={resolveWhyRoom(model, sheet.roomId)}
          t={t}
          ctx={ctx}
          onClose={onClose}
          onOpenRoom={then(go.openRoom)}
          onOpenMyRooms={then(go.openMyRooms)}
        />
      );
    case "issue":
      return (
        <IssueDetailsSheet
          visible={visible}
          view={resolveIssueDetails({ model, itemId: sheet.itemId, role, isOnline })}
          note={note}
          t={t}
          ctx={ctx}
          onClose={onClose}
          onViewRoom={then(go.openRoom)}
          onAddNote={then((roomId: string) => go.roomAction(roomId, "note"))}
          onViewWorkOrder={then(go.openWorkOrder)}
        />
      );
    case "message":
      return (
        <SupervisorMessageSheet
          visible={visible}
          message={message}
          marking={marking}
          error={markError}
          language={language}
          timeZone={model.timeZone}
          t={t}
          onClose={onClose}
          onMarkRead={() => void handleMarkRead()}
          onOpenLink={then(go.openLink)}
        />
      );
    case "progress":
      return (
        <ShiftProgressSheet
          visible={visible}
          details={buildProgressDetails(model)}
          lifecycle={model.lifecycle}
          language={language}
          timeZone={model.timeZone}
          t={t}
          onClose={onClose}
          onOpenMyRooms={then(go.openMyRooms)}
        />
      );
  }
}
