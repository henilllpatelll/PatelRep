import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
}

const enKeys = new Set(flatten((en as Tree).assignments as Tree));
const esKeys = new Set(flatten((es as Tree).assignments as Tree));

const root = resolve(__dirname, "../..");
const sources = [
  "app/(app)/assignments/index.tsx",
  "lib/housekeeping/assignmentRoomsView.ts",
  "lib/housekeeping/assignmentTeamView.ts",
  "lib/housekeeping/assignmentTeamQuery.ts",
  ...readdirSync(resolve(root, "components/supervisor/assignments")).map((file) => `components/supervisor/assignments/${file}`),
];

describe("Assignments V2 strings", () => {
  it("English and Spanish carry exactly the same keys", () => {
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
  });

  it("every literal assignments.v2 key the screen asks for exists in both languages", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const code = readFileSync(resolve(root, file), "utf8");
      for (const match of code.matchAll(/["'`](assignments\.v2\.[A-Za-z0-9_.]+)["'`]/g)) {
        const key = match[1].replace(/^assignments\./, "");
        const known = enKeys.has(key) || enKeys.has(`${key}_plural`);
        if (!known) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every dynamic key family is complete", () => {
    const families: Record<string, string[]> = {
      "v2.status": ["loading", "updating", "live", "stale", "offline", "previous_day", "unavailable"],
      "v2.blocker": ["in_progress", "in_progress_unowned", "awaiting_inspection", "guest_ready", "out_of_service", "unknown_status", "service_declined", "return_later", "dnd", "occupancy_discrepancy"],
      "v2.priority": ["guest_waiting", "reclean_requested", "rush", "arrival_passed", "arrival_today", "vip", "high_risk"],
      "v2.sort": ["priority", "roomNumber", "location", "deadline"],
      "v2.section": ["urgent", "unassigned", "assigned", "blocked"],
      "v2.quick": ["all", "unassigned", "urgent"],
      "v2.tab": ["rooms", "team"],
      "v2.filters.scope": ["all", "unassigned", "assigned", "blocked"],
      "v2.filters.priority": ["any", "urgent", "vip", "at_risk"],
      "v2.sheet.frozen": ["in_progress", "awaiting_inspection", "guest_ready", "out_of_service", "unknown_status"],
      "v2.state": ["staleOffline", "staleFailed", "staleAge", "previousDay", "auxPartial"],
    };
    const absent = Object.entries(families).flatMap(([family, names]) => names.filter((name) => !enKeys.has(`${family}.${name}`)).map((name) => `${family}.${name}`));
    expect(absent).toEqual([]);
  });
});
