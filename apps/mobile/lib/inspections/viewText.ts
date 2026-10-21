import type { SourceState } from "@/lib/housekeeping/supervisorSources";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { describeAge } from "@/lib/housekeeping/roomBoardView";
import type { CorrectionItem } from "@/lib/inspections/lists";
import type { QueueItem } from "@/lib/inspections/queue";
import { cleanKindOf, priorityFacts, type PriorityFacts, type QueueContext } from "@/lib/inspections/queueView";

/* ─── Words for the Inspections screen (pure) ───────────────────────────────
   Every sentence is built here from verified facts, so what the screen says can be tested without rendering it. A
   fact the app does not have is left out or called "not recorded" - never filled with a stand-in. */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "18 min ago" / "2h 5m ago". Null when the time is unknown. */
export function agoText(ms: number | null, now: number, t: Translate): string | null {
  if (ms === null) return null;
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return t("inspect.card.agoNow");
  if (minutes < 60) return t("inspect.card.agoMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("inspect.card.agoHours", { hours }) : t("inspect.card.agoHoursMinutes", { hours, minutes: rest });
}

/* ─── Header status ─────────────────────────────────────────────────────────── */

export type StatusTone = "live" | "busy" | "warn";

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

/**
 * "Live" only when a recent server answer says so. Connected-but-unverified is not live, and a failed first load
 * says it could not check - it does not say the queue is empty.
 */
export function statusLine(source: SourceState<unknown>, now: number, timeZone: string | null | undefined, language: string, t: Translate): StatusLine {
  const clock = (fetchedAt: number) => formatHotelTime(new Date(fetchedAt), timeZone, language) ?? "—";
  switch (source.status) {
    case "loading":
      return { text: t("inspect.status.loading"), tone: "busy" };
    case "failed":
      return { text: source.failure.kind === "offline" ? t("inspect.status.offlineNone") : t("inspect.status.unavailable"), tone: "warn" };
    case "stale":
      return {
        text: source.reason === "offline" ? t("inspect.status.offline", { time: clock(source.fetchedAt) }) : t("inspect.status.stale", { time: clock(source.fetchedAt) }),
        tone: "warn",
      };
    case "available":
    case "empty": {
      const age = describeAge(now - source.fetchedAt);
      if (age === null) return { text: t("inspect.status.liveClock", { time: clock(source.fetchedAt) }), tone: "live" };
      if (age.unit === "now") return { text: t("inspect.status.liveNow"), tone: "live" };
      return {
        text: t(age.unit === "seconds" ? "inspect.status.liveSeconds" : "inspect.status.liveMinutes", { count: age.value }),
        tone: "live",
      };
    }
  }
}

/** The banner above a list that is showing data which is no longer verified; null when it is verified or absent. */
export function staleBanner(source: SourceState<unknown>, timeZone: string | null | undefined, language: string, t: Translate): string | null {
  if (source.status !== "stale") return null;
  const time = formatHotelTime(new Date(source.fetchedAt), timeZone, language) ?? "—";
  const key = source.reason === "offline" ? "inspect.banner.offline" : source.reason === "refresh_failed" ? "inspect.banner.refreshFailed" : "inspect.banner.stale";
  return t(key, { time });
}

/* ─── Summary metrics ───────────────────────────────────────────────────────── */

export interface Metric {
  /** null = unknown (loading, failed, never verified). A verified zero is 0. */
  value: number | null;
  /** The count is a lower bound (the server returned a truncated list). */
  atLeast: boolean;
}

export function metricText(metric: Metric, t: Translate): { text: string; a11y: string } {
  if (metric.value === null) return { text: t("inspect.metric.unavailable"), a11y: t("inspect.metric.unavailableA11y") };
  return metric.atLeast
    ? { text: t("inspect.metric.atLeast", { count: metric.value }), a11y: t("inspect.metric.atLeastA11y", { count: metric.value }) }
    : { text: String(metric.value), a11y: String(metric.value) };
}

/* ─── The queue card ─────────────────────────────────────────────────────────── */

export type BadgeKey = "overdue" | "reinspection" | "arrival" | "vip" | "priority";

export function badgeFor(facts: PriorityFacts): BadgeKey | null {
  if (facts.overdue) return "overdue";
  if (facts.reinspection) return "reinspection";
  if (facts.arrivalTodayMs !== null) return "arrival";
  if (facts.vip) return "vip";
  if (facts.elevatedPriority !== null) return "priority";
  return null;
}

export interface CardText {
  badge: BadgeKey | null;
  /** "Departure · Floor 2", or null when nothing about the room's kind or place is recorded. */
  where: string | null;
  who: string;
  /** Arrival / VIP / needed-by line, when recorded. */
  note: string | null;
  failedItems: string | null;
  reinspection: boolean;
  /** One sentence for screen readers. */
  summary: string;
}

export function cardText(item: QueueItem, ctx: QueueContext, language: string, showBuilding: boolean, t: Translate): CardText {
  const facts = priorityFacts(item, ctx);
  const kind = cleanKindOf(item.cleanType);
  const whereParts = [
    kind ? t(`inspect.card.clean.${kind}`) : null,
    showBuilding && item.building ? t("inspect.card.building", { building: item.building }) : null,
    item.floor !== null ? t("inspect.card.floor", { floor: item.floor }) : null,
  ].filter((part): part is string => Boolean(part));
  const name = item.cleanedBy.trim() || t("inspect.card.housekeeperUnknown");
  const ago = agoText(item.cleanedAtMs, ctx.now, t);
  const who = item.reinspection.isReinspection
    ? ago
      ? t("inspect.card.resubmitted", { name, time: ago })
      : t("inspect.card.cleanTimeUnknown", { name })
    : ago
      ? t("inspect.card.cleanedAgo", { name, time: ago })
      : t("inspect.card.cleanTimeUnknown", { name });
  const arrivalClock = facts.arrivalTodayMs !== null ? formatHotelTime(new Date(facts.arrivalTodayMs), ctx.timeZone, language) : null;
  const note = arrivalClock
    ? t(facts.arrivalPassed ? "inspect.card.arrivalPassed" : "inspect.card.arrival", { time: arrivalClock })
    : facts.neededByPassed
      ? t("inspect.card.neededByPassed")
      : facts.vip
        ? t("inspect.card.vipLine")
        : null;
  const failedCount = item.reinspection.failedItems.length;
  const failedItems = item.reinspection.isReinspection && failedCount > 0 ? t("inspect.card.failedItems", { count: failedCount }) : null;
  const badge = badgeFor(facts);
  const where = whereParts.length > 0 ? whereParts.join(" · ") : null;
  const summary = [badge ? t(`inspect.card.badge.${badge}`) : null, where, who, note, failedItems].filter(Boolean).join(". ");
  return { badge, where, who, note, failedItems, reinspection: item.reinspection.isReinspection, summary };
}

/* ─── The correction card ────────────────────────────────────────────────────── */

export interface CorrectionText {
  owner: string;
  failed: string;
  detail: string;
  updated: string | null;
  kind: string | null;
  summary: string;
}

export function correctionText(item: CorrectionItem, now: number, t: Translate): CorrectionText {
  const owner =
    item.owner.kind === "named" ? t("inspect.correction.owner", { name: item.owner.name }) : item.owner.kind === "unnamed" ? t("inspect.correction.ownerUnnamed") : t("inspect.correction.unassigned");
  const failed = item.failedCount > 0 ? t("inspect.correction.failedCount", { count: item.failedCount }) : t("inspect.correction.failedNone");
  const ago = agoText(item.latestAtMs, now, t);
  const updated = ago ? t("inspect.correction.updated", { time: ago }) : null;
  const detail = t(`inspect.correction.detail.${item.status}`);
  const kind = item.kind ? t(`inspect.correction.kind.${item.kind}`) : null;
  const summary = [t(`inspect.correction.status.${item.stage}`), detail, failed, owner, updated].filter(Boolean).join(". ");
  return { owner, failed, detail, updated, kind, summary };
}
