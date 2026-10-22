import { appendHistory, buildHistory, resultOf } from "@/lib/inspections/history/rows";
import { historyRow } from "../../../helpers/inspectionFixtures";

describe("history rows", () => {
  it("keeps the server's order and reads results as words, with conditional kept apart", () => {
    const { items } = buildHistory([
      historyRow("a", { overall_result: "failed" }),
      historyRow("b", { overall_result: "conditional" }),
      historyRow("c", { overall_result: "passed" }),
      historyRow("d", { overall_result: "weird" }),
    ]);
    expect(items.map((item) => [item.id, item.result])).toEqual([["a", "failed"], ["b", "conditional"], ["c", "passed"], ["d", "unknown"]]);
    expect(resultOf("conditional")).toBe("conditional");
  });

  it("never turns an id into a name, and keeps the inspector id separately", () => {
    const { items } = buildHistory([historyRow("a", { inspector_display_name: null, inspected_by: "11111111-2222" })]);
    expect(items[0].inspectorName).toBeNull();
    expect(items[0].inspectorId).toBe("11111111-2222");
    expect(buildHistory([historyRow("b", { inspector_display_name: "   " })]).items[0].inspectorName).toBeNull();
  });

  it("marks only linked reinspections as reinspections", () => {
    const { items } = buildHistory([historyRow("a", { is_reinspection: true, reinspection_of: "x" }), historyRow("b")]);
    expect(items.map((item) => item.isReinspection)).toEqual([true, false]);
  });

  it("counts a row with no readable time instead of guessing one", () => {
    const built = buildHistory([historyRow("a", { completed_at: null }), historyRow("b", { completed_at: "not a date" }), historyRow("c")]);
    expect(built.items.map((item) => item.id)).toEqual(["c"]);
    expect(built.unreadable).toBe(2);
  });

  it("appending a page never repeats an inspection (an overlapping boundary is harmless)", () => {
    const first = buildHistory([historyRow("a"), historyRow("b")]);
    const next = appendHistory(first.items, [historyRow("b"), historyRow("c")]);
    expect(next.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(appendHistory(next.items, [historyRow("a")]).items).toHaveLength(3);
  });

  it("keeps a record whose room is gone, labelled by the screen rather than dropped", () => {
    const { items } = buildHistory([historyRow("a", { room_number: "" })]);
    expect(items).toHaveLength(1);
    expect(items[0].roomNumber).toBe("");
  });

  it("trims the building and drops a blank one", () => {
    expect(buildHistory([historyRow("a", { building: " A " })]).items[0].building).toBe("A");
    expect(buildHistory([historyRow("a", { building: " " })]).items[0].building).toBeNull();
  });
});
