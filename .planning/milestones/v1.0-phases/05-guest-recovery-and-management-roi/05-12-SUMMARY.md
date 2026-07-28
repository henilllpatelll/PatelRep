---
phase: 05-guest-recovery-and-management-roi
plan: 12
subsystem: api-web
tags: [fastapi, pydantic, nextjs, react-query, i18n, guest-recovery, satisfaction, sms]

# Dependency graph
requires:
  - phase: 05-guest-recovery-and-management-roi
    provides: "MESSAGE_ROLES + guest_messages/guest_request_events append-only tables and _record_guest_request_event() helper (05-02); GuestRequestDrawer.tsx message thread + reply box + reply state (05-09); guest_requests.ts typed client + guestMessages.*/accessibilityGuidance.* locale keys (05-07)"
provides:
  - "POST /v1/guest-requests/{id}/satisfaction — role-gated (MESSAGE_ROLES), status-gated (resolved/verified), tenant-scoped, single-capture (409 on second write), event-logged as event_type=note (D-16)"
  - "guestRequestsApi.recordSatisfaction typed client method"
  - "GuestRequestDrawer.tsx satisfaction capture panel: 1-5 rating row when unset, read-only 'Recorded N of 5' once set"
  - "GuestRequestDrawer.tsx resolution-confirmation prompt: prefills 05-09's existing reply textarea via setReply() only, no second send path (D-17)"
  - "satisfaction.* and resolutionConfirmation.* EN/ES locale keys"
affects: [guest-recovery-reporting, management-roi]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Satisfaction write path reuses MESSAGE_ROLES verbatim rather than inventing a new role set — satisfaction is collected from the guest by whoever contacted them, the same 'may interact with the guest' set that already gates messaging"
    - "Human-in-the-loop confirmation prompt: derives needsConfirmation from resolved_at vs. latest outbound message timestamp, its only side effect is setReply(template) — it declares no useMutation and calls no send API, so plan 05-09's existing 'Send Reply' button remains the single send path"

key-files:
  created: []
  modified:
    - apps/api/models/requests.py
    - apps/api/routers/guest_requests.py
    - apps/api/tests/test_guest_recovery.py
    - apps/web/lib/api/guest_requests.ts
    - apps/web/i18n/locales/en.ts
    - apps/web/i18n/locales/es.ts
    - apps/web/components/guest-requests/GuestRequestDrawer.tsx

key-decisions:
  - "Role set for satisfaction capture: reused MESSAGE_ROLES (front_desk, housekeeping_supervisor, engineer, gm) verbatim rather than inventing a new role set or widening to all authenticated users — a housekeeper must not be able to score their own work"
  - "Satisfaction capture recorded as guest_request_events.event_type='note' with the score in metadata, not a new 'satisfaction' event_type — migration 072's event_type CHECK constraint lists only ten values and this plan adds no migration"
  - "satisfaction_score deliberately kept out of GUEST_REQUEST_UPDATE_COLUMNS so the generic PATCH /{request_id} cannot become a second, ungated write path"
  - "Live SMS delivery remains UNVERIFIED per D-01 — no Twilio credentials exist locally; the confirmation prompt's 'Send Reply' path was proven only via type-check/lint/build and the existing 05-09 grep-based acceptance criteria, not a live send"

patterns-established:
  - "Server-side 1-5 Field(ge=1, le=5) bounds mirroring an existing DB CHECK constraint, with the UI's button row treated as convenience, not the control"

requirements-completed: [D-16, D-17]

# Metrics
duration: ~45 min active work across 3 tasks (includes one-time apps/web node_modules install)
completed: 2026-07-24
---

# Phase 5 Plan 12: Guest Satisfaction Capture + Resolution Confirmation Summary

**Closed the two named Phase 5 gaps: a role/status/single-capture-gated `POST /guest-requests/{id}/satisfaction` endpoint wired to a new drawer rating panel (D-16), and a human-in-the-loop "Confirm with the guest" prompt that prefills — but never auto-sends — plan 05-09's existing reply box once a request is resolved and the guest hasn't been told (D-17).**

