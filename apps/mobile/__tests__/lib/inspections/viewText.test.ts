import { buildQueue } from "@/lib/inspections/queue";
import { badgeFor, cardText, correctionText, metricText, staleBanner, statusLine } from "@/lib/inspections/viewText";
import { priorityFacts } from "@/lib/inspections/queueView";
import { buildCorrections } from "@/lib/inspections/lists";
import { loadingSource } from "@/lib/housekeeping/supervisorSources";
import { makeTranslator } from "../../helpers/i18n";
import { readyRoom } from "../../helpers/inspectionFixtures";

const t = makeTranslator("en");
const tes = makeTranslator("es");
const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM Chicago
const TZ = "America/Chicago";
const ctx = { now: NOW, timeZone: TZ };
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const one = (over = {}) => buildQueue([readyRoom("r205", { room_number: "205", ...over })])[0];

describe("the header status line", () => {
  it("is Live only for a recent verified answer", () => {
    expect(statusLine({ status: "available", data: [], fetchedAt: NOW - 2_000 }, NOW, TZ, "en", t)).toEqual({ text: "Live · Updated just now", tone: "live" });
    expect(statusLine({ status: "empty", fetchedAt: NOW - 30_000 }, NOW, TZ, "en", t).text).toBe("Live · Updated 30s ago");
    expect(statusLine({ status: "available", data: [], fetchedAt: NOW - 3 * 60_000 }, NOW, TZ, "en", t).text).toBe("Live · Updated 3 min ago");
  });

  it("never calls kept-but-unverified data live", () => {
    const offline = statusLine({ status: "stale", data: [], fetchedAt: NOW - 600_000, reason: "offline", failure: null }, NOW, TZ, "en", t);
    expect(offline.tone).toBe("warn");
    expect(offline.text).toBe("Offline · Last checked 12:50 PM");
    const old = statusLine({ status: "stale", data: [], fetchedAt: NOW - 600_000, reason: "age", failure: null }, NOW, TZ, "en", t);
    expect(old.text).toBe("Not up to date · Last checked 12:50 PM");
    expect(old.text).not.toMatch(/live/i);
  });

  it("says it could not check - and not all clear - when nothing was ever verified", () => {
    expect(statusLine(loadingSource(), NOW, TZ, "en", t).tone).toBe("busy");
    expect(statusLine({ status: "failed", failure: { kind: "error", status: 500 } }, NOW, TZ, "en", t).text).toBe("Unable to check the queue");
    expect(statusLine({ status: "failed", failure: { kind: "offline", status: null } }, NOW, TZ, "en", t).text).toBe("Offline · Nothing checked yet");
  });

  it("speaks Spanish", () => {
    expect(statusLine({ status: "available", data: [], fetchedAt: NOW - 1000 }, NOW, TZ, "es", tes).text).toBe("En vivo · Actualizado ahora");
  });

  it("the stale banner explains offline separately from an old or failed refresh", () => {
    const stale = (reason: "offline" | "age" | "refresh_failed") => staleBanner({ status: "stale", data: [], fetchedAt: NOW - 900_000, reason, failure: null }, TZ, "en", t);
    expect(stale("offline")).toContain("Starting an inspection needs a connection");
    expect(stale("age")).toBe("Not up to date. Showing data from 12:45 PM.");
    expect(stale("refresh_failed")).toBe("Couldn't refresh. Showing data from 12:45 PM.");
    expect(staleBanner({ status: "available", data: [], fetchedAt: NOW }, TZ, "en", t)).toBeNull();
  });
});

describe("summary metrics", () => {
  it("an unknown count is an em dash and never 0; a verified zero is 0; a truncated count is a lower bound", () => {
    expect(metricText({ value: null, atLeast: false }, t)).toEqual({ text: "—", a11y: "unavailable" });
    expect(metricText({ value: 0, atLeast: false }, t)).toEqual({ text: "0", a11y: "0" });
    expect(metricText({ value: 300, atLeast: true }, t)).toEqual({ text: "300+", a11y: "at least 300" });
  });
});

