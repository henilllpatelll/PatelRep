import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

type Tree = { [key: string]: string | Tree };

function leaves(node: Tree, prefix = ""): Record<string, string> {
  return Object.entries(node).reduce<Record<string, string>>((acc, [key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...acc, [next]: value } : { ...acc, ...leaves(value, next) };
  }, {});
}

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, "")).sort();
const ROOT = path.resolve(__dirname, "../..");
const SOURCES = ["app/(app)/pm-schedules", "components/engineering/pm/management", "components/engineering/assets", "components/engineering/pm", "app/(app)/assets", "lib/engineering"];

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("PM management strings", () => {
  const collect = (root: Tree) => ({
    ...leaves(root.pmMgmt as Tree, "pmMgmt"),
    ...leaves((root.assets as Tree).criticality as Tree, "assets.criticality"),
    ...leaves((root.assets as Tree).management as Tree, "assets.management"),
    ...leaves((root.assets as Tree).downtime as Tree, "assets.downtime"),
    ...leaves(((root.assets as Tree).detail as Tree).warrantyState as Tree, "assets.detail.warrantyState"),
  });
  const enLeaves = collect(en as unknown as Tree);
  const esLeaves = collect(es as unknown as Tree);

  it("Spanish has exactly the English keys, with the same placeholders", () => {
    expect(Object.keys(esLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
    for (const [key, text] of Object.entries(enLeaves)) expect(placeholders(esLeaves[key])).toEqual(placeholders(text));
  });

  it("no string is empty", () => {
    for (const [key, text] of [...Object.entries(enLeaves), ...Object.entries(esLeaves)]) expect(`${key}=${text.trim().length > 0}`).toBe(`${key}=true`);
  });

  it("every literal key the screens and sheets ask for exists", () => {
    const used = new Set<string>();
    for (const file of SOURCES.flatMap(sourceFiles)) {
      const code = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of code.matchAll(/\bt\(\s*"((?:pmMgmt|assets\.criticality|assets\.management|assets\.downtime|assets\.detail\.warrantyState)\.[\w.]+)"/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(40);
    const known = new Set(Object.keys(enLeaves).flatMap((k) => [k, k.replace(/_plural$/, "")]));
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
  });

  it("every dynamic key family the code builds is fully present", () => {
    const families: Array<[string, string[]]> = [
      ["pmMgmt.failure", ["version_conflict", "schedule_inactive", "assignee_ineligible", "self_review", "already_decided", "stale", "expired", "pending_exists", "unavailable", "forbidden", "not_found", "validation", "unconfirmed", "failed"]],
      ["pmMgmt.assign.done", ["assigned", "reassigned", "unassigned"]],
      ["pmMgmt.deferral.problem", ["reason_short", "reason_long", "date_missing", "date_not_later", "date_past"]],
      ["pmMgmt.programs.filter", ["all", "overdue", "unassigned", "checklist"]],
      ["pmMgmt.programs.checklist", ["unassigned", "missing", "inactive", "incompatible"]],
      ["pmMgmt.approvals.status", ["pending", "approved", "rejected"]],
      ["pmMgmt.performance.metric", ["onTime", "late", "overdue", "upcoming", "deferred", "findings"]],
      ["pmMgmt.period", ["today", "week", "month"]],
      ["assets.criticality.help", ["low", "medium", "high", "life_safety"]],
      ["pmMgmt.form.problem", ["asset_missing", "name_missing", "name_long", "description_long", "interval_days", "minutes", "due_missing", "due_past", "checklist_missing"]],
      ["assets.management.group", ["critical", "out_of_service", "active_repairs", "warranty_expiring", "warranty_expired"]],
      ["assets.management.about", ["critical", "out_of_service", "active_repairs", "warranty_expiring", "warranty_expired"]],
      ["assets.downtime.done", ["started", "ended", "already_open"]],
      ["assets.detail.warrantyState", ["active", "expiring_soon", "expired"]],
    ];
    for (const [family, keys] of families) for (const key of keys) expect(enLeaves[`${family}.${key}`]).toBeTruthy();
  });
});
