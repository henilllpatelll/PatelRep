import fs from "fs";
import path from "path";
import { classifyFailure, validateAnswers, validatePhotoLinks, type AnswerRow } from "@/lib/inspections/validation";
import { TOUCH_UP_MAX_ITEMS, type ChecklistItem, type RequiredNaPolicy } from "@/lib/inspections/types";

/* The server's rules (apps/api/services/inspection_rules.py) and the client's mirror are both run against this one
   table. A rule change must add a case to the table first, which then fails on whichever side was not updated. */

interface RawItem {
  id: string;
  is_required?: boolean;
  requires_photo_on_fail?: boolean;
  allows_na?: boolean;
}

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../api/tests/fixtures/inspection_rules.json"), "utf8"),
) as {
  touch_up_max_items: number;
  items: RawItem[];
  classify: { name: string; severities: (string | null)[]; expect: string | null }[];
  answers: {
    name: string;
    items?: RawItem[];
    policy?: RequiredNaPolicy;
    answers: (string | null)[][];
    claimed: string;
    expect: { error?: string; result?: string; kind?: string | null; failed?: string[]; answered?: string[] };
  }[];
  photos: { name: string; failed: string[]; photo_items: string[]; photo_count: number; expect: { ok?: boolean; error?: string } }[];
};

function toItems(raw: RawItem[]): ChecklistItem[] {
  return raw.map((item, index) => ({
    id: item.id,
    section: "S",
    description: item.id,
    isRequired: item.is_required ?? true,
    requiresPhotoOnFail: item.requires_photo_on_fail ?? false,
    allowsNa: item.allows_na ?? true,
    sortOrder: index,
  }));
}

function toRows(answers: (string | null)[][]): AnswerRow[] {
  return answers.map(([id, result, note, severity]) => ({
    template_item_id: id,
    result: result as string,
    note: note ?? null,
    severity: severity ?? null,
  }));
}

describe("inspection rules conformance (shared with the API)", () => {
  it("uses the same touch-up limit as the server", () => {
    expect(TOUCH_UP_MAX_ITEMS).toBe(fixture.touch_up_max_items);
  });

  it.each(fixture.classify)("classify: $name", ({ severities, expect: expected }) => {
    expect(classifyFailure(severities)).toBe(expected);
  });

  it.each(fixture.answers)("answers: $name", (testCase) => {
    const items = toItems(testCase.items ?? fixture.items);
    const result = validateAnswers(items, toRows(testCase.answers), { claimed: testCase.claimed, policy: testCase.policy });
    if (testCase.expect.error) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(testCase.expect.error);
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe(testCase.expect.result);
    expect(result.correctionKind).toBe(testCase.expect.kind);
    expect([...result.failedItemIds].sort()).toEqual([...(testCase.expect.failed ?? [])].sort());
    if (testCase.expect.answered) expect([...result.answeredItemIds].sort()).toEqual([...testCase.expect.answered].sort());
  });

  it.each(fixture.photos)("photos: $name", (testCase) => {
    const result = validatePhotoLinks(toItems(fixture.items), testCase.failed, testCase.photo_items, testCase.photo_count);
    if (testCase.expect.error) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(testCase.expect.error);
    } else {
      expect(result).toEqual({ ok: true });
    }
  });
});
