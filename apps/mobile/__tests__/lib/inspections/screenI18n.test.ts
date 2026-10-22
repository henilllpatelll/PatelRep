import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* The redesigned Inspections screen ships in English and Spanish with parity: every key exists in both, with the
   same placeholders, real Spanish rather than a copy of the English, and no key the code asks for is missing. */

type Tree = { [key: string]: string | Tree };
const NEW_GROUPS = ["header", "status", "metric", "search", "tabs", "chips", "filter", "card", "correction", "done", "states", "banner", "record", "start", "workspace", "drawer", "reassign", "activity", "reinspect", "correctionsSummary"];

function leaves(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...all, [full]: value } : { ...all, ...leaves(value, full) };
  }, {});
}

const inspectEn = leaves((en as unknown as { inspect: Tree }).inspect, "inspect");
const inspectEs = leaves((es as unknown as { inspect: Tree }).inspect, "inspect");
const isNew = (key: string) => NEW_GROUPS.includes(key.split(".")[1]) || key === "inspect.result.unknown" || key.startsWith("inspect.result.");
const newKeys = Object.keys(inspectEn).filter(isNew);
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

/** Strings that are legitimately the same in both languages. */
const SAME_IN_BOTH = new Set([
  "inspect.metric.unavailable", // an em dash
  "inspect.metric.atLeast", // "{{count}}+"
  "inspect.metric.a11y", // "{{label}}: {{value}}"
  "inspect.filter.priority.vip",
  "inspect.card.badge.vip",
  "inspect.done.at", // "{{time}}"
  "inspect.tabs.a11y", // "{{label}}, {{count}}"
  "inspect.record.inspector", // the same word in both
  "inspect.workspace.answer.na", // "N/A"
  "inspect.workspace.context.minutes", // "{{count}} min"
  "inspect.workspace.context.minutes_plural",
  "inspect.workspace.context.previousBy", // "Inspector" in both
  "inspect.workspace.issue.severity.a11y", // "{{severity}}. {{hint}}"
  "inspect.drawer.priorityValue.normal", // "Normal" in both
  "inspect.reassign.role.housekeeping_supervisor", // "Supervisor" in both
  "inspect.reinspect.originalNote", // "Original: {{note}}" in both
]);

describe("Inspections screen copy", () => {
  it("has a decent number of new strings to check", () => {
    expect(newKeys.length).toBeGreaterThan(150);
  });

  it("has exactly the same keys in English and Spanish", () => {
    expect(Object.keys(inspectEs).sort()).toEqual(Object.keys(inspectEn).sort());
  });

  it.each(newKeys)("%s: same placeholders in both languages", (key) => {
    expect(placeholders(inspectEs[key])).toEqual(placeholders(inspectEn[key]));
  });

  it("the new Spanish is Spanish: it differs from the English wherever it should", () => {
    const copied = newKeys.filter((key) => inspectEs[key] === inspectEn[key] && !SAME_IN_BOTH.has(key));
    expect(copied).toEqual([]);
  });

  it("no string is empty", () => {
    expect(Object.entries({ ...inspectEn, ...inspectEs }).filter(([, value]) => value.trim() === "")).toEqual([]);
  });

  it("every plural has both forms in both languages", () => {
    for (const language of [inspectEn, inspectEs]) {
      for (const key of Object.keys(language)) {
        if (key.endsWith("_plural")) expect(language[key.replace(/_plural$/, "")]).toBeDefined();
      }
    }
  });
});

describe("every key the screen asks for exists", () => {
  const SOURCES = ["app/(app)/inspect", "components/supervisor/inspect", "lib/inspections"];
  const root = path.resolve(__dirname, "../../..");
  const files = SOURCES.flatMap((dir) => {
    const full = path.join(root, dir);
    if (fs.statSync(full).isFile()) return [full];
    return fs
      .readdirSync(full, { recursive: true })
      .map(String)
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .map((name) => path.join(full, name));
  });
  const literal = new Set<string>();
  for (const file of files) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(/\bt\(\s*["'`](inspect\.[A-Za-z0-9_.]+)["'`]/g)) literal.add(match[1]);
  }

  it("found the code to scan", () => {
    expect(files.length).toBeGreaterThan(25);
    expect(literal.size).toBeGreaterThan(60);
  });

  it.each([...literal].sort())("%s exists in English and Spanish", (key) => {
    expect(inspectEn[key] ?? inspectEn[`${key}_plural`]).toBeDefined();
    expect(inspectEs[key] ?? inspectEs[`${key}_plural`]).toBeDefined();
  });

  const dynamic = [
    ...["arrival", "vip", "overdue"].map((k) => `inspect.filter.priority.${k}`),
    ...["initial", "reinspection"].map((k) => `inspect.filter.review.${k}`),
    ...["departure", "stayover"].map((k) => `inspect.filter.clean.${k}`),
    ...["priority", "waiting", "room", "floor"].map((k) => `inspect.filter.sort.${k}`),
    ...["departure", "stayover"].map((k) => `inspect.card.clean.${k}`),
    ...["overdue", "arrival", "vip", "priority", "reinspection"].map((k) => `inspect.card.badge.${k}`),
    ...["needs_action", "with_housekeeper", "awaiting_reinspection"].map((k) => `inspect.correction.status.${k}`),
    ...["correction_missing", "unassigned", "assigned", "in_progress", "escalated", "resubmitted", "cancelled", "verified", "superseded"].map((k) => `inspect.correction.detail.${k}`),
    ...["touch_up", "reclean"].map((k) => `inspect.correction.kind.${k}`),
    ...["passed", "failed", "conditional", "unknown"].map((k) => `inspect.result.${k}`),
    ...["queue", "corrections", "done"].map((k) => `inspect.tabs.${k}`),
    ...["waiting", "corrections", "passed"].map((k) => `inspect.metric.${k}`),
    ...["errorTitle", "errorBody", "correctionsErrorTitle", "correctionsErrorBody", "doneErrorTitle", "doneErrorBody"].map((k) => `inspect.states.${k}`),
    ...["not_awaiting", "room_changed", "template_changed", "other_day"].flatMap((k) => [`inspect.workspace.blocked.${k}.title`, `inspect.workspace.blocked.${k}.body`]),
    ...["network", "unauthorized", "server"].map((k) => `inspect.workspace.context.error.${k}`),
    ...["open", "escalated", "in_progress", "on_hold"].map((k) => `inspect.workspace.context.orderStatus.${k}`),
    ...["stale_draft_cleared", "draft_corrupt"].map((k) => `inspect.workspace.notice.${k}`),
    ...["pass", "fail", "na"].flatMap((k) => [`inspect.workspace.answer.${k}`, `inspect.workspace.reviewScreen.count.${k}A11y`]),
    ...["signed_out", "invalid_link", "queue_failed", "needs_connection", "not_awaiting", "templates_failed", "read_failed"].flatMap((k) => [`inspect.workspace.unavailable.${k}.title`, `inspect.workspace.unavailable.${k}.body`]),
  ];
  it.each(dynamic)("%s exists in English and Spanish", (key) => {
    expect(inspectEn[key]).toBeDefined();
    expect(inspectEs[key]).toBeDefined();
  });
});
