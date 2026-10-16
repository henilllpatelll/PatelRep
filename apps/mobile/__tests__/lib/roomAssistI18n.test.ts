import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { answerRoomQuestion, buildRoomGuidance, roomQuestionIds } from "@/lib/housekeeping/roomAssist";
import { classifyRoom } from "@/lib/housekeeping/needsAttention";
import { localeHasKey, makeTranslator } from "../helpers/i18n";
import { room, session } from "../helpers/homeModelFixture";

type Json = { [k: string]: Json | string };
const leaves = (n: Json | string, p: string[] = []): Array<[string, string]> =>
  typeof n === "string" ? [[p.join("."), n]] : Object.entries(n).flatMap(([k, v]) => leaves(v, [...p, k]));
const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

const PHASE3 = [
  /^home\.why\.estimateGeneral$/,
  /^home\.whySheet\.(viewAll|offline|stale|cached|accessClear|noOverride|updatedAt)$/,
  /^home\.roomActions\.(sectionAssist|ask\.)/,
  /^home\.briefingSheet\.(askShift|credits|planSource|updatedAt)$/,
  /^home\.upNext\.why/,
  /^rooms\.(help|readiness|guidance)\./,
  /^rooms\.work\.more\.ask\./,
  /^rooms\.dash\.card\.whyNext/,
  /^assistant\.roomQ\./,
];

describe("room assistance copy", () => {
  const spanish = new Map(leaves(es as Json));
  const keys = leaves(en as Json).filter(([key]) => PHASE3.some((pattern) => pattern.test(key)));

  it("exists in Spanish with the same placeholders", () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const [key, value] of keys) {
      expect(spanish.get(key)).toBeTruthy();
      expect(placeholders(spanish.get(key) as string)).toEqual(placeholders(value));
    }
  });

  it("uses the app's i18next v3 plural keys, not _one/_other", () => {
    for (const language of ["en", "es"] as const) {
      expect(localeHasKey(language, "rooms.guidance.itemsLeft_plural")).toBe(true);
      expect(localeHasKey(language, "assistant.roomQ.checklist.left_plural")).toBe(true);
    }
    expect(keys.some(([key]) => /_(one|other)$/.test(key))).toBe(false);
  });

  it("resolves every line the room answers and guidance can produce, in both languages, to real text", () => {
    const withWorkOrder = room("306", { open_work_order_id: "wo-1", open_work_order_number: "9", open_work_order_title: "Leak" });
    const live = session("312");
    const pending = session("312", { pendingItems: { b: { item_id: "b", section: "Bath", label: "Bathroom", is_required: true, checked: true, checked_at: null } } });
    const lines = [
      ...roomQuestionIds(true).flatMap((id) =>
        [
          answerRoomQuestion(id, { room: null, session: undefined }),
          answerRoomQuestion(id, { room: withWorkOrder, session: live }),
          answerRoomQuestion(id, { room: room("218"), session: pending }),
          answerRoomQuestion(id, { room: room("218"), session: undefined }),
        ].flatMap((answer) => (answer.type === "compose" ? [] : answer.lines)),
      ),
      buildRoomGuidance({ room: withWorkOrder, session: live, classification: classifyRoom(withWorkOrder, { hasLiveSession: true }), isNext: false }),
      buildRoomGuidance({ room: room("218"), session: undefined, classification: classifyRoom(room("218"), { hasLiveSession: false }), isNext: true }),
    ].filter((line): line is NonNullable<typeof line> => Boolean(line));

    for (const language of ["en", "es"] as const) {
      const t = makeTranslator(language);
      for (const line of lines) {
        const text = t(line.key, { ...line.params });
        expect(text).not.toBe(line.key);
        expect(text).not.toMatch(/\{\{/);
      }
    }
  });
});