## Performance

- **Duration:** ~45 min active work (3 tasks: 1 TDD, 2 auto) plus a one-time `apps/web` dependency install
- **Started:** 2026-07-24 (worktree base corrected to `c55568c5`, first commit `fc1681c9`)
- **Completed:** 2026-07-24 (last commit `1fcd50d1`)
- **Tasks:** 3 (Task 1 TDD: test then feat; Tasks 2-3 auto)
- **Files modified:** 7 (all modified, no new files)

## Accomplishments

- `RecordGuestSatisfactionRequest` (`satisfaction_score: int = Field(ge=1, le=5)`) mirrors migration 011's `CHECK (satisfaction_score BETWEEN 1 AND 5)` exactly — server-side bounds are the control, not the UI's button row.
- `POST /guest-requests/{id}/satisfaction`: 403 outside `MESSAGE_ROLES`, 404 cross-tenant, 422 unless status is `resolved`/`verified`, 409 on a second capture attempt (value left unchanged), else updates the row and writes exactly one `guest_request_events` row (`event_type='note'`, `detail='Guest satisfaction recorded'`, `metadata={'satisfaction_score': n}`). `GUEST_REQUEST_UPDATE_COLUMNS` was left untouched — the generic PATCH is not a second write path. No migration added.
- `guestRequestsApi.recordSatisfaction(id, { satisfaction_score })` typed client method; `satisfaction.*` and `resolutionConfirmation.*` locale sections added key-for-key to `en.ts`/`es.ts` (verified via a full dotted-key-path parity script: 1365 keys, zero missing/extra either direction; zero new accented characters introduced into `es.ts`).
- `GuestRequestDrawer.tsx`: a `needsConfirmation` prompt renders above 05-09's reply box when the request is resolved/verified, the guest hasn't opted out, has a phone on file, and no outbound message has landed since `resolved_at` — its only handler is `onClick={() => setReply(template)}`; it declares no `useMutation` and calls no send API, so `sendMessage` still appears exactly once in the file (05-09's `replyMutation`). A satisfaction panel renders only when the request is resolved/verified: a role-gated 1-5 button row + Save when unset, a read-only "Recorded N of 5" line (numeral in `font-mono`, `Pill` toned `ready`) once set, and nothing at all for a non-`MESSAGE_ROLES` viewer with no score yet.

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED/GREEN gate):

1. **Task 1: Satisfaction capture endpoint**
   - `fc1681c9` (test) — 7 failing tests (`AttributeError`: `record_guest_satisfaction` did not yet exist)
   - `4db36d6a` (feat) — model + router implementation, all 7 green; full 426-test API suite green
2. **Task 2: Typed client method and EN/ES copy** - `bc304e1f` (feat)
3. **Task 3: Drawer satisfaction capture + resolution-confirmation prompt** - `1fcd50d1` (feat)

## Files Created/Modified

- `apps/api/models/requests.py` — `RecordGuestSatisfactionRequest`
- `apps/api/routers/guest_requests.py` — `SATISFACTION_STATUSES` constant, `record_guest_satisfaction` endpoint
- `apps/api/tests/test_guest_recovery.py` — 7 new tests (role gate, pre-resolved rejection, resolved/verified success, second-capture 409, cross-tenant 404, event-trail assertion)
- `apps/web/lib/api/guest_requests.ts` — `recordSatisfaction` method
- `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts` — `satisfaction.*`, `resolutionConfirmation.*` sections
- `apps/web/components/guest-requests/GuestRequestDrawer.tsx` — resolution-confirmation prompt block + satisfaction capture panel; drawer shell, message thread, accessibility guidance, and Add Note block preserved exactly as 05-09 left them

## Decisions Made

