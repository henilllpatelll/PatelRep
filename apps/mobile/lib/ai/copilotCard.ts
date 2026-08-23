import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import {
  fetchSupervisorBriefing,
  fetchEngineerBriefing,
  fetchFrontDeskBriefing,
  fetchGmBriefing,
  type BriefingRoomInput,
  type StaffProgressInput,
  type WorkOrderBriefingInput,
  type GuestRequestBriefingInput,
  type CopilotBriefing,
} from "@/lib/api/briefings";
import { fetchBoard, fetchAssignableStaff } from "@/lib/api/housekeepingSupervisor";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { listWorkOrders } from "@/lib/api/workOrders";
import { getGuestRequests } from "@/lib/api/guestRequests";
import { fetchShiftBriefing } from "@/lib/ai/briefing";
import { useAppStore } from "@/stores/appStore";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The 5 mobile-facing "personas" the copilot corner card speaks to.
 *  chief_engineer has no distinct mobile login (mobile unifies it with
 *  engineer), and any other/unrecognized role gets no role-specific brief —
 *  the card still opens with a plain chat input in that case. */
export type CopilotCardRole =
  | "housekeeper"
  | "housekeeping_supervisor"
  | "engineer"
  | "front_desk"
  | "gm";

export interface CopilotCardBrief {
  label: string;
  /** null hides the confidence badge (used for the on-device fallback path,
   *  which has no real confidence score to show). */
  confidence: number | null;
  brief: string;
  sources: string[];
  primaryAction: string;
  secondaryAction: string;
  chips: string[];
}

function toCardRole(role: string | undefined | null): CopilotCardRole | null {
  switch (role) {
    case "housekeeper":
      return "housekeeper";
    case "housekeeping_supervisor":
      return "housekeeping_supervisor";
    case "engineer":
    case "chief_engineer":
      return "engineer";
    case "front_desk":
      return "front_desk";
    case "gm":
      return "gm";
    default:
      return null;
  }
}

function mapApiBrief(
  t: Translate,
  role: Exclude<CopilotCardRole, "housekeeper">,
  result: CopilotBriefing,
): CopilotCardBrief {
  return {
    label: t(`copilot.card.labels.${role}`),
    confidence: result.confidence,
    brief: result.headline,
    sources: result.sources,
    primaryAction: result.primary_action,
    secondaryAction: result.secondary_action || t("copilot.card.notNow"),
    chips: result.chips,
  };
}

async function loadSupervisorBrief(t: Translate, language: "en" | "es"): Promise<CopilotCardBrief | null> {
  const today = new Date().toISOString().slice(0, 10);
  const [boardRows, staff] = await Promise.all([fetchBoard(today), fetchAssignableStaff()]);

  const rooms: BriefingRoomInput[] = boardRows.map((r) => ({
    room_number: r.rooms?.room_number ?? "?",
    status: r.status,
    clean_type: r.clean_type ?? null,
    vip_flag: Boolean(r.vip_flag),
    dnd_flag: Boolean(r.dnd_flag),
  }));

  const staffInputs: StaffProgressInput[] = staff
    .map((member) => {
      const assigned = boardRows.filter((r) => r.assigned_to === member.userId);
      const done = assigned.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;
      return { name: member.name, rooms_done: done, rooms_total: assigned.length };
    })
    .filter((s) => s.rooms_total > 0);

  const result = await fetchSupervisorBriefing(rooms, staffInputs, language);
  return result ? mapApiBrief(t, "housekeeping_supervisor", result) : null;
}

async function loadEngineerBrief(t: Translate, language: "en" | "es"): Promise<CopilotCardBrief | null> {
  const [openWOs, progressWOs, pmRes] = await Promise.all([
    listWorkOrders("open"),
    listWorkOrders("in_progress"),
    api.get<{ data: Array<{ status: string }> }>("/assets/pm-schedules"),
  ]);

  const workOrders: WorkOrderBriefingInput[] = [...openWOs, ...progressWOs].map((wo) => ({
    title: wo.title,
    category: wo.category ?? null,
    priority: wo.priority,
    status: wo.status,
    room_number: wo.rooms?.room_number ?? null,
    due_at: wo.due_at ?? null,
  }));
  const pmDueThisWeek = (pmRes.data ?? []).filter((p) => p.status === "due" || p.status === "overdue").length;

  const result = await fetchEngineerBriefing(workOrders, pmDueThisWeek, language);
  return result ? mapApiBrief(t, "engineer", result) : null;
}

