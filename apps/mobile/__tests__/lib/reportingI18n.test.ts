import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18next from "i18next";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { SUPPLY_CATALOG } from "@/lib/housekeeping/supplyRequest";
import { MAINTENANCE_CATEGORIES, MAINTENANCE_PRIORITIES } from "@/lib/housekeeping/maintenanceReport";
import { EXCEPTION_REASONS } from "@/lib/housekeeping/serviceException";

/**
 * The Report / More sheets and forms must read in English and Spanish: every key the
 * code asks for exists in both languages, the two files carry the same keys under
 * the reporting namespaces, and the Spanish text really differs from the English.
 */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`)));
}

const ROOT = resolve(__dirname, "../..");
const FILES = [
  "components/housekeeping/ReportIssueModal.tsx",
  "components/housekeeping/SupplyRequestModal.tsx",
  "components/housekeeping/FoundItemModal.tsx",
  "components/housekeeping/roomDetail/ReportMoreSheet.tsx",
  "components/housekeeping/roomDetail/ServiceExceptionSheet.tsx",
  "components/housekeeping/roomDetail/RoomNoteSheet.tsx",
  "components/housekeeping/roomDetail/RoomFlagsSheet.tsx",
  "components/housekeeping/roomDetail/SyncDetailsSheet.tsx",
  "components/housekeeping/roomDetail/PhotoAttachment.tsx",
  "components/housekeeping/roomDetail/CompleteCleaningSheet.tsx",
  "lib/housekeeping/useDiscardGuard.ts",
];

function has(tree: Tree, path: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = node[part];
  }
  return node !== undefined;
}

const NAMESPACES = ["supplies", "reportIssue", "foundItem"] as const;

describe("reporting sheets: translations", () => {
  it.each(NAMESPACES)("%s has identical keys in English and Spanish", (namespace) => {
    const enKeys = leaves((en as unknown as Record<string, Tree>)[namespace]).sort();
    const esKeys = leaves((es as unknown as Record<string, Tree>)[namespace]).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("rooms.work has identical keys in English and Spanish", () => {
    const enKeys = leaves((en as unknown as { rooms: { work: Tree } }).rooms.work).sort();
    const esKeys = leaves((es as unknown as { rooms: { work: Tree } }).rooms.work).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("every literal key the sheets ask for exists in both languages", () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      const keys = new Set<string>();
      for (const match of source.matchAll(/\bt\(\s*(?:[^"'`()]*\?\s*)?["']([a-zA-Z0-9_.]+)["']/g)) keys.add(match[1]);
      for (const match of source.matchAll(/:\s*["']((?:rooms|reportIssue|supplies|foundItem|common|blockers)\.[a-zA-Z0-9_.]+)["']/g)) keys.add(match[1]);
      for (const key of keys) {
        const resolvable = (tree: unknown) => has(tree as Tree, key) || has(tree as Tree, `${key}_plural`);
        if (!resolvable(en) || !resolvable(es)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every dynamic key family is fully translated", () => {
    const wanted = [
      ...SUPPLY_CATALOG.map((item) => item.labelKey),
      ...MAINTENANCE_CATEGORIES.map((value) => `reportIssue.categories.${value}`),
      ...MAINTENANCE_PRIORITIES.map((value) => `reportIssue.priorities.${value}`),
      ...EXCEPTION_REASONS.flatMap((value) => [`rooms.work.exception.reasons.${value}.label`, `rooms.work.exception.reasons.${value}.hint`]),
      ...["exception", "issue", "supplies", "found", "note", "flags", "info", "linen", "sync"].flatMap((id) => [
        `rooms.work.more.rows.${id}.title`,
        `rooms.work.more.rows.${id}.hint`,
      ]),
      ...["needsConnection", "cleaningStarted", "linenLocked"].map((reason) => `rooms.work.more.disabled.${reason}`),
      ...["start", "checklist", "linen", "completion", "work_order", "work_order_update", "room_status", "task", "logbook", "other"].map(
        (kind) => `rooms.work.sync.kinds.${kind}`,
      ),
      ...["pending", "retrying", "failed", "conflict"].map((state) => `rooms.work.sync.states.${state}`),
      ...["required", "invalid", "past"].map((code) => `rooms.work.exception.errors.time.${code}`),
      ...["required", "tooShort", "tooLong"].map((code) => `rooms.work.exception.errors.note.${code}`),
      "rooms.work.exception.errors.reason.required",
      "reportIssue.errors.title.required",
      "reportIssue.errors.title.tooLong",
      "reportIssue.errors.category.required",
      "supplies.errors.empty",
      "supplies.errors.noteTooLong",
    ];
    const missing = wanted.filter((key) => !has(en as unknown as Tree, key) || !has(es as unknown as Tree, key));
    expect(missing).toEqual([]);
  });

  it("Spanish is actually translated for the key reporting strings", () => {
    for (const key of ["supplies.send", "reportIssue.submit", "foundItem.submit", "rooms.work.exception.submit", "rooms.work.sync.retry", "rooms.work.more.rows.exception.title"]) {
      const english = key.split(".").reduce<unknown>((node, part) => (node as Tree)[part], en) as unknown as string;
      const spanish = key.split(".").reduce<unknown>((node, part) => (node as Tree)[part], es) as unknown as string;
      expect(spanish).not.toBe(english);
    }
  });

  it("resolves through a real i18next instance in Spanish, with interpolation filled in", () => {
    const i18n = i18next.createInstance();
    void i18n.init({
      resources: { en: { translation: en }, es: { translation: es } },
      lng: "es",
      fallbackLng: false,
      compatibilityJSON: "v3",
      interpolation: { escapeValue: false },
      initImmediate: false,
    });
    expect(i18n.t("rooms.work.exception.title", { room: "314" })).toBe("No puedo entrar — Habitación 314");
    expect(i18n.t("supplies.total", { count: 6 })).toBe("Total solicitado: 6");
    expect(i18n.t("rooms.work.sync.rowWithRoom", { room: "218", kind: "Conteo de blancos" })).toBe("Habitación 218 — Conteo de blancos");
    expect(i18n.t("rooms.work.sync.kinds.checklist", { count: 3 })).toContain("3");
  });
});
