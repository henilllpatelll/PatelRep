import type { Forecast, ForecastAction, ForecastDay, ForecastFact, ForecastRecommendation, ForecastSource } from "@/lib/api/schedulingForecast";
import type { Translate } from "@/lib/scheduling/teamScheduleText";

/* ─── Staffing Forecast — what the screen says ───────────────────────────────
   Pure: the server's forecast → words, tones and navigation targets. It never computes staffing: every number shown
   comes from the server, and a figure the server could not know is shown as "not available", never as 0. */

export type ForecastTone = "ok" | "warn" | "neutral";

/** "5 h 30 min", "2 h", "45 min". Whole minutes only; a fraction is never shown as precision the forecast does not have. */
export function durationText(minutes: number, t: Translate): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return t("teamSchedule.forecast.duration.hm", { h, m });
  return h > 0 ? t("teamSchedule.forecast.duration.h", { h }) : t("teamSchedule.forecast.duration.m", { m });
}

/** A known figure as text; null when the server did not know it. */
export function factText(fact: ForecastFact, t: Translate): string | null {
  return fact.value === null ? null : durationText(fact.value, t);
}

export function reasonText(reason: string | null, t: Translate): string {
  return t(`teamSchedule.forecast.reasons.${reason ?? "unknown"}`, { defaultValue: t("teamSchedule.forecast.reasons.unknown") });
}

export function limitationText(code: string, t: Translate): string | null {
  const key = `teamSchedule.forecast.limitations.${code}`;
  const text = t(key, { defaultValue: "" });
  return text && text !== key ? text : null;
}

export interface Hero {
  tone: ForecastTone;
  icon: "warning-outline" | "checkmark-circle-outline" | "help-circle-outline";
  title: string;
  body: string;
  badge: string;
}

/** The one coverage statement for a day, generated from the server's result. */
export function heroFor(day: ForecastDay, t: Translate): Hero {
  const badge = t(`teamSchedule.forecast.quality.${day.quality}`);
  if (day.status === "short" && day.headline.gapMinutes !== null) {
    const duration = durationText(day.headline.gapMinutes, t);
    return {
      tone: "warn",
      icon: "warning-outline",
      title: t("teamSchedule.forecast.hero.short.title"),
      body: t(day.headline.isMinimum ? "teamSchedule.forecast.hero.short.bodyMin" : "teamSchedule.forecast.hero.short.body", { duration }),
      badge,
    };
  }
  if (day.status === "sufficient") {
    const capacity = factText(day.capacity.productive, t);
    const demand = factText(day.demand.minutes, t);
    return {
      tone: "ok",
      icon: "checkmark-circle-outline",
      title: t("teamSchedule.forecast.hero.sufficient.title"),
      body: capacity && demand ? t("teamSchedule.forecast.hero.sufficient.body", { capacity, demand }) : t("teamSchedule.forecast.hero.sufficient.bodyPlain"),
      badge,
    };
  }
  return { tone: "neutral", icon: "help-circle-outline", title: t("teamSchedule.forecast.hero.unknown.title"), body: reasonText(day.headline.reason, t), badge };
}

export interface Metric {
  key: "demand" | "capacity" | "gap" | "rooms" | "staff";
  label: string;
  /** null = not available (shown as such, never as 0). */
  value: string | null;
  note: string | null;
}

export function metricsFor(day: ForecastDay, t: Translate): Metric[] {
  const demand = factText(day.demand.minutes, t);
  const lowerBound = day.demand.minutes.value !== null && !day.demand.complete;
  const gapText =
    day.gap.minutes === null || day.status === "unknown"
      ? null
      : durationText(Math.abs(day.gap.minutes), t);
  return [
    {
      key: "demand",
      label: t("teamSchedule.forecast.metrics.demand"),
      value: demand,
      note: lowerBound ? t("teamSchedule.forecast.metrics.demandMinimum") : null,
    },
    {
      key: "capacity",
      label: t("teamSchedule.forecast.metrics.capacity"),
      value: factText(day.capacity.productive, t),
      note: t(day.capacity.measuredFrom === "now" ? "teamSchedule.forecast.metrics.capacityNow" : "teamSchedule.forecast.metrics.capacityDay"),
    },
    {
      key: "gap",
      label: t("teamSchedule.forecast.metrics.gap"),
      value: gapText === null ? null : t(day.status === "short" ? "teamSchedule.forecast.metrics.gapShort" : "teamSchedule.forecast.metrics.gapSpare", { duration: gapText }),
      note: day.gap.isMinimum ? t("teamSchedule.forecast.metrics.gapMinimum") : null,
    },
    {
      key: "rooms",
      label: t("teamSchedule.forecast.metrics.rooms"),
      value: day.demand.rooms === null ? null : String(day.demand.rooms),
      note: null,
    },
    {
      key: "staff",
      label: t("teamSchedule.forecast.metrics.staff"),
      value: day.capacity.people === null ? null : String(day.capacity.people),
      note: null,
    },
  ];
}

export interface OutlookRow {
  date: string;
  isToday: boolean;
  status: ForecastDay["status"];
  tone: ForecastTone;
  statusLabel: string;
  detail: string;
  openShifts: number;
  /** A projected shortage the supervisor can open from the Week view. */
  isShort: boolean;
}

