---
phase: 30-additive-foundation-regression-harness
plan: 04
subsystem: web-design-system
tags: [css-tokens, design-system, frozen-primitives, regression, tailwind]

# Dependency graph
requires:
  - "30-01: regression fixture tenant + 12 committed baseline screenshots"
provides:
  - "New additive CSS tokens (motion/ease, z-index, elevation/surface-tint, v2 brand ramp, focus ring) in apps/web/app/globals.css :root + .theme-dark"
  - "Matching new Tailwind aliases in apps/web/tailwind.config.ts"
  - "apps/web/frozen-files.json — machine-readable freeze manifest (7 file sha256 + room-status value-freeze) for the 30-05 CI guard"
  - ".planning/phases/30-additive-foundation-regression-harness/FROZEN.md — human-readable frozen-primitive list + room-status hard-constraint doc"
  - "Confirmed zero-drift proof: 30-01 baseline re-run 12/12 passed after tokens landed"
affects: [30-05, 31, 32, 33, 34, 35, 36]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only token extension: new CSS custom property names alongside frozen existing ones, never editing/renaming an existing token"
    - "Value-freeze vs name-freeze distinction, tagged distinctly in the manifest (room-status colors have no allowlist escape; everything else does)"
    - "Faithful local pixel-diff re-run of a production-mode standalone build pointed at the real production API (via a gitignored .env.production.local override), since the app's CSP connect-src excludes localhost:* outside next dev — a straight `next dev` re-run is not a valid substitute for proving zero-drift against the Railway-captured baseline"

key-files:
  created:
    - apps/web/frozen-files.json
    - .planning/phases/30-additive-foundation-regression-harness/FROZEN.md
  modified:
    - apps/web/app/globals.css
    - apps/web/tailwind.config.ts

key-decisions:
  - "Visual-identity direction: 'Warm operational calm, systematized' — kept the existing warm-paper/terracotta identity (distinctive, hospitality-appropriate, avoids the dull-SaaS trap) rather than repaletting; the real upgrade is new additive systems the old palette never had (motion scale, z-index scale, elevation/surface-tint scale, focus-ring token, v2 brand ramp)"
  - "Typography: kept IBM Plex Sans/Mono + Instrument Serif unchanged — no new webfont, per the 'save floor-staff time' filter (first-paint cost on floor phones)"
  - "Kept all 4 accent themes (terracotta/teal/blue/rose) and all 3 density modes untouched — new tokens are density-agnostic and accent-independent"
  - "New --brand/--brand-ink/--brand-soft/--brand-line tokens introduced as a NEW token family rather than mutating --accent, so later phases opt in via new Tailwind aliases (brand-*) without touching the frozen --accent* values the boards read"
  - "Dark-mode values for --brand/--surface-raised/--surface-overlay hand-picked, not auto-derived (per RESEARCH.md guidance) — AA contrast to be proven by the 30-05 contrast gate, not assumed here"
  - "frozen-files.json room_status_values section is a distinct top-level key from files, explicitly tagged '_tag: room-status' with a '_note' stating there is no allowlist escape — the file-hash freeze (files) and the value freeze (room_status_values) are two different enforcement classes for the 30-05 guard to implement separately"
  - "Zero-drift re-run required a production-mode (next build + standalone server.js) re-test, not next dev: apps/web/next.config.mjs's CSP only allow-lists http://localhost:* in connect-src when NODE_ENV=development; the original 30-01 baseline was captured against the deployed Railway production build. A next dev re-run against localhost:8003 loaded data fine but is not CSP-equivalent to the baseline's capture conditions, and separately showed a small (0.01 ratio) pixel diff on 2 of 3 board surfaces that is most plausibly a Turbopack-dev-vs-production-build rendering artifact, not a token regression — so it was not used as the proof. Built a temporary, gitignored apps/web/.env.production.local pointing NEXT_PUBLIC_API_URL at the real deployed production API (already CSP-allow-listed), ran `next build` + the standalone server locally, and re-ran the regression suite against that: 12/12 passed at maxDiffPixelRatio 0, the valid proof of additive-only zero-drift. The temp env file and build artifacts were removed afterward; no deploy occurred."

patterns-established:
  - "Local production-mode re-verification for CSP-gated apps: override NEXT_PUBLIC_API_URL via a gitignored .env.production.local to an already-allow-listed origin, `next build`, copy public/.next/static into .next/standalone, run `node .next/standalone/server.js` on a scratch port, point Playwright's PLAYWRIGHT_BASE_URL at it, then delete the temp env file — reusable for any future phase that needs a byte-faithful local re-run against the production build/CSP without deploying"

