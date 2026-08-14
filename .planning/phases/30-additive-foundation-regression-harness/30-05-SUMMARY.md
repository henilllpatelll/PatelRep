---
phase: 30-additive-foundation-regression-harness
plan: 05
subsystem: web-ci-gates
tags: [frozen-file-guard, wcag-contrast, ci, tokens]
dependency-graph:
  requires: ["30-04"]
  provides: ["apps/web/scripts/check-frozen-files.mjs", "apps/web/scripts/check-contrast.mjs", "apps/web/frozen-files-allowlist.json"]
  affects: ["30-06 (CI wiring)"]
tech-stack:
  added: []
  patterns: ["content-hash + reasoned-allowlist guard (mirrors apps/api/scripts/check_bare_role_comparisons.py)", "pure-Node WCAG relative-luminance contrast matrix over static token hex"]
key-files:
  created:
    - apps/web/scripts/check-frozen-files.mjs
    - apps/web/frozen-files-allowlist.json
    - apps/web/scripts/check-contrast.mjs
    - .planning/phases/30-additive-foundation-regression-harness/CONTRAST.md
  modified:
    - apps/web/package.json
    - apps/web/app/globals.css
decisions:
  - "Enforced contrast pairing set is exactly the 5 new-token combos named in the plan (--brand-ink/--brand, --ink and --ink-2 on --surface-raised and --surface-overlay) -- grounded in actual token roles, not invented"
  - "Dark --brand tuned from #e08a63 to #bd5230 (white text only reached 2.63:1 on the original; #bd5230 reaches 4.76:1) since it's a new additive token, safe to retune, unlike frozen room-status values"
  - "Room-status report-only pairings are read from frozen-files.json's room_status_values.tokens at runtime (fg = css_vars[0], bg = css_vars[1]) rather than hardcoded, so the report table stays in sync with the manifest"
metrics:
  duration: "~50 min"
  completed: "2026-08-14"
---

# Phase 30 Plan 05: Frozen-File Guard + Dark-Mode Contrast Gate Summary

Two zero-dependency Node CI gates: a sha256/value guard enforcing the Plan 30-04 freeze (FOUND-02), and a WCAG AA contrast matrix that enforces only new-token pairings while recording frozen room-status pairings report-only (FOUND-04).

## What was built

**Task 1 — `apps/web/scripts/check-frozen-files.mjs` + `apps/web/frozen-files-allowlist.json`**

Mirrors `apps/api/scripts/check_bare_role_comparisons.py`'s scan → compare-to-reasoned-allowlist → exit 1 shape, using content-hash (not git-diff) so it's deterministic outside a PR/diff context.

