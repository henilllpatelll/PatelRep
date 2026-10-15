#!/usr/bin/env node
/**
 * Writes lib/app/licenses.generated.json: the notices for the open-source packages PatelRep ships directly
 * (apps/mobile/package.json "dependencies"), read from the installed packages themselves.
 *
 *   node scripts/generate-licenses.js          write the file
 *   node scripts/generate-licenses.js --check  exit 1 if the committed file is out of date
 *
 * Only direct dependencies are listed: each of those packages pulls in further packages, which carry their own
 * notices. The screen says so; it never presents this list as the complete inventory.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "lib", "app", "licenses.generated.json");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const searchDirs = [path.join(root, "node_modules"), path.resolve(root, "..", "..", "node_modules")];
const LICENSE_FILE = /^(licen[sc]e|copying)([._-][a-z]+)*$/i;

function findPackageDir(name) {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function spdx(meta) {
  if (typeof meta.license === "string") return meta.license;
  if (meta.license && typeof meta.license.type === "string") return meta.license.type;
  if (Array.isArray(meta.licenses)) return meta.licenses.map((l) => l.type).filter(Boolean).join(" OR ") || null;
  return null;
}

function repository(meta) {
  const raw = typeof meta.repository === "string" ? meta.repository : meta.repository && meta.repository.url;
  if (!raw) return null;
  return raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://");
}

const entries = Object.keys(pkg.dependencies)
  .sort((a, b) => a.localeCompare(b, "en"))
  .map((name) => {
    const dir = findPackageDir(name);
    if (!dir) throw new Error(`${name} is a dependency but is not installed; run npm install first.`);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    // Every license file the package ships (a font package has LICENSE for its code and LICENSE_FONT for the typeface).
    const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
    const texts = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
    const text = texts.length ? texts.join("\n\n----------------------------------------\n\n") : null;
    return { name, version: meta.version, license: spdx(meta), repository: repository(meta), text };
  });

const next = JSON.stringify({ source: "apps/mobile/package.json dependencies", packages: entries }, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== next) {
    console.error("lib/app/licenses.generated.json is out of date. Run: node scripts/generate-licenses.js");
    process.exit(1);
  }
  console.log("licenses.generated.json is up to date");
} else {
  fs.writeFileSync(out, next);
  console.log(`Wrote ${entries.length} packages to ${path.relative(root, out)}`);
}
