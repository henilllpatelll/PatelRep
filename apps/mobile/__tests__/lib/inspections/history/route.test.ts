import { parseRecordOrigin, recordFallbackHref, recordHref } from "@/lib/inspections/route";

describe("the record route", () => {
  it("names the inspection by its stable id and carries only hints for the room", () => {
    expect(recordHref("insp-1", "done", "room-9", "205")).toEqual({
      pathname: "/(app)/inspect/record/[inspectionId]",
      params: { inspectionId: "insp-1", from: "done", roomId: "room-9", roomNumber: "205" },
    });
    expect(recordHref("insp-1").params).toEqual({ inspectionId: "insp-1", from: "done" });
  });

  it("an origin outside the allow-list reads as the default, so a crafted link can't send anyone elsewhere", () => {
    expect(parseRecordOrigin("board")).toBe("board");
    expect(parseRecordOrigin("cycle")).toBe("cycle");
    expect(parseRecordOrigin("https://evil.example")).toBe("done");
    expect(parseRecordOrigin(undefined)).toBe("done");
  });

  it("Back with nothing to pop returns to where the supervisor came from", () => {
    expect(recordFallbackHref("board", "room-9")).toEqual({ pathname: "/(app)/room-board", params: { roomId: "room-9" } });
    expect(recordFallbackHref("board", null)).toEqual({ pathname: "/(app)/inspect", params: { tab: "done" } });
    expect(recordFallbackHref("corrections", null)).toEqual({ pathname: "/(app)/inspect", params: { tab: "corrections" } });
    expect(recordFallbackHref("done", null)).toEqual({ pathname: "/(app)/inspect", params: { tab: "done" } });
  });
});
