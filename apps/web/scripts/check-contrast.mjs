#!/usr/bin/env node
// Dark-mode WCAG AA contrast gate (FOUND-04). Pure-Node relative-luminance
// computation over static token hex -- no axe/Lighthouse, no browser. That
// heavier rendered-page tooling belongs to the final-QA sweep (Phase 37),
// not this token-matrix gate.
//
// Scope is deliberately split in two, per 30-CONTEXT.md's room-status
// hard-constraint (no allowlist escape, values can never change):
//   ENFORCED    -- NEW-token pairings introduced in Plan 30-04. The gate
//                  exits 1 if any of these falls below its WCAG threshold,
//                  in either light or dark.
//   REPORT-ONLY -- frozen room-status text-on-soft pairings. Recorded for
//                  visibility. NEVER fail the gate, NEVER trigger a "fix"
//                  suggestion -- those values are value-frozen by hard
//                  constraint, and tuning them would itself violate FOUND-02.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');

const GLOBALS_CSS_PATH = path.join(WEB_ROOT, 'app', 'globals.css');
const MANIFEST_PATH = path.join(WEB_ROOT, 'frozen-files.json');
const CONTRAST_MD_PATH = path.join(
  REPO_ROOT,
  '.planning',
  'phases',
  '30-additive-foundation-regression-harness',
  'CONTRAST.md'
);

const AA_TEXT = 4.5; // body text
const AA_UI = 3.0; // large text / UI components

// -- CSS parsing (same brace-depth approach as check-frozen-files.mjs) --

function extractBraceBlock(text, selectorRegexSource) {
  const m = new RegExp(`${selectorRegexSource}\\s*\\{`).exec(text);
  if (!m) throw new Error(`Could not find block matching /${selectorRegexSource}/`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
  }
  return text.slice(start, i - 1);
}

function parseCssVars(block) {
  const vars = {};
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) vars[m[1]] = m[2].trim();
  return vars;
}

// -- WCAG relative luminance + contrast ratio --

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null; // non-solid (e.g. color-mix(...)) or shorthand not in use here
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}