# Metrics
duration: ~45min
completed: 2026-08-14
---

# Phase 30 Plan 04: Additive Foundation & Frozen-Primitive Manifest Summary

**Landed 20 new additive CSS design tokens (motion/ease/z-index/elevation/v2-brand/focus-ring) in globals.css + matching Tailwind aliases, authored the machine- and human-readable frozen-primitive/room-status-value-freeze manifests, and proved zero pixel drift on the 3 excluded Room Board surfaces via a production-mode local re-run against the real API.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3/3 complete
- **Files created:** 2 (`frozen-files.json`, `FROZEN.md`)
- **Files modified:** 2 (`globals.css`, `tailwind.config.ts`)

## Accomplishments

- Added `--motion-fast/base/slow`, `--ease-standard/emphasized/exit`, `--z-base` through `--z-tooltip` (9-step stack), `--surface-raised`, `--surface-overlay`, `--shadow-xs`, `--brand`, `--brand-ink`, `--brand-soft`, `--brand-line`, and `--focus-ring` to both `:root` and `.theme-dark` in `apps/web/app/globals.css` — confirmed via `git diff --word-diff` that every existing line in the file is byte-unchanged.
- Added matching new Tailwind aliases (`brand`, `brand-soft`, `brand-line`, `brand-ink`, `surface-raised`, `surface-overlay`, a `zIndex` scale, `transitionDuration`/`transitionTimingFunction` scales, `boxShadow.xs`) to `tailwind.config.ts` without touching any existing alias.
- `npm run build` (from `apps/web`) succeeds cleanly with the new tokens in place.
- Authored `apps/web/frozen-files.json`: sha256 for the 7 frozen files (Button, primitives, RoomCard, LogFoundItemModal, RoomStatusBoard, RoomDetailDrawer, EngineeringRoomBoard) — verified by an independent Node script that recomputes each hash fresh and diffs against the manifest (all match) — plus a distinctly-tagged `room_status_values` value-freeze (light+dark hex per room status, cross-checked against a live parse of `globals.css` — all match) and the `tailwind.config.ts` `colors.status.*` hardcoded-hex duplicates.
- Authored `FROZEN.md`: the full name-frozen file/token list, the room-status hard-constraint table, the double-duty-token warning (Pitfall 2 — `--alert`/`--info`/etc. serve both generic chrome and room-status; new generic semantics need new tokens like `--danger-v2`), the legitimate change procedure (bump hash + allowlist entry, mechanism built in 30-05), and an explicit note that primitive v2 variants are deferred to whichever later phase first needs them.
- Re-ran the 30-01 baseline regression suite and confirmed **12/12 passed at `maxDiffPixelRatio: 0`** against a production-mode (`next build` + standalone `server.js`) local re-run pointed at the real deployed production API — proving the additive tokens caused zero drift on the 3 excluded boards, matching the exact CSP/build conditions the original baseline was captured under.

## Task Commits

1. **Task 1: Additive tokens in globals.css + tailwind.config.ts** — `c77664c8` (feat)
2. **Task 2: frozen-files.json manifest** — `0b1a0a6f` (chore)
3. **Task 3: FROZEN.md + zero-drift re-run** — `128c9317` (docs)

## Files Created/Modified

- `apps/web/app/globals.css` — 20 new tokens added to `:root` (motion/ease/z-index/elevation/brand/focus, light values) and `.theme-dark` (hand-picked dark overrides for `--surface-raised`/`--surface-overlay`/`--brand`/`--brand-soft`/`--brand-line`); every pre-existing line unchanged.
- `apps/web/tailwind.config.ts` — new `colors.brand*`/`colors.surface-raised`/`colors.surface-overlay` aliases, new `zIndex`/`transitionDuration`/`transitionTimingFunction` scales, `boxShadow.xs`; every pre-existing alias unchanged.
- `apps/web/frozen-files.json` (new) — sha256 manifest for the 7 frozen files + room-status value-freeze map.
- `.planning/phases/30-additive-foundation-regression-harness/FROZEN.md` (new) — human-readable frozen-primitive doc.

## Decisions Made