async function loadFrontDeskBrief(t: Translate, language: "en" | "es"): Promise<CopilotCardBrief | null> {
  const today = new Date().toISOString().slice(0, 10);
  const [grRes, boardRows] = await Promise.all([
    getGuestRequests(),
    fetchBoard(today).catch((): BoardRoomRaw[] => []),
  ]);

  const open = (grRes.data ?? []).filter((r) => r.status === "open" || r.status === "in_progress");
  const guestRequests: GuestRequestBriefingInput[] = open.map((r) => ({
    request_type: r.description.slice(0, 60),
    room_number: r.room_number,
    status: r.status,
    sla_breached: r.priority === "urgent" || r.priority === "emergency",
    minutes_open: Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000)),
  }));

  const readyRoomCount = boardRows.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;
  const arrivalsCount = boardRows.filter((r) => Boolean(r.checkin_time)).length;
  const vipArrivalsCount = boardRows.filter((r) => Boolean(r.checkin_time) && Boolean(r.vip_flag)).length;

  const result = await fetchFrontDeskBriefing(guestRequests, readyRoomCount, arrivalsCount, vipArrivalsCount, language);
  return result ? mapApiBrief(t, "front_desk", result) : null;
}

async function loadGmBrief(t: Translate, language: "en" | "es"): Promise<CopilotCardBrief | null> {
  const result = await fetchGmBriefing(language);
  return result ? mapApiBrief(t, "gm", result) : null;
}

/** Loads the corner-card brief for the current user's role. Housekeeper reuses
 *  the existing (older-shaped) housekeeping briefing endpoint, which already
 *  falls back to an on-device heuristic and never throws; the other 4 roles
 *  use the newer unified briefing contract and resolve to null on failure.
 *
 *  This hook now lives for the whole app session (mounted once in the root
 *  layout, feeding both the collapsed bubble's unread/thinking state and the
 *  open card), not just while the card is open. The auto-fetch on mount is
 *  deliberately keyed ONLY to role changes, not to myRooms/isOnline/language
 *  churn — several of the underlying briefings are real, credit-charged AI
 *  calls (see CLAUDE.md A3), and re-firing one on every room-status mutation
 *  for as long as the app is open would multiply that spend for no reason.
 *  `reload()` still always uses the latest data, since it closures over
 *  current render values regardless of when the effect last ran. */
export function useCopilotBrief() {
  const { t, i18n } = useTranslation();
  const language: "en" | "es" = i18n.language?.startsWith("es") ? "es" : "en";
  const { user, myRooms, isOnline } = useAppStore();
  const cardRole = toCardRole(user?.effective_role ?? user?.role);

  const [brief, setBrief] = useState<CopilotCardBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!cardRole) {
      setBrief(null);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      let next: CopilotCardBrief | null = null;
      if (cardRole === "housekeeper") {
        const shift = await fetchShiftBriefing(myRooms, language, t, isOnline);
        next = {
          label: t("copilot.card.labels.housekeeper"),
          confidence: shift.source === "ai" ? 90 : null,
          brief: shift.headline,
          sources: shift.source === "ai" ? [t("copilot.card.housekeeper.source")] : [],
          primaryAction: t("copilot.card.housekeeper.primary"),
          secondaryAction: t("copilot.card.notNow"),
          chips:
            shift.watchouts.length > 0
              ? shift.watchouts.slice(0, 2)
              : [t("copilot.card.housekeeper.chip1"), t("copilot.card.housekeeper.chip2")],
        };
      } else if (cardRole === "housekeeping_supervisor") {
        next = await loadSupervisorBrief(t, language);
      } else if (cardRole === "engineer") {
        next = await loadEngineerBrief(t, language);
      } else if (cardRole === "front_desk") {
        next = await loadFrontDeskBrief(t, language);
      } else if (cardRole === "gm") {
        next = await loadGmBrief(t, language);
      }
      setBrief(next);
      if (!next) setError(true);
    } catch {
      setBrief(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cardRole, myRooms, isOnline, language, t]);

  const loadedRoleRef = useRef<CopilotCardRole | null>(null);
  useEffect(() => {
    if (!cardRole) {
      loadedRoleRef.current = null;
      setBrief(null);
      return;
    }
    if (loadedRoleRef.current !== cardRole) {
      loadedRoleRef.current = cardRole;
      load();
    }
  }, [cardRole, load]);

  return { cardRole, brief, loading, error, reload: load };
}
