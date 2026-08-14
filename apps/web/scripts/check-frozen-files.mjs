#!/usr/bin/env node
// Frozen-file + room-status-value guard (FOUND-02). Mirrors
// apps/api/scripts/check_bare_role_comparisons.py's shape: scan -> compare
// to a reasoned allowlist -> exit 1 with an actionable message.
//
// Two independent freeze classes, deliberately kept separate:
//   1. "files"              -- NAME-freeze, sha256 of full byte contents.
//                              A legitimate change bumps the hash in
//                              frozen-files.json AND adds a reasoned entry
//                              to frozen-files-allowlist.json in the same PR.
//   2. "room_status_values" -- VALUE-freeze. NO allowlist escape exists for
//                              this class, by design (no allowlist lookup is
//                              ever performed for it) -- a mismatch is always
//                              a hard failure.
//
// Content-hash (not git-diff) so this is deterministic and works outside a
// PR/diff context, e.g. a plain local run against the working tree.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');

const MANIFEST_PATH = path.join(WEB_ROOT, 'frozen-files.json');
const ALLOWLIST_PATH = path.join(WEB_ROOT, 'frozen-files-allowlist.json');
const GLOBALS_CSS_PATH = path.join(WEB_ROOT, 'app', 'globals.css');
const TAILWIND_CONFIG_PATH = path.join(WEB_ROOT, 'tailwind.config.ts');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return { entries: [] };
  return loadJson(ALLOWLIST_PATH);
}

// -- CSS / TS block extraction (brace-depth aware, flat declarations only) --

function extractBraceBlock(text, selectorRegexSource) {
  const m = new RegExp(`${selectorRegexSource}\\s*\\{`).exec(text);
  if (!m) throw new Error(`Could not find block matching /${selectorRegexSource}/ `);
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

function parseTsHexPairs(block) {
  const result = {};
  const re = /(?:'([a-zA-Z0-9-]+)'|([a-zA-Z0-9-]+))\s*:\s*'(#[0-9a-fA-F]{3,8})'/g;
  let m;
  while ((m = re.exec(block))) result[m[1] ?? m[2]] = m[3];
  return result;
}

function liveRoomStatusCssVars() {
  const cssText = readFileSync(GLOBALS_CSS_PATH, 'utf8');
  return {
    light: parseCssVars(extractBraceBlock(cssText, ':root')),
    dark: parseCssVars(extractBraceBlock(cssText, '\\.theme-dark')),
  };
}

function liveTailwindStatusHex() {
  const tsText = readFileSync(TAILWIND_CONFIG_PATH, 'utf8');
  return parseTsHexPairs(extractBraceBlock(tsText, 'status\\s*:'));
}

// -- Comparison primitives (shared by the real check AND --self-test, so the
//    self-test proves the exact logic used in the production path) --

function isFileHashAllowed(file, actualHash, allowlist) {
  return (allowlist.entries || []).some(
    (e) => e.file === file && e.new_hash === actualHash && e.approved
  );
}

function valuesMatch(expected, actual) {
  if (actual === undefined) return false;
  return expected.toLowerCase() === actual.toLowerCase();
}

// -- Real checks against the working tree --

function checkFrozenFiles(manifest, allowlist) {
  const violations = [];
  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (!existsSync(absPath)) {
      violations.push({ kind: 'missing-file', file: relPath, expectedHash });
      continue;
    }
    const actualHash = sha256(readFileSync(absPath));
    if (actualHash === expectedHash) continue;
    if (isFileHashAllowed(relPath, actualHash, allowlist)) continue;
    violations.push({ kind: 'file-hash', file: relPath, expectedHash, actualHash });
  }
  return violations;
}

function checkRoomStatusValues(manifest) {
  const violations = [];
  const live = liveRoomStatusCssVars();

  for (const [statusKey, def] of Object.entries(manifest.room_status_values.tokens)) {
    for (const mode of ['light', 'dark']) {
      for (const cssVar of def.css_vars) {
        const expected = def[mode][cssVar];
        const actual = live[mode][cssVar];
        if (!valuesMatch(expected, actual)) {
          violations.push({
            kind: 'room-status-css',
            statusKey,
            mode,
            cssVar,
            expected,
            actual: actual ?? '(not found)',
          });
        }
      }
    }
  }

  const liveTwHex = liveTailwindStatusHex();
  for (const [key, expected] of Object.entries(manifest.room_status_values.tailwind_hardcoded_hex)) {
    if (key === '_note') continue;
    const actual = liveTwHex[key];
    if (!valuesMatch(expected, actual)) {
      violations.push({
        kind: 'room-status-tailwind',
        key,
        expected,
        actual: actual ?? '(not found)',
      });
    }
  }

  return violations;
}