See `key-decisions` in frontmatter — the visual-identity direction, the zero-drift re-run methodology (and why a plain `next dev` re-run wasn't accepted as sufficient proof), and the manifest's two-tier freeze-class structure are all load-bearing for Plan 30-05 (the CI guard that consumes `frozen-files.json`) and for Phases 31-36 (which must read `FROZEN.md` before touching any shared primitive or token).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `next dev` re-run insufficient to prove zero-drift; CSP blocks localhost API in production mode**
- **Found during:** Task 3 verification (re-running the 30-01 baseline diff)
- **Issue:** The plan's verify step says to re-run `playwright.regression.config.ts` "after the new tokens landed." Running it with `PLAYWRIGHT_BASE_URL` pointed at the already-running local `next dev` server (port 3001) worked for data-loading (login + fixture data rendered) but produced small (0.01 pixel-ratio, 654px) diffs on 2 of 3 board surfaces — a plausible Turbopack-dev-vs-production-build rendering artifact rather than a real token regression, and not a fair comparison to the baseline (which was captured against the deployed Railway *production* build). A first attempt to instead build+serve a local production-mode standalone server pointed at the local API (`localhost:8003`) failed entirely ("Failed to load rooms") because `next.config.mjs`'s CSP `connect-src` only allow-lists `http://localhost:*` when `NODE_ENV=development` — the browser blocked the API fetch outright in production mode.
- **Fix:** Created a temporary, gitignored `apps/web/.env.production.local` overriding `NEXT_PUBLIC_API_URL` to the real deployed production API URL (`https://stellar-integrity-production-f507.up.railway.app/v1`, already present in the CSP allow-list), ran `next build`, copied `public`/`.next/static` into `.next/standalone`, started `node .next/standalone/server.js` on a scratch port, and re-ran the regression suite against it. Result: 12/12 passed at `maxDiffPixelRatio: 0`. Removed the temp env file, killed the scratch server, and deleted `test-results/` afterward — no deploy occurred, no committed file changed by this fix.
- **Files modified:** none tracked (temporary local-only `.env.production.local`, created and deleted within this session)
- **Verification:** `git status --short apps/web` after cleanup shows no stray files; the 12/12 pass output is quoted in this SUMMARY and in the Task 3 commit message.
- **Committed in:** documented in `128c9317` (Task 3 commit message); no separate commit needed since no tracked file changed.

---

**Total deviations:** 1 auto-fixed (Rule 3, blocking — methodology correction to make the zero-drift proof actually faithful to the baseline's capture conditions). No scope creep; no tracked file was affected by the fix itself.

## Next Phase Readiness

- `apps/web/frozen-files.json` is ready for Plan 30-05 to build the CI guard script against (both the file-hash section and the room-status value section).
- `FROZEN.md` is the required reading for Phases 31-36 before touching any shared primitive, token, or the boards themselves.
- The new additive tokens (`--motion-*`, `--ease-*`, `--z-*`, `--surface-raised`, `--surface-overlay`, `--shadow-xs`, `--brand*`, `--focus-ring`) are available for Phases 31-36 to opt into; none are consumed by any component yet (this plan only lands the tokens, per FOUND-01's additive-only scope — restyling is out of scope until Phase 31+).
- Dark-mode AA contrast for the new `--brand`/`--brand-ink` pairing and others is NOT yet verified — that is Plan 30-05's / FOUND-04's job (the dark values here were hand-picked per RESEARCH.md guidance, not contrast-proven).

---
*Phase: 30-additive-foundation-regression-harness*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: `apps/web/app/globals.css` contains `--motion-base` (both `:root` and referenced), `--brand` in both `:root` (`#b8431c`) and `.theme-dark` (`#e08a63`)
- FOUND: `apps/web/tailwind.config.ts` contains new `brand`/`surface-raised`/`zIndex`/`transitionDuration` entries
- FOUND: `apps/web/frozen-files.json` on disk, valid JSON, all 7 file hashes independently re-verified via fresh sha256 (script output: "ALL HASHES MATCH"), room-status values independently re-verified against live `globals.css` parse (script output: "ALL ROOM-STATUS VALUES MATCH SOURCE")
- FOUND: `.planning/phases/30-additive-foundation-regression-harness/FROZEN.md` on disk, contains the room-status table and the double-duty-token warning
- FOUND: all 3 commits in `git log --oneline` (`c77664c8`, `0b1a0a6f`, `128c9317`)
- VERIFIED: `cd apps/web && npm run build` succeeded (task 1)
- VERIFIED: 30-01 baseline regression suite re-run, 12/12 passed at `maxDiffPixelRatio: 0`, against a production-mode build pointed at the real production API — the valid zero-drift proof
