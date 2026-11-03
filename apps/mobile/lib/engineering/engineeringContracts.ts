/* ─── Shared Engineering contracts ──────────────────────────────────────────
   Types and pure rules that PM, Assets and Work Orders all read, so the two tabs never keep their own copies.

   Four DIFFERENT questions about a piece of equipment, never merged into one badge:
     administrative  is the record in use?                 (assets.is_active: a person's decision)
     condition       what do its meters say right now?     (condition_status: derived from readings, null = no meters)
     downtime        has it actually been out of service?  (an open or past downtime period: a recorded fact)
     predictiveRisk  how likely is a failure?              (failure_risk_score: a model's estimate, never a fact)
   plus its PM scheduling state (when is service due). Anything the server did not send is `null` - unknown - and is shown
   as unavailable, never as a healthy-looking zero. */

import type { AssetServiceStatus } from "./assetModel";
import { riskBand } from "./assetModel";

/* ── schedule -> checklist binding (GET /assets/pm-schedules[*].checklist) ── */

export type PmChecklistState = "unassigned" | "ready" | "missing" | "inactive" | "incompatible";

export interface PmChecklistBinding {
  state: PmChecklistState;
  templateId: string | null;
  templateCode: string | null;
  templateName: string | null;
  templateVersion: number | null;
  /** An active newer revision of the same procedure, when the bound one was retired. A manager rebinds; nobody guesses. */
  replacementTemplateId: string | null;
}

export const UNASSIGNED_CHECKLIST: PmChecklistBinding = {
  state: "unassigned",
  templateId: null,
  templateCode: null,
  templateName: null,
  templateVersion: null,
  replacementTemplateId: null,
};

export interface PmChecklistBindingWire {
  state?: string | null;
  template_id?: string | null;
  template_code?: string | null;
  template_name?: string | null;
  template_version?: number | null;
  replacement_template_id?: string | null;
}

const STATES: readonly string[] = ["unassigned", "ready", "missing", "inactive", "incompatible"];

/** An older server sends no binding: that is "unassigned" (the technician chooses), never "ready". */
export function adaptChecklistBinding(raw: PmChecklistBindingWire | null | undefined): PmChecklistBinding {
  if (!raw || typeof raw.state !== "string" || !STATES.includes(raw.state)) return UNASSIGNED_CHECKLIST;
  return {
    state: raw.state as PmChecklistState,
    templateId: raw.template_id ?? null,
    templateCode: raw.template_code ?? null,
    templateName: raw.template_name ?? null,
    templateVersion: typeof raw.template_version === "number" ? raw.template_version : null,
    replacementTemplateId: raw.replacement_template_id ?? null,
  };
}

/** Bound to a procedure that cannot be used right now: the inspection cannot start and somebody has to fix the binding. */
export function checklistNeedsAttention(binding: PmChecklistBinding): boolean {
  return binding.state === "missing" || binding.state === "inactive" || binding.state === "incompatible";
}

/* ── deferral requests (GET /programs/pm-deferrals) ── */

export type PmDeferralStatus = "pending" | "approved" | "rejected";

export interface PmDeferralRow {
  id: string;
  pm_schedule_id: string;
  reason: string;
  requested_by: string;
  deferred_until: string;
  created_at: string;
  status: PmDeferralStatus;
  decision: null | {
    decision: "approved" | "rejected";
    decided_by: string;
    decided_at: string;
    note?: string | null;
    previous_due_at?: string | null;
    applied_due_at?: string | null;
  };
}

/* ── equipment status facets ── */

export type AssetAdministrativeStatus = "active" | "inactive";
export type AssetConditionStatus = "critical" | "warning" | "stale";

export interface AssetFacetsInput {
  is_active?: boolean | null;
  administrative_status?: string | null;
  condition_status?: string | null;
  service_status?: AssetServiceStatus | null;
  active_downtime?: unknown;
  had_downtime_365d?: boolean | null;
  failure_risk_score?: number | null;
}

export interface AssetFacets {
  administrative: AssetAdministrativeStatus | null;
  /** From meter readings. `null` = this equipment has no meters (or the server did not say), not "all fine". */
  condition: AssetConditionStatus | null;
  /** Out of service right now (a recorded downtime period is open). `null` = unknown. */
  inDowntimeNow: boolean | null;
  /** Had any recorded downtime in the past year. `null` = unknown. */
  hadDowntime365d: boolean | null;
  predictiveRisk: "high" | "elevated" | "low" | null;
}

export function assetAdministrativeStatus(input: Pick<AssetFacetsInput, "is_active" | "administrative_status">): AssetAdministrativeStatus | null {
  if (input.administrative_status === "active" || input.administrative_status === "inactive") return input.administrative_status;
  if (typeof input.is_active === "boolean") return input.is_active ? "active" : "inactive";
  return null;
}

export function deriveAssetFacets(input: AssetFacetsInput): AssetFacets {
  const condition = input.condition_status;
  return {
    administrative: assetAdministrativeStatus(input),
    condition: condition === "critical" || condition === "warning" || condition === "stale" ? condition : null,
    inDowntimeNow: input.active_downtime === undefined ? null : input.active_downtime != null,
    hadDowntime365d: typeof input.had_downtime_365d === "boolean" ? input.had_downtime_365d : null,
    predictiveRisk: riskBand(input.failure_risk_score),
  };
}
