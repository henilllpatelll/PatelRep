import { api } from "@/lib/api/client";

/** Shared response contract for the 4 new per-role copilot corner-card
 *  briefing endpoints (housekeeping briefing keeps its own older shape,
 *  see lib/ai/briefing.ts). Never throws — callers get null on any failure
 *  (offline, no AI credentials, credit cap, provider error) so the corner
 *  card can show a graceful "unavailable" state instead of crashing. */
export interface CopilotBriefing {
  headline: string;
  confidence: number;
  sources: string[];
  stats: Array<{ label: string; value: string; sub: string }>;
  rows: Array<{ title: string; sub: string; meta: string }>;
  primary_action: string;
  secondary_action: string;
  chips: string[];
  credits_used: number;
  model_used: string;
}

async function postBriefing(path: string, body: unknown): Promise<CopilotBriefing | null> {
  try {
    const res = await api.post<{ data: CopilotBriefing }>(path, body);
    return res.data ?? null;
  } catch {
    return null;
  }
}

export interface BriefingRoomInput {
  room_number: string;
  status: string;
  clean_type?: string | null;
  vip_flag?: boolean;
  dnd_flag?: boolean;
}

export interface StaffProgressInput {
  name: string;
  floor?: string | null;
  rooms_done: number;
  rooms_total: number;
  minutes_behind?: number | null;
}

export function fetchSupervisorBriefing(
  rooms: BriefingRoomInput[],
  staff: StaffProgressInput[],
  language: "en" | "es",
): Promise<CopilotBriefing | null> {
  return postBriefing("/ai/supervisor/briefing", { rooms, staff, language });
}

export interface WorkOrderBriefingInput {
  title: string;
  category?: string | null;
  priority: string;
  status: string;
  room_number?: string | null;
  due_at?: string | null;
}

export function fetchEngineerBriefing(
  workOrders: WorkOrderBriefingInput[],
  pmDueThisWeek: number,
  language: "en" | "es",
): Promise<CopilotBriefing | null> {
  return postBriefing("/ai/engineer/briefing", {
    work_orders: workOrders,
    pm_due_this_week: pmDueThisWeek,
    language,
  });
}

export interface GuestRequestBriefingInput {
  request_type: string;
  room_number?: string | null;
  status: string;
  sla_breached?: boolean;
  minutes_open?: number | null;
}

export function fetchFrontDeskBriefing(
  guestRequests: GuestRequestBriefingInput[],
  readyRoomCount: number,
  arrivalsCount: number,
  vipArrivalsCount: number,
  language: "en" | "es",
): Promise<CopilotBriefing | null> {
  return postBriefing("/ai/front-desk/briefing", {
    guest_requests: guestRequests,
    ready_room_count: readyRoomCount,
    arrivals_count: arrivalsCount,
    vip_arrivals_count: vipArrivalsCount,
    language,
  });
}

export async function fetchGmBriefing(language: "en" | "es"): Promise<CopilotBriefing | null> {
  try {
    const res = await api.get<{ data: CopilotBriefing }>(`/ai/gm/briefing?language=${language}`);
    return res.data ?? null;
  } catch {
    return null;
  }
}
