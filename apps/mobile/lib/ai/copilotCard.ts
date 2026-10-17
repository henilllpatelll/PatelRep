import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import {
  fetchEngineerBriefing,
  fetchFrontDeskBriefing,
  fetchGmBriefing,
  type WorkOrderBriefingInput,
  type GuestRequestBriefingInput,
  type CopilotBriefing,
} from "@/lib/api/briefings";
import { fetchBoard } from "@/lib/api/housekeepingSupervisor";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { listWorkOrders } from "@/lib/api/workOrders";
import { getGuestRequests } from "@/lib/api/guestRequests";
import type { Provenance } from "@/lib/ai/contract";
import { assistantScope } from "@/lib/ai/session";
import { useSharedBriefing, type SharedBriefingView } from "@/lib/ai/useSharedBriefing";
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
  /** Where the words came from, shown instead of a made-up confidence score. */
  provenance?: Extract<Provenance, "deterministic" | "ai">;
  /** When set, the primary button opens this route instead of sending its label as a chat message. */
  primaryRoute?: string;
  /** The secondary button just closes the card instead of sending its label as a chat message. */
  secondaryDismiss?: boolean;
  /** Chips are plain notes, not prompts to send. */
  chipsAreInfo?: boolean;
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

/** The floating assistant's housekeeper brief: Home's own briefing, read-only (no request is ever made here). */
export function housekeeperBriefFromShared(t: Translate, shared: SharedBriefingView): CopilotCardBrief {
  const { briefing, provenance } = shared;
  return {
    label: t("copilot.card.labels.housekeeper"),
    confidence: null,
    brief: briefing.headline,
    sources: [],
    primaryAction: t("copilot.card.housekeeper.primary"),
    secondaryAction: t("copilot.card.notNow"),
    chips: briefing.watchouts.slice(0, 2),
    provenance,
    primaryRoute: "/(app)/my-rooms",
    secondaryDismiss: true,
    chipsAreInfo: true,
  };
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

/** Loads the corner-card brief for the current user's role.
 *
 *  Housekeepers get Home's own briefing, read-only from the shared briefing source (lib/ai/shiftBriefingSource):
 *  nothing here ever requests, or pays for, an AI briefing. The other 4 roles use the unified briefing
 *  contract and resolve to null on failure.
 *
 *  This hook lives for the whole app session (mounted once in the root layout, feeding both the collapsed
 *  bubble's unread/thinking state and the open card). The auto-fetch is deliberately keyed ONLY to who is
 *  signed in and their role, not to myRooms/isOnline/language churn: several of the underlying briefings
 *  are real, credit-charged AI calls (see CLAUDE.md A3), and re-firing one on every room-status mutation
 *  for as long as the app is open would multiply that spend for no reason. A different person signing in
 *  on the same device starts from nothing and never sees the previous person's brief. */
export function useCopilotBrief() {
  const { t, i18n } = useTranslation();
  const language: "en" | "es" = i18n.language?.startsWith("es") ? "es" : "en";
  const { user } = useAppStore();
  const cardRole = toCardRole(user?.effective_role ?? user?.role);
  // Housekeepers see the one shared briefing (Home publishes it); reading it never spends a credit.
  const shared = useSharedBriefing(cardRole === "housekeeper" ? assistantScope(user) : null);
  const housekeeperBrief = useMemo(() => (shared ? housekeeperBriefFromShared(t, shared) : null), [shared, t]);

  const [brief, setBrief] = useState<CopilotCardBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    // Housekeepers have nothing to load: their briefing is the shared one above. The supervisor's overview is built
    // on the phone from the Today snapshot when the card opens; its optional AI wording is a tap, never a load.
    if (!cardRole || cardRole === "housekeeper" || cardRole === "housekeeping_supervisor") {
      setBrief(null);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      let next: CopilotCardBrief | null = null;
      if (cardRole === "engineer") {
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
  }, [cardRole, language, t]);

  const personKey = cardRole ? `${assistantScope(user) ?? "anon"}:${cardRole}` : null;
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!personKey) {
      loadedKeyRef.current = null;
      setBrief(null);
      setError(false);
      return;
    }
    if (loadedKeyRef.current !== personKey) {
      loadedKeyRef.current = personKey;
      setBrief(null);
      setError(false);
      load();
    }
  }, [personKey, load]);

  if (cardRole === "housekeeper") {
    return { cardRole, brief: housekeeperBrief, loading: false, error: false, reload: load };
  }
  if (cardRole === "housekeeping_supervisor") {
    return { cardRole, brief: null, loading: false, error: false, reload: load };
  }
  return { cardRole, brief, loading, error, reload: load };
}