See `key-decisions` in frontmatter. Summary: `MESSAGE_ROLES` reused verbatim for the satisfaction gate (same "may interact with the guest" set already used for messaging — a housekeeper cannot score their own work); capture recorded as `event_type='note'` because no `'satisfaction'` value exists in migration 072's CHECK constraint and this plan adds no migration; `satisfaction_score` kept out of `GUEST_REQUEST_UPDATE_COLUMNS` so the generic PATCH stays a single-purpose edit path; live SMS send remains unverified per D-01 (documented again below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created a local, dummy-valued `apps/api/.env`**
- **Found during:** Task 1, before any test could run
- **Issue:** `apps/api/.env` is gitignored and absent from this fresh worktree checkout; `Settings()` requires `supabase_url`, `supabase_service_role_key`, `supabase_jwt_secret`, `cron_secret` with no defaults, so `pytest` failed at collection before any plan code ran.
- **Fix:** Wrote `apps/api/.env` with dummy, non-live values, same pattern documented in 05-02's summary. Gitignored, never staged or committed.
- **Files modified:** `apps/api/.env` (untracked, not committed)
- **Verification:** `pytest tests/ -q` collects and runs (426 passed) instead of erroring at collection.
- **Committed in:** N/A — gitignored by design.

**2. [Rule 3 - Blocking] Installed `apps/web` dependencies in this fresh worktree checkout**
- **Found during:** Task 2, before `npm run type-check` could run
- **Issue:** This worktree's `apps/web/node_modules` did not exist.
- **Fix:** Ran `npm install --legacy-peer-deps` (plain `npm install` hits the pre-existing `@hookform/resolvers`/`valibot` peer-dependency conflict documented by prior-wave executors). Reverted the resulting `package-lock.json` diff after install (metadata-only churn, zero dependency version changes) so no unrelated lockfile change was committed.
- **Files modified:** none committed (`node_modules` gitignored; `package-lock.json` diff reverted)
- **Verification:** `npm run type-check`, `npm run lint`, and `npm run build` all exit 0 after the install.
- **Committed in:** N/A — install-only, no repo changes.

**3. [Rule 3 - Blocking] Created a local, dummy-valued `apps/web/.env`**
- **Found during:** Task 3, first `npm run build` attempt
- **Issue:** `npm run build`'s static-page prerendering calls `createClient()` at module scope for every dashboard route; this worktree had no `apps/web/.env` (gitignored, absent from a fresh checkout, no live credentials available locally per CLAUDE.md).
- **Fix:** Wrote `apps/web/.env` with dummy, non-live values, same pattern documented in 05-09's summary. Gitignored, never staged or committed.
- **Files modified:** `apps/web/.env` (untracked, not committed)
- **Verification:** `npm run build` completes and prerenders all 43 routes successfully.
- **Committed in:** N/A — gitignored by design.

**4. [Rule 1 - Bug] Reverted auto-regenerated `apps/web/next-env.d.ts` churn**
- **Found during:** Task 3, after `npm run build`
- **Issue:** Running `next build` (Turbopack) after `next dev` rewrote two import paths in the auto-generated `next-env.d.ts` (`.next/dev/types/*` → `.next/types/*`), unrelated to this plan's scope.
- **Fix:** `git checkout -- apps/web/next-env.d.ts` before committing Task 3.
- **Files modified:** none (reverted, not committed)
- **Verification:** `git status --short` showed only the intended `GuestRequestDrawer.tsx` change before commit.
- **Committed in:** N/A — reverted, not part of any commit.

---

**Total deviations:** 4 auto-fixed (4 blocking/bug, all environment or tooling churn)
**Impact on plan:** No scope creep, no plan-code behavior changes. All four are the same category of worktree-environment friction documented across every prior plan in this phase.

## Issues Encountered

