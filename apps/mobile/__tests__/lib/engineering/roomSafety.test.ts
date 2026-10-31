import fs from "fs";
import path from "path";

/**
 * The old mobile Rooms screen set a room out of order with a bare status PATCH (no reason, no return time) and
 * returned it by PATCHing DIRTY (no repair or verification check). Availability now goes only through the dedicated
 * /room-unavailability endpoints; these guards stop a status write from creeping back into engineering code.
 */
const ROOT = path.resolve(__dirname, "../../..");
const DIRS = ["components/engineering", "lib/engineering", "app/(app)/room-status", "app/(app)/work-orders", "app/(app)/assets", "lib/api"];

function sourceFiles(dir: string): string[] {
  const full = path.join(ROOT, dir);
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(next);
    return /\.tsx?$/.test(entry.name) ? [next] : [];
  });
}

const files = DIRS.flatMap(sourceFiles);
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("room availability never goes through a room-status write", () => {
  it("no engineering screen or client calls PATCH /rooms/{id}/status", () => {
    const offenders = files.filter((file) => /rooms\/\$\{[^}]+\}\/status|rooms\/[^"'`]*\/status/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("no engineering code sets a room to DIRTY, CLEAN, INSPECTED or OOO by itself", () => {
    const offenders = files.filter((file) => /status:\s*["'](DIRTY|CLEAN|INSPECTED|OOO|OUT_OF_ORDER)["']/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("the only writes to availability are the dedicated room-unavailability endpoints, always marked as mobile", () => {
    const api = read("lib/api/engineeringRooms.ts");
    expect(api).toMatch(/api\.post<[^>]*>\("\/room-unavailability"/);
    expect(api).toMatch(/\/room-unavailability\/\$\{encodeURIComponent\(periodId\)\}\/release/);
    expect(api).toMatch(/\/expected-return/);
    const rules = read("lib/engineering/roomAvailability.ts");
    expect(rules.match(/source: "MOBILE"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the old unsafe room-status flow and its modal are gone", () => {
    const legacy = read("app/(app)/room-status/index.tsx");
    expect(legacy).not.toMatch(/api\.patch/);
    expect(legacy).not.toMatch(/Alert\.alert/);
    expect(legacy).not.toMatch(/CreateWorkOrderModal/);
    expect(fs.existsSync(path.join(ROOT, "components/engineering/CreateWorkOrderModal.tsx"))).toBe(false);
  });

  it("no engineering copy promises the PMS was updated or that a room is ready to sell", () => {
    const strings = JSON.stringify([require("@/i18n/locales/en.json").engRooms, require("@/i18n/locales/en.json").report]);
    // Negations ("does not send", "not ready to sell") are the honest wording; affirmative claims are not.
    expect(strings).not.toMatch(/synced to (the )?PMS|(was|been|is now|now) updated in (the )?PMS|(is|now|marked as) (ready to sell|available for sale|sellable)/i);
  });
});
