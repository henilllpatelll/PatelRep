import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { CONTEXT_TYPES } from "@/lib/ai/launch";
import { chatQuickActions, sheetQuickActions } from "@/lib/ai/quickActions";

type Tree = { [key: string]: string | Tree };

function leaves(node: Tree, prefix = ""): Record<string, string> {
  return Object.entries(node).reduce<Record<string, string>>((out, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...out, [full]: value } : { ...out, ...leaves(value, full) };
  }, {});
}

const EN = leaves((en as unknown as { assistant: Tree }).assistant, "assistant");
const ES = leaves((es as unknown as { assistant: Tree }).assistant, "assistant");
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");

describe("assistant strings", () => {
  it("exist in English and Spanish, with the same keys and the same placeholders", () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
    for (const key of Object.keys(EN)) {
      expect(EN[key]).not.toBe("");
      expect(ES[key]).not.toBe("");
      expect(placeholders(ES[key]!)).toBe(placeholders(EN[key]!));
    }
  });

  it("are really translated, not English copied into the Spanish file", () => {
    const same = Object.keys(EN).filter((key) => EN[key] === ES[key] && /[a-z]{4,}/i.test(EN[key]!));
    // A few words are identical in both languages (e.g. proper names); anything more means a missed translation.
    expect(same.length).toBeLessThanOrEqual(2);
  });

  it("cover every quick action and every context type the code can show", () => {
    for (const action of [...sheetQuickActions("housekeeper"), ...chatQuickActions("housekeeper")]) {
      expect(EN[`assistant.quick.${action.id}`]).toBeTruthy();
    }
    for (const type of CONTEXT_TYPES.filter((candidate) => candidate !== "shift")) {
      expect(EN[`assistant.context.${type}`]).toBeTruthy();
      expect(ES[`assistant.context.${type}`]).toBeTruthy();
    }
    for (const type of CONTEXT_TYPES.filter((candidate) => candidate !== "general")) {
      expect(EN[`assistant.context.${type}With`]).toBeTruthy();
    }
  });

  it("include every literal key the assistant screens ask for", () => {
    const roots = ["components/ai", "components/voice", "app/(app)/copilot", "lib/ai"];
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          for (const match of source.matchAll(/\bt\(\s*"(assistant\.[A-Za-z0-9_.]+)"/g)) {
            if (!(match[1]! in EN)) missing.push(`${entry.name}: ${match[1]}`);
          }
        }
      }
    };
    for (const root of roots) walk(path.join(__dirname, "..", "..", "..", root));
    expect(missing).toEqual([]);
  });
});
