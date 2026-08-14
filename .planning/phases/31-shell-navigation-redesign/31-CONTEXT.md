# Phase 31: Shell & Navigation Redesign - Context

**Gathered:** 2026-08-14 (self-directed — user delegated all remaining v2.0 decisions after Phase 30 closed: "continue")
**Status:** Ready for planning

<domain>
## Phase Boundary

Redesign the app shell — Sidebar, Header, Breadcrumbs, CommandPalette, MobileFloorNav — on the Phase 30 token/variant foundation. Add a collapsible icon-rail sidebar, extend the command palette to record search, and re-verify RBAC nav visibility is unchanged across all 6 roles. The shell wraps the excluded Room Board surfaces, so the Phase 30 regression gate must re-pass.

</domain>

<decisions>
## Implementation Decisions

### Direct codebase findings (not assumptions — read before writing this context)
- **NAV-01 (RBAC source of truth):** `lib/utils/navigation.ts` (`getAllowedHrefs`/`getAllowedNavItems`) is already the single source of truth, consumed identically by `Sidebar.tsx`, `CommandPalette.tsx`, and `Breadcrumbs.tsx`. Redesign must keep reading through this — never hardcode a route list in a redesigned component.
- **NAV-02 (collapsible sidebar) is genuinely net-new.** `Sidebar.tsx` is a fixed 232px `<aside>`; the only trace of "collapse" is a stale comment above the logo block ("Logo + collapse button") — no toggle, no collapsed-state rendering, no persisted preference exists today.
- **NAV-03 (notification inbox) is ~80% already built.** `Header.tsx` already has a bell icon with unread badge, a dropdown panel, mark-one-read, and mark-all-read, backed by real endpoints (`GET /notifications`, `PATCH /{id}/read`, `POST /mark-all-read`, all `tenant_id`+`user_id` scoped, already exist in `apps/api/routers/notifications.py` — no backend work needed for the base mechanism). **Real gaps to close, not a rebuild:** (1) it only ever fetches `is_read: false` — there's no way to review already-read history ("what happened while I was on the floor" implies reviewing past items too, not just currently-unread ones), (2) several strings are hardcoded English literals ("Notifications", "Mark all read", "No new notifications") that violate this repo's `i18next/no-literal-string` CI gate — these must become i18n keys as part of the redesign, not left as pre-existing debt, (3) it needs the Phase 30 v2 token/variant system applied.
- **NAV-04 (command-palette record search) is genuinely net-new.** `CommandPalette.tsx` today only filters `getAllowedNavItems()` by label substring match — pure nav-jump, zero record search (rooms/work orders/guests/SOPs). This is the largest scope item in the phase.

### Visual identity — continuation, not a new decision
Phase 30 already decided the direction ("evolve, not repalette": keep warm-paper/terracotta base, additive v2 brand ramp `--brand`/`--brand-soft`/`--brand-line`, focus ring, motion/elevation/z-index scales, `Button` gets an additive `v2` variant). Phase 31 consumes that system — it does not re-decide visual identity. Apply the v2 tokens/variants to Sidebar/Header/Breadcrumbs/CommandPalette; do not introduce a second visual direction.

### NAV-02: Collapsible sidebar — Claude's discretion, decided as follows
- Collapse to an icon-only rail (icons + tooltips on hover, using the Radix `tooltip` primitive Phase 30's STACK.md research cleared as safe to add), not an overlay/drawer.
- Persisted per-user in `uiPreferencesStore` (the existing prefs store already used for theme/density/accent) as a new `sidebarCollapsed: boolean` field — mirrors how density/theme/accent already persist.
- Desktop-only affordance; `MobileFloorNav`'s bottom-tab bar is untouched by this decision (research's anti-feature list explicitly rejects replacing the floor bottom-tab with anything else).
- Hotel switcher and nav-item labels hide in collapsed state; icons + active-state highlighting remain. Collapse toggle button itself replaces the stale comment's intent.

### NAV-03: Notification inbox — Claude's discretion, decided as follows
- Keep the existing bell-icon-in-header + dropdown-panel pattern (it already matches the "reachable from the shell header" requirement) — redesign its visuals onto Phase 30 tokens, don't replace the interaction pattern.
- Close the "review what happened while away" gap by adding a simple unread/all toggle (two small tabs or a switch atop the panel) that re-queries with `is_read` unset (already an optional param server-side — `is_read: bool = Query(False)` defaults to unread-only, so passing no filter or an explicit "show all" toggle is a client-only change, no backend change needed).
- Fix the hardcoded-English strings as part of this work (add i18n keys, both locales) — this is in-scope cleanup, not scope creep, since NAV-01/NAV-03 both require the shell to be fully redesigned and the existing raw literals are a pre-existing gate violation this phase is touching anyway.

