import type { TaskDraft, ActionPreview } from "@/lib/ai/drafts";
import { fetchedAtOf, knownValue } from "@/lib/housekeeping/supervisorSources";
import { primaryFor } from "@/lib/housekeeping/supervisorAttentionCenter";
import {
  selectAttentionPreview,
  type SupervisorAttentionItem,
  type SupervisorAttentionKind,
} from "@/lib/housekeeping/supervisorAttention";
import type { SupervisorToday, TodaySources } from "@/lib/housekeeping/supervisorToday";
import { describeAttention, type AttentionRowView } from "@/lib/housekeeping/supervisorTodayView";
import type { SupervisorHref } from "@/lib/navigation/supervisorRoutes";

/* ─── Supervisor Copilot — what the assistant can say without asking a model ─
   Everything here is composed from the same Today snapshot the dashboard, Attention Center and Shift
   Handoff already use (no second metric calculation, no fetch, no model). A source that could not be read
   is "unknown" and is named as such; it is never treated as zero or "all clear". The only things that may
   ever come from a language model are the optional wording in supervisorSummaryAi.ts, which can only
   re-word the figures built here. */

export const MAX_OBSERVATIONS = 3;
export const MAX_SUGGESTIONS = 4;

export type CopilotSourceKey = keyof TodaySources;
export type SourceAvailability = "verified" | "stale" | "loading" | "unavailable";

export const SOURCE_LABEL_KEY: Record<CopilotSourceKey, string> = {
  board: "supervisorCopilot.sources.board",
  staff: "supervisorCopilot.sources.staff",
  roster: "supervisorCopilot.sources.roster",
  inspections: "supervisorCopilot.sources.inspections",
  blockedTasks: "supervisorCopilot.sources.blockedTasks",
};

export interface ProvenanceEntry {
  source: CopilotSourceKey;
  availability: SourceAvailability;
  /** Epoch ms of the last verified answer, or null when there never was one. */
  fetchedAt: number | null;
}

export interface OverviewLine {
  id: string;
  key: string;
  params: Record<string, string | number>;
  /** A line about something the app could not check; shown plainly, never as a number. */
  unknown?: boolean;
}

export interface Observation {
  id: string;
  kind: SupervisorAttentionKind;
  view: AttentionRowView;
}

export type CopilotSuggestion =
  /** Opens an existing supervisor workflow. Never changes anything. */
  | { id: string; type: "open"; labelKey: string; href: SupervisorHref; why: AttentionRowView }
  /** Prepares an editable task for a room that is on the verified board. Nothing exists until it is confirmed. */
  | { id: string; type: "draft_task"; room: { id: string; number: string }; reason: SupervisorAttentionKind };

export interface SupervisorCopilotModel {
  generatedAt: number;
  overview: OverviewLine[];
  observations: Observation[];
  suggestions: CopilotSuggestion[];
  provenance: ProvenanceEntry[];
  /** Sources with no answer at all (loading or failed). Their absence is stated, never read as zero. */
  unverified: CopilotSourceKey[];
  /** True only when the board answered; with no board there is nothing true to summarise. */
  boardKnown: boolean;
  /** Every source was verified now and nothing needs attention: a real "nothing to report". */
  allClear: boolean;
}

function availabilityOf(state: TodaySources[CopilotSourceKey]): SourceAvailability {
  switch (state.status) {
    case "available":
    case "empty":
      return "verified";
    case "stale":
      return "stale";
    case "loading":
      return "loading";
    default:
      return "unavailable";
  }
}

export interface DescribeContext {
  zone: string | null | undefined;
  language: string;
  someone: string;
}

const ROOM_KINDS: ReadonlySet<SupervisorAttentionKind> = new Set(["arrival_at_risk", "readiness_risk"]);

/** The one room a follow-up task could be about: the most important item that is about a single board room. */
function draftTarget(items: SupervisorAttentionItem[]): { id: string; number: string; kind: SupervisorAttentionKind } | null {
  for (const item of items) {
    if (!ROOM_KINDS.has(item.kind) || item.subject.type !== "room") continue;
    const ref = item.records.find((record) => record.type === "room" && record.id === item.subject.id);
    if (ref?.label) return { id: ref.id, number: ref.label, kind: item.kind };
  }
  return null;
}

