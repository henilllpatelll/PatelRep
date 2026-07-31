import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOUSEKEEPING_SOURCES = {
  supplyRequest: "../../components/housekeeping/SupplyRequestModal.tsx",
  reportIssue: "../../components/housekeeping/ReportIssueModal.tsx",
  knock: "../../components/housekeeping/KnockModal.tsx",
  checklist: "../../components/housekeeping/ChecklistSection.tsx",
  inspect: "../../app/(app)/inspect/index.tsx",
} as const;

const sources = Object.fromEntries(
  Object.entries(HOUSEKEEPING_SOURCES).map(([name, path]) => [
    name,
    readFileSync(resolve(__dirname, path), "utf8"),
  ]),
) as Record<keyof typeof HOUSEKEEPING_SOURCES, string>;

/*
 * Manual target and large-text checklist for the explicit audited inventory:
 *
 * - Supply Request: selectable item rows are >=44pt named checkboxes with
 *   checked state; submit/cancel retain Button disabled/busy semantics.
 * - Report Issue: category and priority choices are >=44pt named controls with
 *   expanded/selected state; footer actions use minimum, flexible sizing.
 * - Knock: the confirmation action remains >=44pt and the five instruction
 *   rows plus CTA can scroll rather than hiding the action at 200% text scale.
 * - Checklist: checklist rows are named checkboxes with checked/disabled state;
 *   photo, skip, lost-item, and linen controls are named buttons >=44pt.
 * - Inspect: tabs expose selected state; pass/touchup/fail and icon-only close
 *   actions are named buttons >=44pt; checklist choices expose checked state.
 *
 * Text-bearing action rows use minimum rather than fixed heights and may grow
 * for Spanish or 200% text. Decorative icons, status rails, check marks,
 * grabbers, and count/avatar surfaces are intentionally not touch targets and
 * must not be swept into a broad target-size regex.
 */

describe("housekeeping and inspection semantic on-colors", () => {
  it.each(Object.entries(sources))(
    "%s contains no audited raw white foreground",
    (_name, source) => {
      expect(source).not.toMatch(/#[Ff]{3}(?![0-9A-Fa-f])/);
      expect(source).not.toMatch(/#FFFFFF\b/i);
    },
  );

  it("uses the tested primary on-color for supply selections", () => {
    expect(sources.supplyRequest).toContain("theme.onPrimary");
  });

  it("uses tested primary and destructive on-colors for issue priority selections", () => {
    expect(sources.reportIssue).toContain("theme.onPrimary");
    expect(sources.reportIssue).toContain("theme.onDestructive");
  });

  it("uses the tested primary on-color for knock step markers", () => {
    expect(sources.knock).toContain("theme.onPrimary");
  });

  it("uses the tested primary on-color for checklist selections and photo action", () => {
    expect(sources.checklist).toContain("theme.onPrimary");
  });

  it("uses tested primary and destructive on-colors for inspection controls", () => {
    expect(sources.inspect).toContain("theme.onPrimary");
    expect(sources.inspect).toContain("theme.onDestructive");
  });
});
