import { filterRange, type FilterChip, type HistoryFilters, type RangeProblem } from "@/lib/inspections/history/filters";
import type { InspectorOption } from "@/lib/api/inspectionHistory";
import type { Translate } from "@/lib/inspections/viewText";

/* ─── Words for the history period and filters (pure) ─────────────────────── */

function shortDate(ymd: string, language: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  // Built as UTC and read as UTC: a calendar day is the same on every phone, whatever its time zone.
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Today · Oct 21", "Oct 15 – Oct 21", "Oct 1 – Oct 20": the selected days, always shown in the hotel's own dates. */
export function periodLabel(filters: HistoryFilters, today: string, language: string, t: Translate): string {
  const range = filterRange(filters, today);
  if (!range) return t("inspect.history.period.invalid");
  const span = range.from === range.to ? shortDate(range.from, language) : t("inspect.history.period.range", { from: shortDate(range.from, language), to: shortDate(range.to, language) });
  switch (filters.period) {
    case "today":
      return t("inspect.history.period.todayLabel", { date: span });
    case "yesterday":
      return t("inspect.history.period.yesterdayLabel", { date: span });
    case "custom":
      return span;
    default:
      return t("inspect.history.period.presetLabel", { preset: t(`inspect.history.period.${filters.period}`), range: span });
  }
}

export function rangeProblemText(problem: RangeProblem | null, t: Translate): string | null {
  return problem ? t(`inspect.history.filter.problem.${problem}`) : null;
}

/** The text on an active-filter chip. An inspector chip names the person, never the id. */
export function chipText(chip: FilterChip, inspectors: readonly InspectorOption[], t: Translate): string {
  switch (chip.kind) {
    case "result":
      return t(`inspect.history.filter.resultOption.${chip.value}`);
    case "type":
      return t(`inspect.history.filter.typeOption.${chip.value}`);
    case "room":
      return t("inspect.history.filter.roomChip", { room: chip.value });
    case "inspector": {
      const name = inspectors.find((inspector) => inspector.id === chip.value)?.name?.trim();
      return name ? t("inspect.history.filter.inspectorChip", { name }) : t("inspect.history.filter.inspectorChipUnknown");
    }
    case "standard":
      return t("inspect.history.filter.standardChip", { label: chip.value.label });
  }
}
