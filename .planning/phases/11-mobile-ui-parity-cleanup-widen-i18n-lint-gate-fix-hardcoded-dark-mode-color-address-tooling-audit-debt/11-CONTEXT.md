# Phase 11: Mobile UI Parity Cleanup - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the non-blocking tech debt surfaced by `.planning/v1.1-MILESTONE-AUDIT.md` after Phases 7-10 were individually verified `passed`. This is a hardening/bugfix pass, not new capability:

1. Widen `apps/mobile/eslint.config.mjs`'s `i18next/no-literal-string` gate to cover the ~14 Phase-9-migrated directories it currently misses (profile, home, assignments, scheduling, staff, assets, pm-schedules, guest-requests, lost-found, logbook, sop, copilot, alerts, notifications, supervisor/home components).
2. Replace the hardcoded `#CBB8F0` AI-sparkles color in `apps/mobile/app/(app)/home/index.tsx:212` with a semantic `theme.ai.*` token.
3. Fix `FoundItemModal.tsx`'s empty catch block (lines 121-124) to surface user feedback instead of silently swallowing submission errors.
4. Add the missing `workOrders.searchPlaceholder` i18n key to EN/ES locale files (`apps/mobile/app/(app)/work-orders/index.tsx:275` references a key that doesn't exist).
5. Review the 58 `npm audit --audit-level=high` advisories in `apps/mobile` (42 high, 1 critical) and remediate what's safe.

The user declined a discussion pass on these — the 5 items are concrete enough from the audit report to plan directly. All implementation-choice gray areas below are Claude's discretion, informed by existing project constraints.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

- **i18n gate rollout strategy:** Prefer widening the gate to all remaining directories in one pass, fixing any newly-caught raw literals with EN/ES keys as part of the same plan (mirrors Phase 9's own 09-00 approach for its 4 originally-exempted files) — rather than staging directory-by-directory, since Phase 9 already migrated these screens onto primitives and any literals left are incidental, not systemic.
- **npm audit remediation depth:** CLAUDE.md documents the mobile EAS build pipeline as fragile (`dynamic-import-node` babel plugin, New Architecture, `--legacy-peer-deps` for React 19) with "zero new npm dependencies planned by design; any exception requires a green EAS build before merging." Apply this same discipline here: prefer patch/minor-level fixes within `npm audit fix` (no `--force`), skip any major version bump that would touch Expo/RN/Jest/ESLint core packages unless a specific advisory is a genuine, exploitable risk in this app's actual usage (most transitive advisories in dev/build tooling, e.g. ESLint/Jest internals, are not runtime-exposed). Document any advisory deliberately left open with reasoning, matching the audit's own recommendation. Any dependency change must still pass a green EAS build before merging, per the existing project rule — do not skip this gate.
- **FoundItemModal error behavior:** Show a Toast error consistent with how sibling submission flows in the same modal family (ReportIssueModal, SupplyRequestModal — both already migrated in Phase 8/9) handle failure, so behavior is consistent across the 4 room-detail modals rather than inventing a new pattern for just this one.

</decisions>

<specifics>
## Specific Ideas

No specific implementation references given — standard fix-in-place approach for all 5 items, consistent with how the equivalent pattern was already handled elsewhere in Phases 7-10.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (user chose to skip discussion entirely; no scope creep suggested).

</deferred>

---

*Phase: 11-mobile-ui-parity-cleanup-widen-i18n-lint-gate-fix-hardcoded-dark-mode-color-address-tooling-audit-debt*
*Context gathered: 2026-08-01*