function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA, hexB) {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return null;
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// -- Pairing sets --
// ENFORCED pairings render wherever the new 30-04 tokens are consumed:
//   --brand-ink is the button/label text color for the new brand-ramp fill.
//   --ink / --ink-2 are the existing body/secondary text tokens, now also
//   read against the two new elevation surfaces (raised cards, overlays).
const ENFORCED_PAIRINGS = [
  { label: '--brand-ink on --brand', fg: '--brand-ink', bg: '--brand', threshold: AA_TEXT, thresholdLabel: '4.5:1 (text)' },
  { label: '--ink on --surface-raised', fg: '--ink', bg: '--surface-raised', threshold: AA_TEXT, thresholdLabel: '4.5:1 (text)' },
  { label: '--ink-2 on --surface-raised', fg: '--ink-2', bg: '--surface-raised', threshold: AA_TEXT, thresholdLabel: '4.5:1 (text)' },
  { label: '--ink on --surface-overlay', fg: '--ink', bg: '--surface-overlay', threshold: AA_TEXT, thresholdLabel: '4.5:1 (text)' },
  { label: '--ink-2 on --surface-overlay', fg: '--ink-2', bg: '--surface-overlay', threshold: AA_TEXT, thresholdLabel: '4.5:1 (text)' },
];

// SKIPPED: --focus-ring is `color-mix(in srgb, var(--brand) 45%, transparent)` --
// not a solid color and not a text/background pairing (it's an outline ring
// evaluated against whatever sits behind a focused element's edge, not run
// through this token-pair matrix). Documented here, not computed.
const SKIPPED_TOKENS = [
  {
    token: '--focus-ring',
    reason:
      "color-mix(in srgb, var(--brand) 45%, transparent) is not a solid hex color and isn't a fg/bg text pairing -- it's an outline ring, not applicable to this matrix.",
  },
];

function buildReportOnlyPairings(manifest) {
  return Object.entries(manifest.room_status_values.tokens).map(([statusKey, def]) => ({
    label: `${statusKey}: ${def.css_vars[0]} on ${def.css_vars[1]}`,
    fg: def.css_vars[0],
    bg: def.css_vars[1],
    threshold: AA_TEXT,
    thresholdLabel: '4.5:1 (text)',
  }));
}

function loadThemeVars() {
  const cssText = readFileSync(GLOBALS_CSS_PATH, 'utf8');
  const light = parseCssVars(extractBraceBlock(cssText, ':root'));
  const darkOverrides = parseCssVars(extractBraceBlock(cssText, '\\.theme-dark'));
  // .theme-dark only overrides a subset of vars; CSS custom properties cascade,
  // so anything not redeclared there (e.g. --brand-ink) still resolves from :root.
  return { light, dark: { ...light, ...darkOverrides } };
}

function evaluatePairings(pairings, themeVars, mode) {
  const vars = themeVars[mode];
  return pairings.map((p) => {
    const fgHex = vars[p.fg];
    const bgHex = vars[p.bg];
    const ratio = fgHex && bgHex ? contrastRatio(fgHex, bgHex) : null;
    return {
      ...p,
      mode,
      fgHex: fgHex ?? '(not found)',
      bgHex: bgHex ?? '(not found)',
      ratio,
      pass: ratio !== null && ratio >= p.threshold,
    };
  });
}

function fmtRatio(r) {
  return r === null ? 'n/a' : `${r.toFixed(2)}:1`;
}

function buildMarkdown(enforcedResults, reportOnlyResults) {
  const lines = [];
  lines.push('# Dark-Mode WCAG AA Contrast Audit — Phase 30 (FOUND-04)');
  lines.push('');
  lines.push('Generated by `apps/web/scripts/check-contrast.mjs` (`npm run check:contrast`). Do not hand-edit.');
  lines.push('');
  lines.push('## Enforced — New-Token Pairings (FOUND-04 scope)');
  lines.push('');
  lines.push('The gate **exits 1** if any row below is below its threshold, in either mode.');
  lines.push('');
  lines.push('| Pairing | Mode | Foreground | Background | Ratio | Threshold | Result |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of enforcedResults) {
    lines.push(
      `| ${r.label} | ${r.mode} | ${r.fgHex} | ${r.bgHex} | ${fmtRatio(r.ratio)} | ${r.thresholdLabel} | ${r.pass ? 'PASS' : 'FAIL'} |`
    );
  }
  lines.push('');
  lines.push('## Report-Only — Frozen Room-Status Pairings (value-frozen, no allowlist, never enforced)');
  lines.push('');
  lines.push(
    'These pairings are recorded for visibility only. A ratio below threshold here is **never** a gate failure, ' +
      'and the underlying token values are **never** tuned in response — they are hard-frozen per `FROZEN.md` ' +
      '(retuning a room-status value would itself violate the FOUND-02 freeze).'
  );
  lines.push('');
  lines.push('| Room status pairing | Mode | Foreground | Background | Ratio | Threshold | Note |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of reportOnlyResults) {
    const note = r.pass ? 'report-only (frozen room-status — not enforceable)' : 'below AA — report-only (frozen room-status — not enforceable, not tuned)';
    lines.push(`| ${r.label} | ${r.mode} | ${r.fgHex} | ${r.bgHex} | ${fmtRatio(r.ratio)} | ${r.thresholdLabel} | ${note} |`);
  }
  lines.push('');
  lines.push('## Skipped');
  lines.push('');
  for (const s of SKIPPED_TOKENS) {
    lines.push(`- \`${s.token}\`: ${s.reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const themeVars = loadThemeVars();

  const reportOnlyPairings = buildReportOnlyPairings(manifest);

  const enforcedResults = [
    ...evaluatePairings(ENFORCED_PAIRINGS, themeVars, 'light'),
    ...evaluatePairings(ENFORCED_PAIRINGS, themeVars, 'dark'),
  ];
  const reportOnlyResults = [
    ...evaluatePairings(reportOnlyPairings, themeVars, 'light'),
    ...evaluatePairings(reportOnlyPairings, themeVars, 'dark'),
  ];

  const markdown = buildMarkdown(enforcedResults, reportOnlyResults);
  writeFileSync(CONTRAST_MD_PATH, markdown, 'utf8');

  const failures = enforcedResults.filter((r) => !r.pass);

  console.log(`Enforced new-token pairings checked: ${enforcedResults.length} (both modes)`);
  console.log(`Report-only frozen room-status pairings recorded: ${reportOnlyResults.length} (both modes, never fail)`);
  console.log(`CONTRAST.md written: ${path.relative(REPO_ROOT, CONTRAST_MD_PATH)}`);
  console.log('');

  if (failures.length > 0) {
    console.log(`FAILED: ${failures.length} enforced new-token pairing(s) below WCAG AA:\n`);
    for (const f of failures) {
      console.log(`  [FAIL] ${f.label} (${f.mode}): ${f.fgHex} on ${f.bgHex} = ${fmtRatio(f.ratio)}, needs >= ${f.thresholdLabel}`);
    }
    process.exit(1);
  }

  console.log('OK: all enforced new-token pairings meet WCAG AA in both light and dark.');
  process.exit(0);
}

main();
