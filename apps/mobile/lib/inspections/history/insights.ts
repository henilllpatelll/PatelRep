import type { InsightDay, Insights } from "@/lib/api/inspectionHistory";

/* ─── Quality insights — what the screen may claim (pure) ───────────────────
   The server computes the numbers (definitions are in services/inspection_history.py). This decides which of them are
   safe to SHOW: a rate with no denominator, a cut-off period, or a handful of records is explained instead of printed. */

/** Below this many failed inspections, repeated-issue lists say the data is too thin to conclude anything. */
export const SPARSE_FAILURES = 3;
/** Below this many initial inspections a first-pass rate is shown but flagged as a small sample. */
export const SMALL_SAMPLE = 5;

export type RateView =
  | { kind: "value"; percent: number; passed: number; eligible: number; smallSample: boolean }
  /** No rate: nothing to divide by, or the period was cut off so the denominator would be partial. */
  | { kind: "none"; reason: "no_initial" | "truncated" };

/** A whole-number percent that never rounds a non-perfect rate up to 100. */
export function percentOf(rate: number): number {
  const rounded = Math.round(rate * 100);
  return rate < 1 && rounded >= 100 ? 99 : rounded;
}

export function rateView(insights: Insights): RateView {
  if (insights.truncated) return { kind: "none", reason: "truncated" };
  const { rate, passed, eligible } = insights.first_pass;
  if (rate === null || eligible === 0) return { kind: "none", reason: "no_initial" };
  return { kind: "value", percent: percentOf(rate), passed, eligible, smallSample: eligible < SMALL_SAMPLE };
}

export interface InsightsView {
  /** Nothing was inspected in the period. */
  empty: boolean;
  completed: number;
  failed: number;
  reinspections: number;
  conditional: number;
  /** The period was cut off at the server's bound: counts are a floor and rates are withheld. */
  truncated: boolean;
  rate: RateView;
  /** Records from before reinspection links: re-checks among them are counted as initial. */
  withoutLineage: number;
  conditionalExcluded: number;
  sparse: boolean;
  topStandards: Insights["top_standards"];
  repeatRooms: Insights["repeat_rooms"];
  repeatStandards: Insights["repeat_standards"];
  corrections: Insights["corrections"] & { shown: boolean };
  verification: { available: boolean; medianMinutes: number | null; sample: number; minimum: number };
  unidentifiedFailures: number;
}

export function buildInsightsView(insights: Insights): InsightsView {
  const failed = insights.counts.failed;
  return {
    empty: insights.counts.completed === 0,
    completed: insights.counts.completed,
    failed,
    reinspections: insights.counts.reinspections,
    conditional: insights.counts.conditional,
    truncated: insights.truncated,
    rate: rateView(insights),
    withoutLineage: insights.counts.without_lineage,
    conditionalExcluded: insights.first_pass.conditional_excluded,
    sparse: failed < SPARSE_FAILURES,
    topStandards: insights.top_standards,
    repeatRooms: insights.repeat_rooms,
    repeatStandards: insights.repeat_standards,
    corrections: { ...insights.corrections, shown: insights.corrections.failed > 0 },
    verification: {
      available: insights.time_to_verification.available,
      medianMinutes: insights.time_to_verification.median_minutes,
      sample: insights.time_to_verification.sample,
      minimum: insights.time_to_verification.minimum_sample,
    },
    unidentifiedFailures: insights.failed_answers_unidentified,
  };
}

/* ─── The trend chart's data ─────────────────────────────────────────────── */

export interface TrendPoint {
  date: string;
  /** 0..100, or null: a day with no initial inspections has no rate - it is a gap, never a 0% bar. */
  percent: number | null;
  passed: number;
  failed: number;
}

export interface Trend {
  points: TrendPoint[];
  /** Days that have a rate. A trend needs at least two to say anything. */
  withData: number;
}

export function buildTrend(daily: readonly InsightDay[], truncated: boolean): Trend | null {
  if (truncated || daily.length < 2) return null;
  const points = daily.map(
    (day): TrendPoint => ({
      date: day.date,
      percent: day.first_pass_rate === null ? null : percentOf(day.first_pass_rate),
      passed: day.initial_passed,
      failed: day.initial_failed,
    }),
  );
  const withData = points.filter((point) => point.percent !== null).length;
  return withData >= 2 ? { points, withData } : null;
}

/** "1 h 5 min" style pieces for a duration in minutes. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
