import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* Team Scheduling Phase 4 words: every English string has a Spanish twin with the same placeholders, every code the
   server can send has words, and nothing claims what the system does not do (notify, confirm, call someone available). */

type Tree = { [key: string]: string | Tree };

function flatten(node: string | Tree, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  return Object.entries(node).reduce<Record<string, string>>((all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }), {});
}

const english = flatten((en as unknown as { teamSchedule: { coverage: Tree } }).teamSchedule.coverage);
const spanish = flatten((es as unknown as { teamSchedule: { coverage: Tree } }).teamSchedule.coverage);
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe("teamSchedule.coverage locale files", () => {
  it("has the same keys in English and Spanish, with the same placeholders, and no empty text", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      expect({ key, placeholders: placeholders(spanish[key]) }).toEqual({ key, placeholders: placeholders(text) });
      expect(text.trim()).not.toBe("");
      expect(spanish[key].trim()).not.toBe("");
    }
  });

  it("words every refusal the server can send, every candidate flag and every history event", () => {
    const codes = [
      "version_conflict", "gap_not_fillable", "gap_filled", "gap_waived", "shift_ended", "candidate_ineligible", "warnings_need_acknowledgement", "duplicate_offer",
      "duplicate_absence", "schedule_conflict", "claim_stale", "claim_not_pending", "offer_expired", "offer_not_pending", "department_forbidden", "employee_inactive",
      "shift_cancelled", "leaving_outside_shift", "leaving_at_required", "already_covered", "assignment_not_found", "gap_not_found", "duplicate_open_shift",
      "historical_date", "staff_not_found", "signed_out", "unconfirmed", "forbidden", "other",
    ];
    for (const code of codes) expect(english[`failure.${code}`]).toBeTruthy();
    const flags = ["is_absent_employee", "other_department", "role_mismatch", "overlapping_shift", "pending_offer_elsewhere", "currently_clocked_in", "attendance_unverified", "insufficient_rest", "weekly_overtime", "availability_unknown", "other"];
    for (const flag of flags) expect(english[`flag.${flag}`]).toBeTruthy();
    for (const kind of ["called_out", "unavailable", "leaving_early", "emergency", "other"]) expect(english[`kind.${kind}`]).toBeTruthy();
    for (const event of ["absence.confirmed", "coverage_gap.opened", "coverage_gap.filled", "coverage_offer.created", "coverage_offer.accepted", "coverage_claim.approved"]) expect(english[`event.${event}`]).toBeTruthy();
  });

  it("never claims an offer was delivered, never calls anyone available and never asks for medical detail", () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(spanish)]) {
      const lower = text.toLowerCase();
      expect({ key, claim: /\b(has been notified|was notified|were notified|ha sido notificad|fue notificad)/.test(lower) }).toEqual({ key, claim: false });
      expect({ key, claim: /\bis available\b|\bes disponible\b|\bavailable to work\b/.test(lower) }).toEqual({ key, claim: false });
    }
    expect(english["offer.notDelivered"]).toMatch(/not .*notified/i);
    expect(spanish["offer.notDelivered"]).toMatch(/no le avis/i);
    expect(english["callOut.privacy"]).toMatch(/medical/i);
    expect(english["offer.explain"]).toMatch(/not scheduled until they accept/i);
  });
});
