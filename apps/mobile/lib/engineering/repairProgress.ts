import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { RepairActions } from "@/lib/engineering/repairWorkspace";

/* User-facing repair stages. They are guidance, not backend statuses: nothing here gates a transition, and a stage is
   only "done" when a server record proves it. Anything the data cannot prove is "unknown" (neutral), never a checkmark. */

export type StageId = "claim" | "diagnose" | "repair" | "verify" | "complete";
export type StageState = "done" | "current" | "pending" | "paused" | "unknown";

export interface ProgressStage {
  id: StageId;
  state: StageState;
}

export interface RepairProgress {
  stages: ProgressStage[];
  /** Cancelled orders have no forward path: stages are neutral and the screen says so. */
  cancelled: boolean;
}

type ProgressOrder = Pick<
  WorkOrder,
  "status" | "assigned_to" | "problem_code" | "problem_other_text" | "verification_result" | "verified_at"
>;

export function deriveRepairProgress(wo: ProgressOrder): RepairProgress {
  const ids: StageId[] = ["claim", "diagnose", "repair", "verify", "complete"];
  if (wo.status === "cancelled") return { stages: ids.map((id) => ({ id, state: "unknown" })), cancelled: true };

  const completed = wo.status === "completed";
  const held = wo.status === "on_hold" || wo.status === "escalated";
  const working = wo.status === "in_progress";
  const claimed = wo.assigned_to != null || wo.status !== "open";
  const diagnosed = Boolean(wo.problem_code || wo.problem_other_text?.trim());
  const verified = wo.verification_result != null && (wo.verification_result === "passed" || completed);

  const claim: StageState = claimed ? "done" : "current";
  // Diagnosis is optional until completion: a finished order that never recorded one is "unknown", not skipped-as-done.
  const diagnose: StageState = diagnosed ? "done" : completed ? "unknown" : "pending";
  const repair: StageState = completed ? "done" : held ? "paused" : working ? "current" : "pending";
  const verify: StageState = verified ? "done" : completed ? "unknown" : "pending";
  const complete: StageState = completed ? "done" : "pending";

  return {
    stages: [
      { id: "claim", state: claim },
      { id: "diagnose", state: diagnose },
      { id: "repair", state: repair },
      { id: "verify", state: verify },
      { id: "complete", state: complete },
    ],
    cancelled: false,
  };
}

export type NextStepId =
  | "claim"
  | "start"
  | "continue"
  | "reviewHold"
  | "resume"
  | "viewRecord"
  | "cancelled"
  | "viewOnly"
  | "elsewhere";

/** The headline for Overview, taken from the same derived actions the sticky bar uses so the two never disagree. */
export function deriveNextStep(wo: Pick<WorkOrder, "status">, actions: RepairActions): NextStepId {
  if (wo.status === "completed") return "viewRecord";
  if (wo.status === "cancelled") return "cancelled";
  if (actions.block === "viewOnly") return "viewOnly";
  if (actions.block === "claimedElsewhere") return "elsewhere";
  if (actions.primary === "claim") return "claim";
  if (actions.primary === "start") return "start";
  if (actions.primary === "resumeWork") return wo.status === "on_hold" ? "reviewHold" : "resume";
  if (actions.primary === "complete") return "continue";
  return "viewOnly";
}