Two independent, clearly separated freeze classes:
- **Frozen files** (`frozen-files.json`'s `"files"` section): recomputes sha256 for each of the 7 frozen primitive/board files. A mismatch fails UNLESS `frozen-files-allowlist.json` has a matching `{ file, new_hash, reason, approved }` entry whose `new_hash` equals the current hash — allowlistable by design.
- **Room-status values** (`frozen-files.json`'s `"room_status_values"` section): re-parses live `:root`/`.theme-dark` CSS custom properties from `globals.css` and `colors.status.*` from `tailwind.config.ts`, compares against the frozen hex values. A mismatch is **always** a hard failure — the comparison function (`valuesMatch`) takes no allowlist parameter at all, so there is no code path by which a room-status value change could be allowlisted.

`apps/web/frozen-files-allowlist.json` created empty (`{ "entries": [] }`) — all 7 files remain byte-unchanged.

A `--self-test` flag exercises the exact same `isFileHashAllowed`/`valuesMatch` functions used by the real check, in-memory only, proving: (1) a tampered hash with no allowlist entry is flagged, (2) a tampered hash WITH a matching allowlist entry is not flagged, (3) a changed room-status value is flagged with no allowlist escape available, (4) an unchanged (case-insensitive) room-status value is not flagged. All 4 assertions pass.

Beyond the self-test, the guard's real detection was also verified against actual tracked files with an immediate, git-diff-confirmed revert: tampering `frozen-files.json`'s Button.tsx hash produced exit 1 with an allowlist-fix hint; tampering `globals.css`'s `--alert` value produced exit 1 with an explicit "NON-ALLOWLISTABLE" message and no allowlist hint.

**Task 2 — `apps/web/scripts/check-contrast.mjs` + `CONTRAST.md`**

~230-line pure-Node WCAG relative-luminance computation (no axe/Lighthouse/wcag-contrast dependency). Parses `:root`/`.theme-dark` from `globals.css` (dark inherits any var `.theme-dark` doesn't override, matching real CSS cascade behavior — needed for `--brand-ink`, which is only declared in `:root`).

Two pairing sets, kept structurally separate:
- **ENFORCED** (exits 1 on failure): the 5 new-token pairings named in the plan — `--brand-ink` on `--brand`, `--ink`/`--ink-2` on `--surface-raised`, `--ink`/`--ink-2` on `--surface-overlay` — each checked in both light and dark against a 4.5:1 body-text threshold (10 checks total).
- **REPORT-ONLY** (never affects exit code): each frozen room-status text token on its `-soft` background (6 statuses × 2 modes = 12 rows), derived at runtime from `frozen-files.json`'s `room_status_values.tokens` rather than hardcoded, so it can't drift out of sync with the manifest.

`--focus-ring` (`color-mix(in srgb, var(--brand) 45%, transparent)`) is a non-solid token — documented as skipped rather than force-computed, since it's an outline ring, not a text/background pairing.

Both tables written to `CONTRAST.md` on every run.

**Dark-mode `--brand` tuning (found during Task 2):** the original 30-04-proposed dark value `#e08a63` only reached **2.63:1** against white `--brand-ink` — well below AA. Retuned to `#bd5230` (**4.76:1**), keeping the terracotta hue. This is a legitimate additive-token adjustment (not a frozen-value change) — confirmed the frozen-file guard still passes clean afterward, and `--brand`/`--brand-soft`/`--brand-line` aren't part of the room-status value freeze.

Verified explicitly that a below-AA report-only row (`PICKUP` light pairing, 4.09:1, genuinely below 4.5:1) still produces exit 0 — proving report-only pairings never fail the gate.

**Task 3 — `apps/web/package.json`**

Added `check:frozen-files` and `check:contrast` npm scripts. No existing scripts altered. Both run clean via `npm run check:frozen-files && npm run check:contrast`.

## Verification performed

- `node scripts/check-frozen-files.mjs` exits 0 on the clean tree; `--self-test` passes all 4 in-memory assertions; live tamper-and-revert of both a frozen-file hash and a room-status CSS value confirmed the expected exit 1 + correct allowlist/non-allowlist messaging, with `git diff --stat` confirming a byte-exact revert afterward.
- `node scripts/check-contrast.mjs` exits 0; `CONTRAST.md` contains both tables; confirmed a genuinely-below-AA report-only row does not affect the exit code.
- `npm run check:frozen-files` and `npm run check:contrast` both exit 0 via npm.
- `npm run type-check` clean after the `globals.css` edit.
- `npm run build` (production build) succeeds, all routes prerender, no errors.
- No new npm dependency added (`git diff apps/web/package.json` shows only the two new script entries).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dark `--brand` value failed WCAG AA against `--brand-ink`**
- **Found during:** Task 2 (contrast gate first run)
- **Issue:** `globals.css`'s `.theme-dark` `--brand: #e08a63` (carried over unverified from Plan 30-04) produced only 2.63:1 contrast against white `--brand-ink`, failing the 4.5:1 AA threshold this plan's own gate is meant to enforce.
- **Fix:** Retuned to `#bd5230` (4.76:1), same terracotta hue family, documented inline in `globals.css` with the measured ratio.
- **Files modified:** `apps/web/app/globals.css`
- **Commit:** `bd278ebe`

No other deviations — the rest of the plan executed as written.

## Self-Check

- FOUND: `apps/web/scripts/check-frozen-files.mjs`
- FOUND: `apps/web/frozen-files-allowlist.json`
- FOUND: `apps/web/scripts/check-contrast.mjs`
- FOUND: `.planning/phases/30-additive-foundation-regression-harness/CONTRAST.md`
- FOUND: commit `ed01773f` (Task 1)
- FOUND: commit `bd278ebe` (Task 2)
- FOUND: commit `9d9ce3c6` (Task 3)

## Self-Check: PASSED
