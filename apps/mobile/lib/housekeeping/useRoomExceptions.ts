import { useCallback, useEffect, useState } from "react";
import type { Room } from "@/stores/appStore";
import {
  notifySupervisor,
  recordServiceAttempt,
  recordServiceDeclined,
  type AttemptResult,
} from "@/lib/housekeeping/serviceAttempts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Toast {
  error: (message: string) => void;
  info: (message: string) => void;
}

interface Options {
  room: Room | null;
  isOnline: boolean;
  updateLocalRoom: (roomId: string, patch: Partial<Room>) => void;
  refreshRooms: () => Promise<void>;
  toast: Toast;
  t: Translate;
}

/**
 * Server-backed exceptions for one room: pre-entry service attempts, Service
 * Declined and the explicit supervisor notification. The room the screen shows
 * only changes from what the server returns — the attempt count is never
 * bumped locally — and offline attempts are refused, not faked.
 */
export function useRoomExceptions({ room, isOnline, updateLocalRoom, refreshRooms, toast, t }: Options) {
  const roomId = room?.id ?? null;
  const [busy, setBusy] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    setNotified(false);
  }, [roomId]);

  const record = useCallback(
    async (result: AttemptResult, returnAt?: string, note?: string): Promise<boolean> => {
      if (!roomId) return false;
      if (!isOnline) {
        toast.info(t("rooms.dash.detail.restriction.needsConnection"));
        return false;
      }
      setBusy(true);
      try {
        const outcome = await recordServiceAttempt({ roomId, result, returnAt, note }, isOnline);
        if (outcome.outcome === "offline") {
          toast.info(t("rooms.dash.detail.restriction.needsConnection"));
          return false;
        }
        if (outcome.outcome === "failed") {
          toast.error(t("rooms.dash.detail.restriction.failed"));
          return false;
        }
        updateLocalRoom(roomId, outcome.room);
        toast.info(t("rooms.dash.detail.restriction.recorded"));
        void refreshRooms();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [roomId, isOnline, updateLocalRoom, refreshRooms, toast, t],
  );

  const markDeclined = useCallback(async (note?: string): Promise<boolean> => {
    if (!roomId) return false;
    if (!isOnline) {
      toast.info(t("rooms.detail.alerts.serviceNeedsConnection"));
      return false;
    }
    setBusy(true);
    try {
      const outcome = await recordServiceDeclined(roomId, isOnline, "guest_declined_housekeeping", note);
      if (outcome.outcome !== "recorded") {
        toast.error(outcome.outcome === "failed" ? outcome.message : t("rooms.detail.alerts.serviceNeedsConnection"));
        return false;
      }
      updateLocalRoom(roomId, {
        do_not_service: true,
        service_declined_reason: "guest_declined_housekeeping",
        service_declined_at: new Date().toISOString(),
      });
      void refreshRooms();
      return true;
    } finally {
      setBusy(false);
    }
  }, [roomId, isOnline, updateLocalRoom, refreshRooms, toast, t]);

  const notify = useCallback(
    async (reason: string): Promise<boolean> => {
      if (!room || notified || notifying) return false;
      if (!isOnline) {
        toast.info(t("rooms.dash.detail.restriction.needsConnection"));
        return false;
      }
      setNotifying(true);
      try {
        const ok = await notifySupervisor(room.room_number, reason, isOnline);
        if (ok) setNotified(true);
        else toast.error(t("rooms.dash.detail.restriction.notifyFailed"));
        return ok;
      } finally {
        setNotifying(false);
      }
    },
    [room, notified, notifying, isOnline, toast, t],
  );

  return { busy, notifying, notified, record, markDeclined, notify };
}
