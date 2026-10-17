import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { dayPartOf, type DayPart } from "@/lib/housekeeping/homeText";
import type { AttentionSeverity, SupervisorAttentionItem } from "@/lib/housekeeping/supervisorAttention";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";
import type { StaffPulseMember, TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import { supervisorHref } from "@/lib/navigation/supervisorRoutes";

/* ─── Supervisor Today — presentation rules ─────────────────────────────────
   Pure mapping from the Phase 1 model to what the screen says. No React, no
   I/O: everything a person reads on Today is decided here and unit-tested. */

type IconName = ComponentProps<typeof Ionicons>["name"];

export function greetingPart(zone: string | null | undefined, now: Date): DayPart {
  return dayPartOf(zone, now);
}

/* ─── Freshness ───────────────────────────────────────────────────────────── */

export type Freshness =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "fresh"; minutes: number }
  | { kind: "stale"; reason: "offline" | "age" | "refresh_failed"; at: number };

/** Only states the app can substantiate: a verified time, or none. */
export function describeFreshness(state: SourceState<unknown>, now: number): Freshness {
  switch (state.status) {
    case "loading":
      return { kind: "loading" };
    case "failed":
      return { kind: "unavailable" };
    case "stale":
      return { kind: "stale", reason: state.reason, at: state.fetchedAt };
    default:
      return { kind: "fresh", minutes: Math.max(0, Math.floor((now - state.fetchedAt) / 60_000)) };
  }
}

export function freshnessTime(at: number, zone: string | null | undefined, language: string): string {
  return formatHotelTime(new Date(at), zone, language) ?? "";
}

/* ─── Attention rows ──────────────────────────────────────────────────────── */

export interface AttentionRowView {
  id: string;
  icon: IconName;
  severity: AttentionSeverity;
  title: { key: string; params: Record<string, string | number> };
  subtitle: { key: string; params: Record<string, string | number> };
  pathname: string;
}

const V = "supervisorToday.attention";
const str = (value: string | number | null | undefined, fallback: string | number = "") => (value === null || value === undefined ? fallback : value);

/** Copy + destination for one item, or null for a kind Today has no wording for (never an empty row). */
export function describeAttention(
  item: SupervisorAttentionItem,
  ctx: { zone: string | null | undefined; language: string; someone: string },
): AttentionRowView | null {
  const p = item.explain.params;
  const base = { id: item.id, severity: item.severity, pathname: supervisorHref(item.target).pathname };
  switch (item.kind) {
    case "arrival_at_risk": {
      const time = typeof p.arrivalAt === "string" ? formatHotelTime(p.arrivalAt, ctx.zone, ctx.language) : null;
      return {
        ...base,
        icon: "alarm-outline",
        title: { key: `${V}.roomNeedsAttention`, params: { room: str(p.room) } },
        subtitle: time
          ? { key: `${V}.arrivalAt`, params: { time } }
          : { key: `${V}.arrivalNotReady`, params: {} },
      };
    }
    case "readiness_risk":
      return {
        ...base,
        icon: "warning-outline",
        title: { key: `${V}.roomAtRisk`, params: { room: str(p.room) } },
        subtitle: { key: `${V}.roomAtRiskHint`, params: {} },
      };
    case "task_blocker":
      return {
        ...base,
        icon: "hand-left-outline",
        title: { key: `${V}.taskBlocked`, params: { task: str(p.task, "—") } },
        subtitle: { key: `tasks.hk.blocker.reason.${str(p.reason, "other")}`, params: {} },
      };
    case "shift_ended_with_open_rooms":
      return {
        ...base,
        icon: "log-out-outline",
        title: { key: `${V}.shiftEndedTitle`, params: { name: str(p.name, ctx.someone) } },
        subtitle: { key: `${V}.shiftEndedHint`, params: { count: str(p.count, 0) } },
      };
    case "workload_over_assigned":
      return {
        ...base,
        icon: "barbell-outline",
        title: { key: `${V}.overAssignedTitle`, params: { name: str(p.name, ctx.someone) } },
        subtitle: { key: `${V}.overAssignedHint`, params: {} },
      };
    case "unassigned_rooms":
      return {
        ...base,
        icon: "person-add-outline",
        title: { key: `${V}.unassigned`, params: { count: str(p.count, 0) } },
        subtitle: { key: `${V}.unassignedHint`, params: {} },
      };
    case "awaiting_inspection":
      return {
        ...base,
        icon: "shield-checkmark-outline",
        title: { key: `${V}.awaitingInspection`, params: { count: str(p.count, 0) } },
        subtitle: { key: `${V}.awaitingInspectionHint`, params: {} },
      };
    case "access_restricted":
      return {
        ...base,
        icon: "ban-outline",
        title: { key: `${V}.accessRestricted`, params: { count: str(p.count, 0) } },
        subtitle: { key: `${V}.accessRestrictedHint`, params: {} },
      };
    default:
      return null;
  }
}

/* ─── Team preview ────────────────────────────────────────────────────────── */

export interface TeamPreview {
  rows: StaffPulseMember[];
  /** People with rooms who did not fit in the preview. */
  hiddenCount: number;
  /** Housekeepers on the staff list with no rooms today; null when the staff list is unknown. */
  withoutRooms: number | null;
}

/**
 * People with rooms, most in need first. "In need" is only what the data proves: a recorded clock-out with
 * rooms still open, or a workload over a standard shift. Then the most rooms left to do.
 */
export function selectTeamPreview(pulse: TeamPulse, limit = 3): TeamPreview {
  const withRooms = pulse.members.filter((member) => member.load && member.load.total > 0);
  const remaining = (member: StaffPulseMember) => (member.load ? member.load.total - member.load.done : 0);
  const ranked = [...withRooms].sort(
    (a, b) =>
      Number(Boolean(b.concern)) - Number(Boolean(a.concern)) ||
      remaining(b) - remaining(a) ||
      (a.name ?? "~").localeCompare(b.name ?? "~", undefined, { sensitivity: "base" }),
  );
  const staffKnown = pulse.members.some((member) => member.role !== null);
  return {
    rows: ranked.slice(0, limit),
    hiddenCount: Math.max(0, ranked.length - limit),
    withoutRooms: staffKnown
      ? pulse.members.filter((member) => member.role === "housekeeper" && !(member.load && member.load.total > 0)).length
      : null,
  };
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The freshness line under the readiness card; null while there is nothing true to say yet. */
export function freshnessLabel(
  freshness: Freshness,
  t: Translate,
  zone: string | null | undefined,
  language: string,
): string | null {
  switch (freshness.kind) {
    case "loading":
      return t("supervisorToday.freshness.updating");
    case "unavailable":
      return null;
    case "fresh":
      return freshness.minutes < 1
        ? t("supervisorToday.freshness.justNow")
        : t("supervisorToday.freshness.minutes", { count: freshness.minutes });
    case "stale": {
      const time = freshnessTime(freshness.at, zone, language);
      const key = freshness.reason === "offline" ? "offline" : freshness.reason === "refresh_failed" ? "refreshFailed" : "age";
      return t(`supervisorToday.freshness.${key}`, { time });
    }
  }
}
