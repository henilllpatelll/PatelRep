import type { Task } from "@/lib/api/tasks";
import { isClaimable, isMine, type Viewer } from "@/lib/tasks/taskActions";
import { formatWhen } from "@/lib/tasks/taskDisplay";
import { isOverdue } from "@/lib/tasks/workQueue";

/* ─── "Explain this task" ───────────────────────────────────────────────────
   A plain-language reading of the task exactly as it is stored: where it is, when it is due, how urgent it
   is, who has it, and the instructions as written. It is built on the phone from the task's own fields -- no
   model is involved, so it is free, works offline, and can not add a step, a reason or a promise the task
   does not contain. Where the task has no instructions it says so instead of filling the gap.

   Each line is an id the screen turns into a sentence (so English and Spanish read the same facts the same way)
   plus the values that sentence needs. Nothing here changes the task. */

export type ExplainId =
  | "what"
  | "whereRoom"
  | "wherePlace"
  | "whereNone"
  | "whenSet"
  | "whenOverdue"
  | "whenNone"
  | "priorityUrgent"
  | "priorityNormal"
  | "priorityLow"
  | "statusAvailable"
  | "statusMineOpen"
  | "statusMineStarted"
  | "statusOther"
  | "statusTeammate"
  | "statusUnassigned"
  | "statusCompleted"
  | "statusCancelled"
  | "blocked"
  | "details"
  | "detailsNone";

export interface ExplainLine {
  id: ExplainId;
  params: Record<string, string>;
}

/** Long instructions are shown in full on the detail sheet; the explanation only quotes the start. */
export const EXPLAIN_DETAILS_MAX = 400;

export interface ExplainContext {
  now: Date;
  zone: string | null;
  language: string;
  /** Translate a task type / blocker reason into the person's language (supplied by the screen). */
  typeLabel: string;
  blockerReason: string | null;
}

export function explainTask(task: Task, viewer: Viewer, context: ExplainContext): ExplainLine[] {
  const lines: ExplainLine[] = [{ id: "what", params: { title: task.title, type: context.typeLabel } }];

  if (task.room_number) lines.push({ id: "whereRoom", params: { room: task.room_number } });
  else if (task.location_text) lines.push({ id: "wherePlace", params: { place: task.location_text } });
  else lines.push({ id: "whereNone", params: {} });

  const open = task.status === "open" || task.status === "in_progress" || task.status === "escalated";
  const due = formatWhen(task.due_at, context.now, context.zone, context.language);
  if (due) lines.push({ id: open && isOverdue(task, context.now) ? "whenOverdue" : "whenSet", params: { time: due } });
  else lines.push({ id: "whenNone", params: {} });

  lines.push({ id: task.priority === "urgent" ? "priorityUrgent" : task.priority === "low" ? "priorityLow" : "priorityNormal", params: {} });

  if (task.status === "completed") lines.push({ id: "statusCompleted", params: {} });
  else if (task.status === "cancelled") lines.push({ id: "statusCancelled", params: {} });
  else if (isClaimable(task, viewer)) lines.push({ id: "statusAvailable", params: {} });
  else if (isMine(task, viewer)) lines.push({ id: task.status === "in_progress" ? "statusMineStarted" : "statusMineOpen", params: {} });
  else if (task.assigned_to_name) lines.push({ id: "statusOther", params: { name: task.assigned_to_name } });
  else if (task.assigned_to) lines.push({ id: "statusTeammate", params: {} });
  else lines.push({ id: "statusUnassigned", params: {} });

  if (task.blocker && open && context.blockerReason) lines.push({ id: "blocked", params: { reason: context.blockerReason } });

  const details = task.description?.trim();
  if (details) {
    lines.push({
      id: "details",
      params: { text: details.length > EXPLAIN_DETAILS_MAX ? `${details.slice(0, EXPLAIN_DETAILS_MAX).trimEnd()}…` : details },
    });
  } else {
    lines.push({ id: "detailsNone", params: {} });
  }
  return lines;
}

/** The assistant can only be pointed at a task the server will let this person read as context. */
export function canAskAssistantAbout(task: Task, viewer: Viewer): boolean {
  if (!viewer.userId) return false;
  return task.assigned_to === viewer.userId || task.created_by === viewer.userId;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The explanation as sentences in the person's language (the same ones everywhere it is shown). */
export function explainSentences(task: Task, viewer: Viewer, context: Omit<ExplainContext, "typeLabel" | "blockerReason">, t: Translate): string[] {
  const lines = explainTask(task, viewer, {
    ...context,
    typeLabel: t(`tasks.typeLabel.${task.task_type}`),
    blockerReason: task.blocker ? t(`tasks.hk.blocker.reason.${task.blocker.reason}`) : null,
  });
  return lines.map((line) => t(`tasks.hk.help.explain_${line.id}`, line.params));
}
