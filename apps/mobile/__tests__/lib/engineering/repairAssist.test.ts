import { canOfferAssist, classifyAssistError, isUsableQuestion, trimHistory } from "@/lib/engineering/repairAssist";

const err = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("repair assist rules", () => {
  it("maps provider-off and limits to honest messages", () => {
    expect(classifyAssistError(err(503))).toBe("unavailable");
    expect(classifyAssistError(err(402))).toBe("cap");
    expect(classifyAssistError(err(403))).toBe("off");
    expect(classifyAssistError(err(429))).toBe("busy");
    expect(classifyAssistError(err(404))).toBe("not_found");
    expect(classifyAssistError(new Error("Request timed out. Please try again."))).toBe("offline");
    expect(classifyAssistError(err(500))).toBe("failed");
  });
  it("offers the button only when switched on, for a permitted role, on an open order", () => {
    const base = { capability: true, status: "in_progress", role: "engineer" };
    expect(canOfferAssist(base)).toBe(true);
    expect(canOfferAssist({ ...base, capability: false })).toBe(false);
    expect(canOfferAssist({ ...base, role: "housekeeper" })).toBe(false);
    expect(canOfferAssist({ ...base, status: "completed" })).toBe(false);
    expect(canOfferAssist({ ...base, status: "cancelled" })).toBe(false);
  });
  it("keeps only the last few, shortened turns", () => {
    const turns = Array.from({ length: 7 }, (_, i) => ({ role: "user" as const, text: `${i}`.padEnd(900, "x") }));
    const out = trimHistory(turns);
    expect(out).toHaveLength(4);
    expect(out[0].text.startsWith("3")).toBe(true);
    expect(out.every((t) => t.text.length === 600)).toBe(true);
  });
  it("rejects empty and over-long questions", () => {
    expect(isUsableQuestion("  ")).toBe(false);
    expect(isUsableQuestion("x".repeat(501))).toBe(false);
    expect(isUsableQuestion("Where is the filter?")).toBe(true);
  });
});
