import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import type { Room } from "@/stores/appStore";
import { resolveReturnTime } from "@/lib/housekeeping/hotelTime";
import {
  buildBlockerNote,
  formatBlockerTimeInput,
  runBlockerSideEffect,
  sendDeclinedServiceAlert,
  type RoomBlocker,
} from "@/lib/housekeeping/roomBlockers";
import type { useRoomExceptions } from "@/lib/housekeeping/useRoomExceptions";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Toast {
  error: (message: string) => void;
  info: (message: string) => void;
}

interface Options {
  room: Room | null;
  isOnline: boolean;
  hotelTimezone: string | null;
  exceptions: ReturnType<typeof useRoomExceptions>;
  updateLocalRoom: (roomId: string, patch: Partial<Room>) => void;
  toast: Toast;
  t: Translate;
}

const NOTE_SAVE_WAIT_MS = 12000;

/**
 * Everything the housekeeper can report from Room Detail — notes, quick
 * blockers, DND and declined service. These were inline in the screen; the
 * behavior is unchanged, only its home moved so the screen can stay a layout.
 *
 * Nothing here pretends to have worked: server-backed records come first and a
 * failure stops the flow. There is deliberately no local-only "undo" of a note —
 * the server keeps what was saved, so the screen must not claim otherwise.
 */
export function useRoomReports({ room, isOnline, hotelTimezone, exceptions, updateLocalRoom, toast, t }: Options) {
  const [noteLoading, setNoteLoading] = useState(false);
  const [blockerBusy, setBlockerBusy] = useState<string | null>(null);
  const [dndLoading, setDndLoading] = useState(false);
  const [declineLoading, setDeclineLoading] = useState(false);

  const submitNote = useCallback(
    async (text: string): Promise<boolean> => {
      if (!room || !text.trim()) return false;
      if (!isOnline) {
        toast.info(t("rooms.detail.alerts.notesNeedConnection"));
        return false;
      }
      setNoteLoading(true);
      try {
        const note = text.trim();
        await api.post(`/rooms/${room.id}/notes`, { text: note });
        updateLocalRoom(room.id, { latest_note: note, latest_note_at: new Date().toISOString() });
        return true;
      } catch (err: unknown) {
        toast.error((err as Error).message ?? t("rooms.detail.alerts.saveNoteFailed"));
        return false;
      } finally {
        setNoteLoading(false);
      }
    },
    [room, isOnline, updateLocalRoom, toast, t],
  );

  const submitBlocker = useCallback(
    async (blocker: RoomBlocker, time?: string): Promise<boolean> => {
      if (!room) return false;
      if (!isOnline) {
        toast.info(t("rooms.detail.alerts.blockersNeedConnection"));
        return false;
      }
      setBlockerBusy(blocker.key);
      try {
        const formattedTime = blocker.needsTime ? formatBlockerTimeInput(time) : time;
        // Server-backed records come first: if they cannot be saved, nothing is faked.
        if (blocker.key === "come_back_later") {
          const resolved = resolveReturnTime(formattedTime, hotelTimezone);
          if (!resolved.ok) {
            toast.error(
              t(resolved.reason === "past" ? "rooms.dash.detail.restriction.timePast" : "rooms.dash.detail.restriction.timeInvalid"),
            );
            return false;
          }
          if (!(await exceptions.record("return_later", resolved.iso))) return false;
        } else if (blocker.key === "dnd_on_door" || blocker.key === "dnd_sign") {
          if (!(await exceptions.record("dnd_no_response"))) return false;
        } else if (blocker.key === "declined_service") {
          if (!(await exceptions.markDeclined())) return false;
        }
        await runBlockerSideEffect(room, blocker, formattedTime);
        await Promise.race([
          submitNote(buildBlockerNote(blocker, formattedTime)),
          new Promise<void>((resolve) => setTimeout(resolve, NOTE_SAVE_WAIT_MS)),
        ]);
        if (blocker.key === "declined_service") await sendDeclinedServiceAlert(room.room_number);
        return true;
      } catch (err: unknown) {
        toast.error((err as Error).message ?? t("rooms.detail.alerts.reportBlockerFailed"));
        return false;
      } finally {
        setBlockerBusy(null);
      }
    },
    [room, isOnline, hotelTimezone, exceptions, submitNote, toast, t],
  );

  const toggleDnd = useCallback(async () => {
    if (!room || !isOnline) {
      toast.info(t("rooms.detail.alerts.dndNeedsConnection"));
      return;
    }
    setDndLoading(true);
    try {
      // The attempt log is the record; the server flips the flag and counts it once.
      await exceptions.record(room.dnd_flag ? "dnd_cleared" : "dnd_no_response");
    } finally {
      setDndLoading(false);
    }
  }, [room, isOnline, exceptions, toast, t]);

  const toggleDeclineService = useCallback(async () => {
    if (!room || !isOnline) {
      toast.info(t("rooms.detail.alerts.serviceNeedsConnection"));
      return;
    }
    const next = !room.do_not_service;
    setDeclineLoading(true);
    if (next) {
      // Turning it on goes through the reason-bearing endpoint (persists reason + time).
      try {
        await exceptions.markDeclined();
      } finally {
        setDeclineLoading(false);
      }
      return;
    }
    updateLocalRoom(room.id, { do_not_service: next });
    try {
      await api.patch(`/rooms/${room.id}/decline-service`, { decline: next });
    } catch (err: unknown) {
      updateLocalRoom(room.id, { do_not_service: !next });
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateServiceFailed"));
    } finally {
      setDeclineLoading(false);
    }
  }, [room, isOnline, exceptions, updateLocalRoom, toast, t]);

  return { noteLoading, blockerBusy, dndLoading, declineLoading, submitNote, submitBlocker, toggleDnd, toggleDeclineService };
}