export function outlookRow(day: ForecastDay, t: Translate): OutlookRow {
  const capacity = factText(day.capacity.productive, t);
  const demand = factText(day.demand.minutes, t);
  const parts: string[] = [];
  if (demand !== null) parts.push(t("teamSchedule.forecast.outlook.demandLine", { duration: demand }));
  else parts.push(t("teamSchedule.forecast.outlook.noDemand"));
  if (capacity !== null) parts.push(t("teamSchedule.forecast.outlook.capacityLine", { duration: capacity }));
  if (day.status === "short" && day.gap.minutes !== null) {
    parts.push(t(day.gap.isMinimum ? "teamSchedule.forecast.outlook.gapMin" : "teamSchedule.forecast.outlook.gap", { duration: durationText(Math.abs(day.gap.minutes), t) }));
  }
  return {
    date: day.date,
    isToday: day.isToday,
    status: day.status,
    tone: day.status === "short" ? "warn" : day.status === "sufficient" ? "ok" : "neutral",
    statusLabel: t(`teamSchedule.forecast.outlook.${day.status}`),
    detail: parts.join(" · "),
    openShifts: day.openGaps.length,
    isShort: day.status === "short",
  };
}

export function categoryLabel(category: string, t: Translate): string {
  return t(`teamSchedule.forecast.breakdown.${category}`, { defaultValue: t("teamSchedule.forecast.breakdown.other") });
}

export function sourceText(source: ForecastSource, t: Translate, whenText: string | null): string {
  const base = t(`teamSchedule.forecast.sources.${source.code}`, { defaultValue: t("teamSchedule.forecast.sources.unknown") });
  if (source.stale) return `${base} ${t("teamSchedule.forecast.sources.stale", { time: whenText ?? "" })}`.trim();
  return base;
}

export function capacityAssumption(day: ForecastDay, t: Translate): string {
  return t(day.capacity.breakPolicy === "scenario" ? "teamSchedule.forecast.assumptions.scenarioBreaks" : "teamSchedule.forecast.assumptions.noBreakPolicy");
}

/* ─── Recommendations ─────────────────────────────────────────────────────── */

export interface RecommendationText {
  id: string;
  title: string;
  why: string;
  basis: string;
  attention: boolean;
  actionLabel: string | null;
}

const COUNT_PARAM: Record<string, string> = {
  uncovered_shift: "",
  unresolved_callout: "count",
  shortfall: "additional_shifts",
  leave_conflict: "count",
  missing_estimates: "rooms",
  unassigned_rooms: "rooms",
  pending_leave: "count",
};

/** Words for one recommendation, or null for a kind this app has no explanation for (it is not shown unexplained). */
export function recommendationText(rec: ForecastRecommendation, t: Translate): RecommendationText | null {
  if (!(rec.kind in COUNT_PARAM)) return null;
  const countKey = COUNT_PARAM[rec.kind];
  const count = countKey ? Number(rec.params[countKey] ?? 0) : 0;
  const minimum = rec.params.is_minimum === true;
  const values = { ...rec.params, count, shift: rec.params.shift_name ?? t("teamSchedule.forecast.rec.aShift") };
  let titleKey = `teamSchedule.forecast.rec.${rec.kind}.title`;
  if (rec.kind === "shortfall") titleKey = count > 0 ? `${titleKey}Shifts` : titleKey;
  const whyKey = rec.kind === "shortfall" && minimum ? "teamSchedule.forecast.rec.shortfall.whyMin" : `teamSchedule.forecast.rec.${rec.kind}.why`;
  return {
    id: rec.id,
    title: t(titleKey, values),
    why: t(whyKey, values),
    basis: t(rec.basis === "verified" ? "teamSchedule.forecast.rec.basisVerified" : "teamSchedule.forecast.rec.basisEstimate"),
    attention: rec.severity === "attention",
    actionLabel: rec.action ? t(`teamSchedule.forecast.actions.${rec.action.type}`) : null,
  };
}

export type ForecastTarget =
  | { screen: "coverage"; gapId: string }
  | { screen: "schedule"; view: "today" | "week"; date: string | null; compose: "add" | null }
  | { screen: "requests" }
  | { screen: "assignments" };

/** Where an action leads. Every target is an existing screen; nothing here performs the action. */
export function targetFor(action: ForecastAction): ForecastTarget | null {
  switch (action.type) {
    case "find_coverage":
      return action.gapId ? { screen: "coverage", gapId: action.gapId } : null;
    case "add_shift":
      return { screen: "schedule", view: "today", date: action.date, compose: "add" };
    case "view_week":
      return { screen: "schedule", view: "week", date: action.date, compose: null };
    case "review_time_off":
      return { screen: "requests" };
    case "view_assignments":
      return { screen: "assignments" };
    default:
      return null;
  }
}

/* ─── Today / Week integration ────────────────────────────────────────────── */

export function dayOf(forecast: Forecast | null, date: string): ForecastDay | null {
  return forecast?.days.find((day) => day.date === date) ?? null;
}

export function dayIndex(forecast: Forecast | null): Readonly<Record<string, ForecastDay>> {
  return Object.fromEntries((forecast?.days ?? []).map((day) => [day.date, day]));
}