function printViolation(v) {
  if (v.kind === 'missing-file') {
    console.log(`  [FROZEN FILE MISSING] ${v.file}`);
    console.log(`    expected sha256: ${v.expectedHash}`);
    console.log('    File no longer exists at its frozen path.');
  } else if (v.kind === 'file-hash') {
    console.log(`  [FROZEN FILE CHANGED] ${v.file}`);
    console.log(`    expected sha256: ${v.expectedHash}`);
    console.log(`    actual   sha256: ${v.actualHash}`);
    console.log(
      '    Fix: bump the hash in apps/web/frozen-files.json AND add a reasoned entry ' +
        `{ "file": "${v.file}", "new_hash": "${v.actualHash}", "reason": "...", "approved": true } ` +
        'to apps/web/frozen-files-allowlist.json.'
    );
  } else if (v.kind === 'room-status-css') {
    console.log(`  [ROOM-STATUS VALUE CHANGED] ${v.statusKey} ${v.cssVar} (${v.mode})`);
    console.log(`    expected: ${v.expected}`);
    console.log(`    actual:   ${v.actual}`);
    console.log('    NON-ALLOWLISTABLE: room-status values are hard-frozen. Revert this value.');
  } else if (v.kind === 'room-status-tailwind') {
    console.log(`  [ROOM-STATUS VALUE CHANGED] tailwind.config.ts colors.status.${v.key}`);
    console.log(`    expected: ${v.expected}`);
    console.log(`    actual:   ${v.actual}`);
    console.log('    NON-ALLOWLISTABLE: room-status values are hard-frozen. Revert this value.');
  }
}

function runCheck() {
  const manifest = loadJson(MANIFEST_PATH);
  const allowlist = loadAllowlist();

  const fileViolations = checkFrozenFiles(manifest, allowlist);
  const roomStatusViolations = checkRoomStatusValues(manifest);
  const all = [...fileViolations, ...roomStatusViolations];

  if (all.length === 0) {
    console.log(
      `OK: ${Object.keys(manifest.files).length} frozen files unchanged (or allowlisted); ` +
        'all room-status values match the frozen manifest.'
    );
    process.exit(0);
  }

  console.log(`FAILED: ${all.length} frozen-file guard violation(s):\n`);
  for (const v of all) printViolation(v);
  console.log('');
  process.exit(1);
}

// -- Self-test: proves the guard's detection logic in-memory, without ever
//    tampering a real tracked file. --

function report(label, passed) {
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}`);
  return passed;
}

function runSelfTest() {
  console.log('Running check-frozen-files self-test (in-memory only, no real files touched)\n');
  let allPassed = true;

  {
    const expectedHash = sha256(Buffer.from('original content'));
    const actualHash = sha256(Buffer.from('tampered content'));
    const allowed = isFileHashAllowed('fake/File.tsx', actualHash, { entries: [] });
    const wouldFail = actualHash !== expectedHash && !allowed;
    allPassed = report('Tampered file hash with empty allowlist is flagged (exit-1-worthy)', wouldFail) && allPassed;
  }

  {
    const expectedHash = sha256(Buffer.from('original content'));
    const actualHash = sha256(Buffer.from('tampered content'));
    const allowlist = {
      entries: [{ file: 'fake/File.tsx', new_hash: actualHash, reason: 'test', approved: true }],
    };
    const allowed = isFileHashAllowed('fake/File.tsx', actualHash, allowlist);
    const wouldFail = actualHash !== expectedHash && !allowed;
    allPassed = report('Tampered file hash WITH matching allowlist entry is NOT flagged', !wouldFail) && allPassed;
  }

  {
    // Room-status comparisons never consult an allowlist at all -- valuesMatch
    // takes no allowlist parameter, by design, proving the non-allowlistable path.
    const flagged = !valuesMatch('#a6263c', '#ff0000');
    allPassed = report(
      'Changed room-status value is flagged, with no allowlist parameter available to bypass it',
      flagged
    ) && allPassed;
  }

  {
    const flagged = !valuesMatch('#a6263c', '#A6263C');
    allPassed = report('Unchanged room-status value (case-insensitive) is NOT flagged', !flagged) && allPassed;
  }

  console.log('');
  if (allPassed) {
    console.log('Self-test PASSED.');
    process.exit(0);
  }
  console.log('Self-test FAILED.');
  process.exit(1);
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  runCheck();
}