export function buildSupervisorCopilot(today: SupervisorToday, ctx: DescribeContext): SupervisorCopilotModel {
  const provenance: ProvenanceEntry[] = (Object.keys(today.sources) as CopilotSourceKey[]).map((source) => ({
    source,
    availability: availabilityOf(today.sources[source]),
    fetchedAt: fetchedAtOf(today.sources[source]),
  }));
  const unverified = provenance
    .filter((entry) => entry.availability === "loading" || entry.availability === "unavailable")
    .map((entry) => entry.source);
  const boardKnown = knownValue(today.sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 }) !== null;

  const overview: OverviewLine[] = [];
  const readiness = today.readiness.value;
  if (readiness) {
    overview.push({ id: "ready", key: "supervisorCopilot.overview.ready", params: { ready: readiness.ready, total: readiness.inService } });
    if (readiness.awaitingInspection > 0) {
      overview.push({ id: "inspection", key: "supervisorCopilot.overview.awaitingInspection", params: { count: readiness.awaitingInspection } });
    }
    overview.push(
      readiness.unassignedActionable > 0
        ? { id: "unassigned", key: "supervisorCopilot.overview.unassigned", params: { count: readiness.unassignedActionable } }
        : { id: "unassigned", key: "supervisorCopilot.overview.allAssigned", params: {} },
    );
  } else {
    overview.push({ id: "board", key: "supervisorCopilot.overview.boardUnknown", params: {}, unknown: true });
  }
  const inspections = today.inspections.value;
  if (inspections && inspections.total > 0) {
    overview.push({
      id: "inspectionResults",
      key: "supervisorCopilot.overview.inspectionResults",
      params: { passed: inspections.passed, failed: inspections.failed },
    });
  } else if (!inspections) {
    overview.push({ id: "inspectionResults", key: "supervisorCopilot.overview.inspectionsUnknown", params: {}, unknown: true });
  }

  const preview = selectAttentionPreview(today.attention, MAX_OBSERVATIONS);
  const observations: Observation[] = [];
  for (const item of preview.items) {
    const view = describeAttention(item, ctx);
    if (view) observations.push({ id: item.id, kind: item.kind, view });
  }

  const suggestions: CopilotSuggestion[] = [];
  const seenDestinations = new Set<string>();
  for (const item of preview.items) {
    const view = describeAttention(item, ctx);
    if (!view) continue;
    const primary = primaryFor(item);
    const destination = `${primary.href.pathname}:${primary.href.params?.roomId ?? ""}`;
    if (seenDestinations.has(destination)) continue;
    seenDestinations.add(destination);
    suggestions.push({ id: `open:${item.id}`, type: "open", labelKey: primary.labelKey, href: primary.href, why: view });
  }
  const target = draftTarget(today.attention.items);
  if (target) suggestions.push({ id: `draft:${target.id}`, type: "draft_task", room: { id: target.id, number: target.number }, reason: target.kind });

  const everythingVerified = provenance.every((entry) => entry.availability === "verified");
  return {
    generatedAt: today.generatedAt,
    overview,
    observations,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    provenance,
    unverified,
    boardKnown,
    allClear: everythingVerified && today.attention.items.length === 0 && today.attention.unverified.length === 0,
  };
}

/* ─── Room context ────────────────────────────────────────────────────────── */

export interface CopilotRoomContext {
  roomId: string;
  roomNumber: string;
}

/**
 * The room the assistant was opened about, re-checked against the current verified board. A room that is
 * no longer on the board (or a board that is unknown) is "gone": the chip says so and nothing is sent for it.
 */
export function resolveRoomContext(
  context: CopilotRoomContext | null,
  sources: TodaySources,
): { state: "none" } | { state: "ok"; room: CopilotRoomContext } | { state: "gone"; roomNumber: string } {
  if (!context) return { state: "none" };
  const board = knownValue(sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 });
  const match = board?.rooms.find((room) => room.roomId === context.roomId);
  return match ? { state: "ok", room: { roomId: match.roomId, roomNumber: match.roomNumber } } : { state: "gone", roomNumber: context.roomNumber };
}

/* ─── Follow-up task draft ────────────────────────────────────────────────── */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * An editable task for one verified board room, composed on the phone (no model, no credit). It is only a
 * preview: the existing confirm flow creates it after the person reviews and confirms, and the server
 * re-verifies the room. Priority is raised only for the kind of item that is time-bound by a record.
 */
export function buildFollowUpDraft(
  room: { id: string; number: string },
  reason: SupervisorAttentionKind | null,
  t: Translate,
): ActionPreview {
  const draft: TaskDraft = {
    title: t("supervisorCopilot.draft.title", { room: room.number }).slice(0, 120),
    description: t(`supervisorCopilot.draft.reason.${reason === "arrival_at_risk" || reason === "readiness_risk" ? reason : "general"}`, {
      room: room.number,
    }),
    taskType: "housekeeping",
    priority: reason === "arrival_at_risk" ? "urgent" : "normal",
    roomNumber: room.number,
    roomId: room.id,
  };
  return { kind: "task", draft };
}

/* ─── Who may use this ────────────────────────────────────────────────────── */

/** The paid wording and handoff drafting are for supervisors only; every other role keeps what it has. */
export function isSupervisorCopilotRole(role: string | null | undefined): boolean {
  return role === "housekeeping_supervisor";
}