### NAV-04: Command palette record search — Claude's discretion, with an open question flagged for research
- Must stay within the milestone's "zero `apps/api` change implied" scope (per PROJECT.md/REQUIREMENTS.md Out of Scope) wherever realistically possible. A quick grep found no existing `search`/`q` query params on `rooms.py`/`work_orders.py`/`guest_requests.py`/`sop.py`'s list endpoints — **research must determine exactly what filtering these existing endpoints DO support** (e.g., can rooms be filtered by room_number substring server-side already? Do work orders support a title/description filter? Does SOP already have an RPC-backed search, e.g. `match_sop_chunks`?) before deciding whether record search is achievable as pure client-side filtering over an existing list call, or whether it genuinely requires a new/extended query param on an existing endpoint (a minimal, additive API change — NOT a new endpoint — would still honor the spirit of "no new capability," similar to how Phase 26 in v1.6 made one minimal backend fix when research proved the roadmap's "pure frontend" framing wrong).
- If a small additive backend change turns out to be genuinely necessary (e.g., one new optional query param), that is an acceptable, documented deviation from the "zero apps/api change" framing — same precedent as v1.6 Phase 26's `asset_risks` id-selection fix. Do NOT build a new search microservice, new indexes, or a general-purpose search endpoint — keep it minimal and scoped to what the palette needs.
- Every result must still be filtered through the current role's access (a room search shouldn't return anything a Command Palette nav-jump wouldn't already implicitly allow the user to reach) — reuse existing tenant-scoping conventions on whichever endpoints get called.
- Result rendering: grouped by entity type (Rooms / Work Orders / Guests / SOPs), each result navigates to that record's existing detail view/route.

### NAV-05 / NAV-06: RBAC re-verification and nav simplicity
- Build a role×nav matrix (6 roles × every `getAllowedNavItems()` entry) as a concrete artifact (e.g. a markdown table in the plan's verification output), captured against the CURRENT app before any redesign work lands, then re-run identically post-redesign for all 6 roles — automatable via a script reading `navigation.ts`'s own logic directly (it's pure/deterministic given role+customRoleModules+frontDeskModules inputs), not requiring 6 manual logins for the matrix-comparison part. Live browser verification (logging in as each role) is still required for the human-verification pass per this project's mandatory Self-Verification Policy, but the matrix diff itself can and should be automated.
- NAV-06 ("simple, consistent, self-evidently discoverable") is a qualitative judgment, not a new mechanism — treat it as: no nav restructuring beyond what NAV-01/02 already specify (features flagged as anti-features — mega-menu, hamburger-replacing-bottom-tab — remain out), consistent icon/label/active-state treatment across desktop sidebar, collapsed rail, and mobile bottom-tab, and the command palette (NAV-04) doubling as a fast-path for "I know what I want, let me just search for it" users. No separate deliverable beyond what the other 5 requirements already produce.

### Feature flag
Gate this phase's work behind `RedesignGate` (Phase 30's mechanism) with section key `"shell"`, per the seeded naming convention from 30-02's SUMMARY. Since the shell wraps every page, this is the first real test of the per-section flag actually working end-to-end for a tenant.

### Room-Board regression gate
Must re-pass after this phase (`npm run test:e2e:regression` from `apps/web`) since the shell wraps `RoomStatusBoard`/`RoomDetailDrawer`/`EngineeringRoomBoard`. This is success criterion 6 from ROADMAP.md and should be the last verification step before this phase closes, mirroring Phase 30's own re-proof pattern after 30-04's token work.

### Addendum (2026-08-14, post-research): resolving research's 2 open scoping questions

Research flagged two decisions for the orchestrator before planning. Resolved:

**(a) Palette navigation target — resolved per entity, verified against source, not assumed:**
- **Rooms:** `RoomStatusBoard.tsx` (frozen, but read-only reuse is fine) ALREADY reads `?room={id}` via `useSearchParams()` (confirmed at `RoomStatusBoard.tsx:212,336` — this is the exact mechanism v1.6 Phase 26 built for the AI Risk Alerts panel's deep link) and opens the detail drawer for that room. The command palette can link straight to `/housekeeping?room={room_id}` for a room result with ZERO new code in any frozen file — pure reuse of existing, already-shipped behavior.
- **Work Orders / Guest Requests / SOPs:** no existing `[id]` detail route or query-param convention. Adopt the same `?focus=<id>`-style scroll-into-view-and-highlight pattern v1.6 Phase 26 already established for `PredictionsPageContent` (`?asset=`) — a proven, in-codebase precedent, not a new pattern. Each list page (none frozen) gains this handling for its own entity type.

**(b) WO/Guest `ilike` query-param additions — land in Phase 31, not deferred:**
NAV-04 explicitly requires all 4 entity types (rooms, work orders, guests, SOPs) to be searchable. No later phase in the roadmap (32: dashboard homes, 33/34: section redesigns, 35/36: board-adjacent chrome, 37: QA) would naturally pick up "finish command palette search" if deferred here — deferring would leave NAV-04 permanently half-met. The two minimal additive query params (`q` → `.ilike("title", ...)` on `work_orders.py`'s and `guest_requests.py`'s existing list endpoints) are small, precedented (v1.6 Phase 26's one-line `asset_risks` select fix for the same "roadmap framing undersold what's needed" reason), and scoped exactly to what the palette needs — not a general search endpoint. Include them in this phase's plans.

### Claude's Discretion (everything not explicitly locked above)
The user has delegated all remaining decisions for this milestone ("continue" after Phase 30 closed, following the earlier "you decide everything from now on... do not come back to me until the phase is completed and closed" instruction). Exact component structure, exact new i18n keys, exact tooltip/collapse animation timing (use Phase 30's `--motion-*`/`--ease-*` tokens), and any remaining implementation-level judgment calls should be made using this project's established conventions and documented with rationale in the phase's own artifacts, same as Phase 30.

</decisions>

<specifics>
## Specific Ideas

None given directly — this phase continues Phase 30's "warm operational calm, systematized" visual direction and the milestone research's shell/nav recommendations (FEATURES.md, ARCHITECTURE.md, SUMMARY.md Phase 2 section) rather than introducing new aesthetic direction.

</specifics>

<deferred>
## Deferred Ideas

- Global app-wide date/property filter, multi-level mega-menu, badges/toasts on passive events, hamburger replacing the floor bottom-tab, onboarding tours — all explicitly rejected anti-features per milestone research (`.planning/REQUIREMENTS.md` Out of Scope), not revisited here.
- Role dashboard homes (HOME-01/02) — Phase 32, not this phase.
- Per-section redesigns beyond the shell chrome itself — Phases 33-36.

</deferred>

---

*Phase: 31-shell-navigation-redesign*
*Context gathered: 2026-08-14*
