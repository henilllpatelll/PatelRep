import { api } from "@/lib/api/client";

/**
 * Problem reports reuse the hotel's existing feedback service (POST /feedback). The server takes the person and
 * hotel from the signed-in session, so neither is sent here; `client_request_id` makes a retry of the same report
 * answer with the report the first try already filed.
 */

export const REPORT_AREAS = [
  "assignments",
  "tasks",
  "housekeeping",
  "inspections",
  "work_orders",
  "notifications",
  "account",
  "sync",
  "other",
] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];

/** The status values the server really uses; the UI shows exactly these, nothing invented. */
export type ReportStatus = "open" | "reviewing" | "closed";

export interface MyReport {
  id: string;
  category: string;
  area: ReportArea | null;
  severity: string | null;
  message: string;
  status: ReportStatus;
  source: string;
  created_at: string;
  updated_at: string | null;
}

export interface SubmitReportInput {
  area: ReportArea;
  message: string;
  /** "This is stopping me from working" -> severity "blocking", otherwise "annoying". */
  blocking: boolean;
  clientRequestId: string;
  /** Reviewed diagnostics, only when the person agreed to send them. */
  diagnostics?: Record<string, string | number | boolean>;
  sourceScreen?: string | null;
}

export interface SubmittedReport {
  id: string;
  status: ReportStatus;
  created_at: string;
  replayed: boolean;
}

export async function submitProblemReport(input: SubmitReportInput): Promise<SubmittedReport> {
  const res = await api.post<{ data: { id: string; status: ReportStatus; created_at: string }; meta?: { replayed?: boolean } }>("/feedback", {
    source: "mobile",
    category: input.area === "other" ? "other" : "bug",
    severity: input.blocking ? "blocking" : "annoying",
    area: input.area,
    message: input.message,
    client_request_id: input.clientRequestId,
    pathname: input.sourceScreen ?? undefined,
    client_context: input.diagnostics ?? {},
  });
  // Only an answer that carries the stored report counts as accepted.
  if (!res?.data?.id) throw new Error("Report was not confirmed");
  return { id: res.data.id, status: res.data.status, created_at: res.data.created_at, replayed: res.meta?.replayed === true };
}

export async function listMyReports(): Promise<MyReport[]> {
  return (await api.get<{ data: MyReport[] }>("/feedback/mine")).data ?? [];
}

export interface SupportContacts {
  hotel: { name: string | null; phone: string | null };
  contacts: { name: string; role: string }[];
}

export async function getSupportContacts(): Promise<SupportContacts> {
  const res = await api.get<{ data: SupportContacts }>("/staff/me/support-contacts");
  return { hotel: res.data?.hotel ?? { name: null, phone: null }, contacts: res.data?.contacts ?? [] };
}

const ALL_AREAS_BY_ROLE: Record<string, readonly ReportArea[]> = {
  housekeeper: ["assignments", "tasks", "housekeeping", "notifications", "account", "sync", "other"],
  inspector: ["assignments", "inspections", "tasks", "notifications", "account", "sync", "other"],
  engineer: ["work_orders", "tasks", "notifications", "account", "sync", "other"],
  chief_engineer: ["work_orders", "tasks", "notifications", "account", "sync", "other"],
  housekeeping_supervisor: ["assignments", "tasks", "housekeeping", "inspections", "work_orders", "notifications", "account", "sync", "other"],
  front_desk: ["assignments", "tasks", "work_orders", "notifications", "account", "sync", "other"],
  gm: REPORT_AREAS,
};

/** Only the parts of the app this role actually uses, so nobody scrolls past things they cannot see. */
export function areasForRole(role: string | null | undefined): readonly ReportArea[] {
  return (role && ALL_AREAS_BY_ROLE[role]) || ["tasks", "notifications", "account", "sync", "other"];
}