describe("the queue card words", () => {
  it("a departure with an arrival later today: kind, floor, housekeeper, wait, arrival time", () => {
    const text = cardText(one({ clean_type: "DEP", floor: 2, cleaned_by: "Maria S.", cleaned_at: ago(18), arrival_at: "2026-10-20T19:00:00Z" }), ctx, "en", false, t);
    expect(text.badge).toBe("arrival");
    expect(text.where).toBe("Departure · Floor 2");
    expect(text.who).toBe("Maria S. · Cleaned 18 min ago");
    expect(text.note).toBe("Arrival 2:00 PM");
  });

  it("a passed arrival is overdue and says when it was", () => {
    const text = cardText(one({ arrival_at: "2026-10-20T16:00:00Z" }), ctx, "en", false, t);
    expect(text.badge).toBe("overdue");
    expect(text.note).toBe("Arrival was 11:00 AM");
  });

  it("a reinspection is labelled as one, counts the original failed items, and never claims they are fixed", () => {
    const text = cardText(
      one({
        clean_type: "FULL",
        floor: 3,
        cleaned_by: "Carlos M.",
        cleaned_at: ago(5),
        previous_failure: {
          inspection_id: "i",
          inspected_at: null,
          overall_result: "failed",
          notes: null,
          correction_kind: "reclean",
          items: [
            { id: "a", label: "Mirror", note: null },
            { id: "b", label: "Floor", note: null },
          ],
        },
      }),
      ctx,
      "en",
      false,
      t,
    );
    expect(text.badge).toBe("reinspection");
    expect(text.who).toBe("Carlos M. · Resubmitted 5 min ago");
    expect(text.failedItems).toBe("2 original failed items");
    expect(`${text.where} ${text.who} ${text.summary}`.toLowerCase()).not.toMatch(/fixed|passed|resolved/);
  });

  it("unknown facts are left out or called not recorded - never zero, never an id", () => {
    const text = cardText(one({ clean_type: null, floor: null, cleaned_by: "", cleaned_at: null }), ctx, "en", false, t);
    expect(text.where).toBeNull();
    expect(text.who).toBe("Housekeeper not recorded · Clean time not recorded");
    expect(text.note).toBeNull();
    expect(text.badge).toBeNull();
    expect(text.who).not.toMatch(/\b0\b/);
  });

  it("names the building only in a multi-building hotel", () => {
    const item = one({ building: "East", floor: 2, clean_type: "DEP" });
    expect(cardText(item, ctx, "en", true, t).where).toBe("Departure · Building East · Floor 2");
    expect(cardText(item, ctx, "en", false, t).where).toBe("Departure · Floor 2");
  });

  it("long waits read as hours and minutes", () => {
    expect(cardText(one({ cleaned_at: ago(125) }), ctx, "en", false, t).who).toBe("Hana · Cleaned 2h 5m ago");
    expect(cardText(one({ cleaned_at: ago(120) }), ctx, "en", false, t).who).toBe("Hana · Cleaned 2h ago");
  });

  it("VIP shows as a note and a badge but never as overdue", () => {
    const item = one({ vip: true });
    expect(badgeFor(priorityFacts(item, ctx))).toBe("vip");
    expect(cardText(item, ctx, "en", false, t).note).toBe("VIP guest");
  });

  it("the same facts come out in Spanish", () => {
    const text = cardText(one({ clean_type: "DEP", floor: 2, cleaned_at: ago(18), arrival_at: "2026-10-20T19:00:00Z" }), ctx, "es", false, tes);
    expect(text.where).toBe("Salida · Piso 2");
    expect(text.who).toBe("Hana · Limpió hace 18 min");
    expect(text.note).toContain("Llegada");
  });
});

describe("the correction card words", () => {
  const row = (over = {}) =>
    buildCorrections([
      {
        inspection_id: "i",
        room_id: "r",
        room_number: "305",
        floor: 3,
        building: null,
        inspected_at: ago(90),
        overall_result: "failed",
        kind: "reclean",
        status: "assigned",
        notes: null,
        inspector_name: "Sam",
        failed_count: 3,
        failed_items: [],
        task: { id: "t", status: "open", assigned_to: "hk", assigned_name: "Hana", due_at: null, started_at: null, completed_at: null },
        ...over,
      },
    ]).items[0];

  it("assigned is responsibility, not acknowledgement: it says Owner, not that Hana is working on it", () => {
    const text = correctionText(row(), NOW, t);
    expect(text.owner).toBe("Owner: Hana");
    expect(text.detail).toBe("Assigned, not started");
    expect(text.failed).toBe("3 failed items");
    expect(text.updated).toBe("Updated 1h 30m ago");
  });

  it("unassigned and unnamed owners are stated plainly", () => {
    expect(correctionText(row({ status: "unassigned", task: null }), NOW, t).owner).toBe("Unassigned");
    expect(
      correctionText(row({ task: { id: "t", status: "open", assigned_to: "hk", assigned_name: null, due_at: null, started_at: null, completed_at: null } }), NOW, t).owner,
    ).toBe("Owner: name not recorded");
  });
});