**Acceptance-criteria grep count discrepancy (documented, not fixed as a bug):** Task 3's acceptance criteria states `grep -c 'useMutation' GuestRequestDrawer.tsx` should return exactly `3` ("05-09's note mutation, 05-09's reply mutation, this task's satisfaction mutation"). The actual, correct result is `4`, because the file's `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'` line also contains the literal substring `useMutation` and was not excluded from the plan's count — this was true even in the pre-Task-3 state (05-09 left exactly 3 matching lines: the import plus its 2 mutations). The substantive intent — exactly three `useMutation(...)` hook declarations (note, reply, satisfaction) and no fourth, undeclared send path — is met and directly verified by reading the file; `sendMessage` still appears exactly once, and the confirmation block contains no `useMutation` and no `useEffect` calling `setReply` or any mutation, satisfying every other grep in that same acceptance-criteria block. Treated as a plan-authoring arithmetic oversight, not an implementation defect.

## User Setup Required

None new. Twilio credentials (documented since 05-01/05-02) remain the only external dependency for live SMS delivery to actually reach a guest; this plan's confirmation prompt and satisfaction panel render and function correctly regardless of whether the provider is configured.

## Next Phase Readiness

- D-16 (satisfaction capture: role-gated, status-gated, bounded, tenant-scoped, single-capture, event-logged) and D-17 (human-in-the-loop resolution confirmation with no second send path) are both fully implemented and pass every grep-based acceptance criterion except the documented arithmetic discrepancy above, which does not indicate any missing behavior.
- `apps/api/tests/test_guest_recovery.py` (22 tests, 7 new) plus the full API suite (426 tests) are green. `apps/web`: `type-check`, `lint`, and `build` (43 routes) all exit 0.
- **Live verification note (per CLAUDE.md's Self-Verification Policy):** consistent with 05-09's precedent for this same wave, a full browser click-through against live `npm run dev:web` + `npm run dev:api` with a GM session was not performed in this parallel worktree agent — this worktree's dummy `.env` files and the total absence of Twilio credentials mean the plan's own verification note ("no Twilio credentials locally, so `Queued` is the correct and expected outcome") cannot be meaningfully exercised live in this environment either way. All work is proven via: (a) every grep-based acceptance criterion in all three tasks (documented exception above), (b) the full API test suite and web type-check/lint/build all green, and (c) a full manual read-through of the final 385-line component confirming the pre-existing drawer shell, message thread, accessibility guidance panel, and Add Note block are unchanged, and that the two new blocks are wired to the real typed-client methods shipped in this plan and 05-02 — no hardcoded/mock data anywhere.
- No blockers for subsequent phases. Live SMS delivery remains UNVERIFIED per D-01, same as every other plan in this phase.

## Self-Check: PASSED

- `apps/api/models/requests.py` — FOUND (`RecordGuestSatisfactionRequest`)
- `apps/api/routers/guest_requests.py` — FOUND (`SATISFACTION_STATUSES`, `record_guest_satisfaction`)
- `apps/api/tests/test_guest_recovery.py` — FOUND (7 new satisfaction tests)
- `apps/web/lib/api/guest_requests.ts` — FOUND (`recordSatisfaction`)
- `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts` — FOUND (`satisfaction.*`, `resolutionConfirmation.*`, key parity 1365/1365)
- `apps/web/components/guest-requests/GuestRequestDrawer.tsx` — FOUND (385 lines, exceeds min_lines: 320)
- Commit `fc1681c9` (Task 1 test) — FOUND
- Commit `4db36d6a` (Task 1 feat) — FOUND
- Commit `bc304e1f` (Task 2) — FOUND
- Commit `1fcd50d1` (Task 3) — FOUND
- `cd apps/api && python -m pytest tests/test_guest_recovery.py -q && python -m pytest tests/ -q` — 22 passed, 426 passed
- `cd apps/web && npm run type-check && npm run lint && npm run build` — all exit 0, 43 routes prerender

---
*Phase: 05-guest-recovery-and-management-roi*
*Completed: 2026-07-24*
