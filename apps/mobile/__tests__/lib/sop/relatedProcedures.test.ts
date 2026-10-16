import type { SOPDocument } from "@/lib/api/sop";
import { relatedProcedures } from "@/lib/sop/relatedProcedures";

function doc(id: string, title: string, category: string | null = null): SOPDocument {
  return { id, title, description: null, category, page_count: 1, indexing_status: "indexed", created_at: "2026-10-01T00:00:00Z" };
}

const HOTEL = [
  doc("lf", "Lost & Found Procedures", "Housekeeping"),
  doc("dnd", "Do Not Disturb Policy", "Room Access"),
  doc("clean", "Departure Room Cleaning", "Housekeeping"),
  doc("chem", "Chemical Handling", "Safety"),
  doc("mx", "Maintenance Reporting", "Engineering"),
];

describe("relatedProcedures", () => {
  it("offers the hotel's lost-property procedure for a lost-property task", () => {
    expect(relatedProcedures(["Guest left a wallet in 412", null], HOTEL).map((d) => d.id)).toEqual(["lf"]);
  });

  it("offers a cleaning procedure for a cleaning task and a reporting one for a repair", () => {
    expect(relatedProcedures(["Deep clean bathroom"], HOTEL).map((d) => d.id)).toEqual(["clean"]);
    expect(relatedProcedures(["Leak under the sink"], HOTEL).map((d) => d.id)).toEqual(["mx"]);
  });

  it("recognises Spanish wording, with or without accents", () => {
    expect(relatedProcedures(["Un huésped olvidó su cartera"], HOTEL).map((d) => d.id)).toEqual(["lf"]);
    expect(relatedProcedures(["Objeto perdido en la habitación 210"], HOTEL).map((d) => d.id)).toContain("lf");
    expect(relatedProcedures(["Fuga de agua"], HOTEL).map((d) => d.id)).toEqual(["mx"]);
  });

  it("offers nothing when the hotel has no matching procedure or no procedures at all", () => {
    expect(relatedProcedures(["Guest lost a phone"], [doc("x", "Fire Drill")])).toEqual([]);
    expect(relatedProcedures(["Guest lost a phone"], [])).toEqual([]);
    expect(relatedProcedures(["Say hello to the manager"], HOTEL)).toEqual([]);
    expect(relatedProcedures([null, undefined, ""], HOTEL)).toEqual([]);
  });

  it("never offers more than the limit, and never the same document twice", () => {
    const out = relatedProcedures(["Clean up the leak and the lost wallet and towels"], HOTEL, 2);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((d) => d.id)).size).toBe(2);
  });
});
