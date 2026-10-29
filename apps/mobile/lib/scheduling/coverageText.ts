import type { CoverageCandidate, CoverageFailure, CoverageGap } from "@/lib/api/schedulingCoverage";
import { formatWallClock, hotelDayOf } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";

/* Words for the call-out and coverage screens. Pure functions of server facts plus `t`; nothing here decides whether
   a person may take a shift (the server does) or invents a number. */

/** "7:00 AM–3:00 PM", or "… (next day)" when the shift runs past midnight. */
export function gapWindow(gap: Pick<CoverageGap, "workDate" | "startTime" | "endTime" | "startsAt" | "endsAt">, zone: string | null, language: string | undefined, t: Translate): string {
  const endDay = hotelDayOf(gap.endsAt, zone) ?? gap.workDate;
  const start = formatWallClock(gap.workDate, gap.startTime, gap.startsAt, zone, language);
  const end = formatWallClock(endDay, gap.endTime, gap.endsAt, zone, language);
  return t(endDay > gap.workDate ? "teamSchedule.windowNextDay" : "teamSchedule.window", { start, end });
}

export function gapTitle(gap: Pick<CoverageGap, "shiftName">, t: Translate): string {
  return gap.shiftName || t("teamSchedule.coverage.shiftFallback");
}

export function gapStatusLabel(gap: Pick<CoverageGap, "status" | "pendingOffers" | "pendingClaims">, t: Translate): string {
  if (gap.status === "open" && gap.pendingClaims > 0) return t("teamSchedule.coverage.status.claimed");
  return t(`teamSchedule.coverage.status.${gap.status}`);
}

export function requiredRoleText(role: string | null, t: Translate): string {
  return role ? roleLabel(role, t) : t("teamSchedule.coverage.anyRole");
}

/** Why a candidate is ruled out or flagged: every code the server sends has words, unknown ones a safe fallback. */
export function candidateFlagText(code: string, t: Translate): string {
  return t(`teamSchedule.coverage.flag.${code}`, { defaultValue: t("teamSchedule.coverage.flag.other") });
}

/** The one-line label on a candidate card. Never "available": a person with no shift has not agreed to work. */
export function candidateSummary(candidate: Pick<CoverageCandidate, "eligible" | "blockers" | "warnings">, t: Translate): string {
  if (!candidate.eligible) return candidateFlagText(candidate.blockers[0] ?? "other", t);
  const real = candidate.warnings.filter((w) => w !== "availability_unknown");
  return real.length > 0 ? t("teamSchedule.coverage.summary.warnings") : t("teamSchedule.coverage.summary.eligible");
}

/** Warnings a supervisor must acknowledge before assigning (mirrors the server's ACK_WARNINGS). */
export const ACK_WARNINGS: readonly string[] = ["insufficient_rest", "weekly_overtime", "long_shift", "pending_offer_elsewhere", "currently_clocked_in"];

export function warningsToAcknowledge(candidate: Pick<CoverageCandidate, "warnings">): string[] {
  return candidate.warnings.filter((w) => ACK_WARNINGS.includes(w));
}

export function failureText(failure: CoverageFailure, t: Translate): string {
  return t(`teamSchedule.coverage.failure.${failure.key}`, { defaultValue: t("teamSchedule.coverage.failure.other") });
}

export function minutesText(minutes: number, t: Translate): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("teamSchedule.coverage.minutes", { count: rest });
  return rest === 0 ? t("teamSchedule.coverage.hours", { count: hours }) : t("teamSchedule.coverage.hoursMinutes", { hours, minutes: rest });
}
