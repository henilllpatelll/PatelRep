import fs from "fs";
import path from "path";

/* Source-level guards for the whole Assignments surface (Phases 1-8). They cannot replace a screen reader or a
   device, but they stop the two regressions that are easiest to introduce and hardest to see: a user-visible
   translation key that exists in only one language, and a tappable control a screen reader cannot name. */

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")) as Record<string, unknown>;
const en = read("i18n/locales/en.json");
const es = read("i18n/locales/es.json");

const lookup = (tree: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

const hasKey = (tree: Record<string, unknown>, key: string) => {
  if (lookup(tree, key) !== undefined) return true;
  // i18next plurals: key_one / key_other (and Spanish _many)
  const parts = key.split(".");
  const last = parts.pop() as string;
  const parent = lookup(tree, parts.join(".")) as Record<string, unknown> | undefined;
  return !!parent && ["_one", "_other", "_many", "_zero"].some((suffix) => `${last}${suffix}` in parent);
};

const dirs = ["components/supervisor/assignments", "app/(app)/assignments"];
const files = dirs.flatMap((dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((name) => /\.tsx$/.test(name))
    .map((name) => path.join(root, dir, name)),
);
const libFiles = fs
  .readdirSync(path.join(root, "lib/housekeeping"))
  .filter((name) => /^(assignment|smartBalance|useAssignment|useBulk|useMidshift|useSmartBalance|useBatch)/.test(name) && name.endsWith(".ts"))
  .map((name) => path.join(root, "lib/housekeeping", name));

describe("every static translation key used by Assignments exists in English and Spanish", () => {
  const keyPattern = /\bt\(\s*["'`]((?:assignments|roomBoard|common|supervisorToday)\.[A-Za-z0-9_.]+)["'`]/g;
  const used = new Map<string, string>();
  for (const file of [...files, ...libFiles]) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(keyPattern)) used.set(match[1], path.relative(root, file));
  }

  it("finds a realistic number of keys (the scan is not silently empty)", () => {
    expect(used.size).toBeGreaterThan(150);
  });

  it("English has them all", () => {
    const missing = [...used].filter(([key]) => !hasKey(en, key)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it("Spanish has them all", () => {
    const missing = [...used].filter(([key]) => !hasKey(es, key)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it("Spanish never leaves an English sentence behind in the assignments tree", () => {
    const sameText: string[] = [];
    const walk = (a: unknown, b: unknown, trail: string) => {
      if (typeof a === "string" && typeof b === "string") {
        // Short labels (names, units, brand terms) may legitimately match; a whole sentence should not.
        if (a === b && a.split(/\s+/).length >= 6) sameText.push(trail);
      } else if (a && b && typeof a === "object" && typeof b === "object") {
        for (const key of Object.keys(a as object)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${trail}.${key}`);
      }
    };
    walk(lookup(en, "assignments.v2"), lookup(es, "assignments.v2"), "assignments.v2");
    expect(sameText).toEqual([]);
  });
});

describe("tappable controls can be named by a screen reader", () => {
  /** Every `<Pressable ...>` opening tag in the Assignments components. */
  const tags: Array<{ file: string; tag: string }> = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/<Pressable\b[\s\S]*?(?<!=)>/g)) tags.push({ file: path.relative(root, file), tag: match[0] });
  }

  it("scans a realistic number of controls", () => {
    expect(tags.length).toBeGreaterThan(15);
  });

  it("each has a role, or is a decorative backdrop hidden from assistive tech", () => {
    const bare = tags.filter(({ tag }) => !/accessibilityRole=/.test(tag) && !/accessible=\{false\}/.test(tag)).map(({ file, tag }) => `${file}: ${tag.slice(0, 80).replace(/\s+/g, " ")}`);
    expect(bare).toEqual([]);
  });

  it("each named control carries a label, or is a row that composes one", () => {
    const unlabeled = tags
      .filter(({ tag }) => /accessibilityRole=/.test(tag) && !/accessibilityLabel=/.test(tag) && !/accessibilityLabelledBy/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.slice(0, 90).replace(/\s+/g, " ")}`);
    // A Pressable that wraps visible text is named by that text; the guard is for icon-only controls.
    const iconOnly = unlabeled.filter((entry) => /size=\{|Ionicons/.test(entry));
    expect(iconOnly).toEqual([]);
  });
});
