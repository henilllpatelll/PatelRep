---
phase: 18-documentation-drift-fixes
plan: 01
subsystem: docs
tags: [documentation, claude-md]
dependency-graph:
  requires: []
  provides: [corrected-claude-md-cron-jobs, corrected-claude-md-current-scope, corrected-claude-md-domain-map]
  affects: [future-sessions-reading-claude-md]
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified: [CLAUDE.md]
decisions: []
metrics:
  duration: "~15m"
  completed: 2026-08-04
---

# Phase 18 Plan 01: Documentation Drift Fixes Summary

One-liner: Corrected three drifted CLAUDE.md sections (Cron Jobs mechanism, Current Scope credential note, Domain Map router table) to match the actual codebase, with zero code changes.

## What Changed

Pure Markdown find-and-replace, using the exact verified text from `18-RESEARCH.md`:

1. **Cron Jobs section** (`CLAUDE.md`): Replaced the "GitHub Actions → FastAPI `/v1/internal/*`" heading and 12-row endpoint table with "in-process APScheduler → FastAPI internal coroutines" — describing the `AsyncIOScheduler` in `apps/api/core/scheduler.py`, started in `main.py`'s `lifespan()` handler and gated by `should_run_scheduler()`. The new 13-row table uses Job IDs (e.g. `predictions.run`) instead of HTTP endpoints and adds the previously-undocumented `lost-found.retention-check` job.

2. **Current Scope credential note** (`CLAUDE.md`): Replaced the false "No live API credentials in the local environment" bullet with "Partial local credentials" — `apps/api/.env` exists with Supabase, Stripe test-mode, and cron/app-config keys present (billing + Supabase paths can be exercised locally); only `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` plus Twilio and Opera/OHIP OAuth credentials are genuinely absent.

3. **Domain Map table** (`CLAUDE.md`): Added the 9 previously-missing routers (`clean_sessions`, `cleaning_checklists`, `evidence`, `feedback`, `late_checkout`, `management_roi`, `programs`, `safety`, `shifts`) plus an `internal.py` row cross-referenced to the Cron Jobs section. The table now lists all 30 router files in `apps/api/routers/`, following the existing grouping convention (`hotels.py, onboarding.py` and `work_orders.py, assets.py` share rows; every other router gets its own row).

## Deviations from Plan

None - plan executed exactly as written. All replacement text was copied verbatim from `18-RESEARCH.md` Code Examples 1-3.

## Verification

- `grep -n "in-process APScheduler" CLAUDE.md` → found at line 149 (new heading present)
- `grep -c "lost-found.retention-check" CLAUDE.md` → 1
- `grep "GitHub Actions → FastAPI" CLAUDE.md` → no matches (old heading gone)
- `grep -n "Partial local credentials" CLAUDE.md` → found (new bullet present)
- `grep "No live API credentials" CLAUDE.md` → no matches (old bullet gone)
- `grep -c "STRIPE_SECRET_KEY" CLAUDE.md` → 2 (new mention added)
- All 9 previously-missing routers (`clean_sessions.py` ... `shifts.py`) → each returns count 1 in the Domain Map table
- `git diff` confined to `CLAUDE.md` across the three target sections (76 lines changed: 50 insertions, 26 deletions cumulative across 3 commits)
- No code files changed — `git status` shows only pre-existing unrelated `.wolf/*` modifications (predate this session)

## Commits

- `79d36d67` — docs(18-01): replace Cron Jobs section with in-process APScheduler description
- `7d8ba1e8` — docs(18-01): correct Current Scope local-credential note
- `f9e05b36` — docs(18-01): add 9 missing routers to Domain Map table

## Self-Check: PASSED

- FOUND: CLAUDE.md (modified, exists)
- FOUND: 79d36d67 in git log
- FOUND: 7d8ba1e8 in git log
- FOUND: f9e05b36 in git log
