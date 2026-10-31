import fs from "fs";
import path from "path";
import { completePmSchedule } from "@/lib/api/assets";
import { api } from "@/lib/api/client";
import {
  PmCompletionBlockedError,
  assertPmCompletionAllowed,
  validatePmCompletion,
  type PmCompletionPayload,
} from "@/lib/engineering/pmCompletion";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

const post = api.post as jest.Mock;

const passed = { label: "Filter replaced", result: "passed" as const };

describe("validatePmCompletion", () => {
  it("rejects a completion with no checklist items (the old empty {} body)", () => {
    expect(validatePmCompletion({} as never)).toEqual({ code: "no_items" });
    expect(validatePmCompletion({ items: [] })).toEqual({ code: "no_items" });
    expect(validatePmCompletion(null)).toEqual({ code: "no_items" });
    expect(validatePmCompletion(undefined)).toEqual({ code: "no_items" });
  });

  it("rejects an item without a label or with an unknown result", () => {
    expect(validatePmCompletion({ items: [{ label: "", result: "passed" }] })).toEqual({ code: "bad_result", label: "" });
    expect(validatePmCompletion({ items: [{ label: "Belt", result: "done" as never }] })).toEqual({ code: "bad_result", label: "Belt" });
  });

  it("requires evidence for a controlled item unless it is not applicable", () => {
    const controlled = { label: "Fire panel test", result: "passed" as const, requires_evidence: true };
    expect(validatePmCompletion({ items: [controlled] })).toEqual({ code: "evidence_required", label: "Fire panel test" });
    expect(validatePmCompletion({ items: [{ ...controlled, evidence: [] }] })).toEqual({ code: "evidence_required", label: "Fire panel test" });
    expect(validatePmCompletion({ items: [{ ...controlled, evidence: ["ev-1"] }] })).toBeNull();
    expect(validatePmCompletion({ items: [{ ...controlled, result: "not_applicable" }] })).toBeNull();
  });

  it("accepts passed, failed and not_applicable results", () => {
    expect(
      validatePmCompletion({
        items: [passed, { label: "Bearing", result: "failed" }, { label: "Heater", result: "not_applicable" }],
      }),
    ).toBeNull();
  });
});

describe("completePmSchedule", () => {
  beforeEach(() => post.mockReset());

  it("never sends an empty or item-less completion", async () => {
    for (const payload of [{}, { items: [] }]) {
      await expect(completePmSchedule("pm-1", payload as unknown as PmCompletionPayload)).rejects.toBeInstanceOf(PmCompletionBlockedError);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it("posts a valid completion to the schedule's complete endpoint", async () => {
    post.mockResolvedValue({ data: {} });
    const payload: PmCompletionPayload = { items: [passed], labor_minutes: 20 };
    await completePmSchedule("pm-1", payload);
    expect(post).toHaveBeenCalledWith("/assets/pm-schedules/pm-1/complete", payload);
  });

  it("assertPmCompletionAllowed throws with the reason", () => {
    expect(() => assertPmCompletionAllowed({ items: [] })).toThrow(PmCompletionBlockedError);
    expect(() => assertPmCompletionAllowed({ items: [passed] })).not.toThrow();
  });
});

describe("no screen can post an empty PM completion", () => {
  const MOBILE = path.resolve(__dirname, "../../..");

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "__tests__" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("only lib/api/assets.ts talks to the PM complete endpoint, and it validates first", () => {
    const offenders = ["app", "components", "lib", "stores"]
      .flatMap((dir) => sourceFiles(path.join(MOBILE, dir)))
      .filter((file) => /\.(post|put|patch)\(\s*[`"'][^`"']*pm-schedules[^`"']*\/complete/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(MOBILE, file).replace(/\\/g, "/"));
    expect(offenders).toEqual(["lib/api/assets.ts"]);
    expect(fs.readFileSync(path.join(MOBILE, "lib/api/assets.ts"), "utf8")).toMatch(/assertPmCompletionAllowed\(payload\);\s*\n\s*await api\.post/);
  });
});

describe("the PM screen offers no one-tap completion", () => {
  it("renders the inspection-required notice instead of a Log Complete action", () => {
    const screen = fs.readFileSync(path.resolve(__dirname, "../../../app/(app)/pm-schedules/index.tsx"), "utf8");
    expect(screen).not.toMatch(/logComplete|handleComplete|\/complete/);
    expect(screen).toContain("inspectionRequiredTitle");
  });
});
