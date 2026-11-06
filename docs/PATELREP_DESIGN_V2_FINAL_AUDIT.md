# PatelRep Design System V2 — Final audit (Phase 8 of 8)

Branch `feat/patelrep-design-system-v2`, PR #200 (draft, base `main`). This is an evidence report, not a certification: every
row says what was actually checked and how. "Not verified" means exactly that. Nothing here was run on a physical device or
with a screen reader.

**Evidence tiers used below**

| Tier | Meaning |
|---|---|
| **T1** | Automated test or CI gate (Jest, `tsx --test`, contrast gate, GitHub checks) |
| **T2** | Real browser (Playwright/Chromium, production build, V2 flag on) against the hermetic mock backend. No credentials, no production data |
| **T3** | Code inspection only (grep / reading), no execution of the screen |
| **None** | Not verified |

The hermetic mock backend serves one tenant and answers most endpoints with `[]`, so T2 proves layout, overflow, overlay behavior and
styling, not data-rich states or real workflows.

---

## 0. Summary

| Question | Answer |
|---|---|
| Is the V2 redesign visible to production users? | **No, and it cannot be** until a rollout change is approved (section I). Both preview flags are hard-disabled when the environment is `production`. |
| Does the PR touch the database, API, workflows, secrets or billing? | **No.** Diff vs `main` is `apps/mobile`, `apps/web`, `docs` and two `.wolf/` bookkeeping files (section G.1). |
| Is the legacy look unchanged with the flag off? | Yes for color, type, layout. **Five shared-behavior fixes are not flag-gated** and do reach production (section F.3); they are accessibility fixes, disclosed here on purpose. |
| Biggest unproven area | Every V2 **mobile** screen: no device or emulator run, no assistive technology, no real-data run. |
| Biggest missing piece | A production activation mechanism (section I). |

**Decision 1 (merge): NOT READY — BLOCKERS REMAIN.** **Decision 2 (production activation): NOT READY — ADDITIONAL VALIDATION REQUIRED.**
Reasons and the shortest path to flip each are in section K.

---

## A. Mobile coverage

Categories come from each phase's own doc, **not** from my re-inspection of rendered UI: **New or rebuilt** = the phase doc calls the screen
new/rebuilt/rewritten. **Scoped** = palette, typography, status wording and sentence-case labels through `DesignV2Scope` with the
layout kept. Evidence is T1 (Jest renders the screens with the scope on) plus T3 for the code facts below. **No row has T2/device evidence.**

| Role | New or rebuilt (per phase doc) | Scoped only (per phase doc) |
|---|---|---|
| Housekeeper | Home (header, hero, progress), My Rooms | Room Detail and all its sheets (one shared `BottomSheet`), Tasks, Notifications, SOP, Lost & Found, knock screen. Assistant sheet keeps its pinned dark palette (earlier decision D-11) |
| Inspector | Home (new) | Inspections queue, active workspace and sheets, history, record. Phase 4 doc §37: "fixes no layout of screens that already worked" |
| Housekeeping Supervisor | Today and its quick-actions surface | Room Board, Assignments (+ bulk, Smart Balance, midshift), Attention Center, **Team Scheduling, Communications, Shift handoff** (Phase 4 doc §37: "layouts unchanged") |
| Engineer | none | Home, work queue, WO detail, PM, assets, More, Report Issue, sync. Phase 5 doc §44: "Layouts were **not restructured**" (the layouts predate V2: Engineering PRs #190/#198/#199) |
| Chief Engineer | none | Home, priorities, workload, PM management, rooms down, assign technician (see A.2) |
| Front Desk | Home, Guest Requests list, request detail, More (new) | Room Status (layout kept), Logbook (list/new entry), Lost & Found (form is still an RN `Modal`, not the shared sheet), Notifications, Settings |
| GM | Home, Alerts, Staff | Profile, Settings. No staff-coverage figure or report links exist in the app |

### A.1 What the code shows about "color-only" migration (T3, measured)

- 466 of 517 `app/` + `components/` files read colors through `useTheme()`. **Zero** files use the frozen static `C.*` color tokens, so
  there is no color bypass.
- **Typography bypass (fixed in Phase 8).** 56 files hardwired IBM Plex Mono / Instrument Serif in static `StyleSheet`s via `monoFont`
  / `serifFont` / `displayFont`. Those are retired by the V2 contract (docs §11). Because the flag is a bundle-time constant, they now
  resolve to the system sans when it is on (`components/shared/tokens.ts`). Flag off: byte-identical. Tabular digits are **not**
  applied at those 56 sites (React Native sets `fontVariant` per call site), so figures that previously aligned in mono may not.
- **Uppercase micro-labels (not fixed).** 130 `textTransform: "uppercase"` uses in 110 files; 93 of those files already override it under
  V2. **17 files do not**, so they still shout in V2: `scheduling/index.tsx`, `StaffTasksScreen.tsx`, `shared/mobileHandoff.tsx`,
  `shared/CopilotCard.tsx`, `engineering/home/homeStyles.ts`, `settings/EditFieldSheet.tsx`, `settings/SyncChangesSheet.tsx`,
  `voice/VoiceCapturePanel.tsx`, `assets/label/[assetId].tsx`, `profile/whats-new.tsx` and seven `components/ai/*` surfaces. Fixing them
  means editing each text node and was not done without a device to look at it.
- Hardcoded hex is tiny and legitimate (QR code, photo viewer, print label, scan overlay); the large counts are the two token files.

### A.2 Engineering Home / Chief Engineer Home hierarchy (assessed, not restructured)

Chief Engineer Home renders: header, summary cards, **Property priorities** (with inline Assign and View all), Team workload, Oversight
(rooms down, PM plan), Quick actions (`ChiefEngineerHome.tsx:182-216`). Priorities sit first, each section has one primary action, and
the section count is five. That is a coherent hierarchy and it came from the dedicated Engineering Home V2 work (#198). The brief says
not to force layout changes on screens that already meet the contract, so it was **left as is**. This is a code-reading judgment (T3),
not a visual review on a device. If you disagree after seeing it on a phone, it is the first candidate for a follow-up.

### A.3 Mobile modal and sheet inventory (T3)

25 files render an RN `<Modal>`; 180 files reference the shared `BottomSheet`. Raw-`Modal` sheets: Lost & Found form, PM photo field,
Engineering room/work filter sheets, Knock modal, Scheduling coverage/filter/shift sheets, App-lock gate, nine Supervisor
assignment/board/inspect sheets, the HousekeeperPicker, the room detail sheet, and the two `BottomSheet` implementations.
Keyboard avoidance, safe-area handling and iOS modal hand-off were **not** exercised (no device); they are on the device checklist (K.3).

---

## B. Web coverage

T2 = opened in a production V2 build, light mode, at 1440 and 390 px, in a real browser, against the hermetic mock. All 14 routes below
loaded in V2 mode with **zero horizontal overflow and zero page errors**.

| Group | Route(s) | Status | Evidence |
|---|---|---|---|
| Dashboard | `/dashboard` | **Restructured** (Phase 7) | T2 + T1 (model tests) |
| Housekeeping | `/housekeeping` | Remap | T2 |
| Engineering | `/engineering/work-orders`, `/pm-schedules`, `/assets` | Remap | T2 |
| Guest ops | `/logbook`, `/lost-found` | Remap | T2 |
| Guest ops | `/guest-requests` | redirects into `/tasks` (Guest Request filter) | T2 with fixture data: renders, V2 chrome, no overflow, no errors |
| People and time | `/staff`, `/scheduling` | Remap | T2 |
| People and time | `/tasks` | Remap | T2 with fixture data (Phase 7 could not render it) |
| Settings | `/settings/general` | Remap | T2 (13 other settings screens: **None**) |
| Knowledge/compliance | `/sop`, `/safety`, `/evidence`, `/programs` | Remap | T2 |
| Reports | `/reports` | Remap | **None with data.** Renders only its error boundary under every fixture I could build; its `views/overview` payload is large (section K, B3) |
| Billing, onboarding, preferences, ROI, AI | `/billing`, `/onboarding`, `/preferences`, `/management-roi`, `/ai` | Remap | **None** (not opened) |
| Auth recovery | `/auth/reset-password`, `/auth/callback` | Not restyled (Phase 2 doc §23) | None |

"Remap" means themed through `contentRemapV2.css`, not redesigned: tables, filter bars, form layouts and drawer widths are the legacy ones.
That is a deliberate Phase 7 scope, repeated here so nobody reads "V2 active" as "redesigned".

### B.1 Web typography and color drift found and fixed in Phase 8 (T2 verified)

| Finding (seen in the browser) | Fix (all scoped to `body[data-dv2-content][data-dv2-mode]`, flag off untouched) |
|---|---|
| Shouting uppercase micro-labels ("WHERE", "WHAT'S WRONG", "ACTIVE") on essentially every page; 283 `uppercase` uses | `.uppercase[class*="tracking-"]` → sentence case, 12 px. Measured after: **0** all-caps strings on dashboard, housekeeping, logbook and work orders; the only survivor was "HVAC" (an abbreviation) |
| Route error boundary's Retry button hardcoded amber | `data-error-retry` hook → V2 primary. Measured `rgb(37,99,235)` = `#2563EB`, light and dark |
| `font-display italic` headings (the retired serif-italic accent) rendered as sans italic ("Create a work order") | `.font-display.italic` → upright |
| ~9 stray raw utilities not covered by the Phase 7 remap (`placeholder-*`, `bg-stone-100`, `hover:bg-gray-200`, `hover:border-gray-400`, `hover:text-gray-500`) | Added |

Not fixed (visible in the same screenshot): selected states are inconsistent inside one form: the Room/Property-area toggle selects
**black**, the category chips select blue, "Normal" selects with a dark outline. Fixing that is per-component redesign.

---

## C. Drawers, sheets and modals

### C.1 Web (T2, real browser)

Probe: for each of 14 routes at 1440 and 390 px, click up to 6 plausible overlay openers, then record role, name, bounds, focus placement,
Escape and focus return. The first pass ran 56 times, but that was 28 route×viewport combinations **twice**: the "dark" half was not dark
(see D), so these numbers are light-mode only and each combination counts twice. Totals across both passes: 284 openers tried, 132 overlays
opened (128 dialogs, 4 menus), 0 horizontal overflow, 0 page errors.

| Check | Result (light mode) |
|---|---|
| Dialog has an accessible name | Pass (every dialog opened) |
| Closes on Escape | Pass (every overlay opened) |
| No horizontal overflow while open | Pass |
| Footer/actions clipped | Not clipped on the one I inspected visually (New Work Order, 1440 px). The probe flagged 8 overlays whose box ended 12-20 px past the viewport; that was a slide-in transition caught mid-flight, not clipping |
| Focus moves into the dialog | Pass, except `/sop` "New SOP" (dialog never took focus) |
| **Focus returns to the opener on close** | **Failed**: the command palette (every page), New Work Order, Create Shift, New SOP dropped focus on `<body>` |

Root causes and fixes (all verified in a rebuilt production build; opener focused before, opener focused after Escape):

1. **Command palette:** a Radix `Dialog` with no `Dialog.Trigger` (it opens from Ctrl+K and a custom event), so Radix had nothing to return to.
   Fixed with `onCloseAutoFocus`.
2. **Shared `useModalFocusTrap`:** captured the opener inside an effect, after child effects/autofocus may already have moved focus. Replaced
   by a single passive `focusin` tracker that remembers the last element focused outside any dialog (a render-phase ref write was tried first
   and rejected by the repo's `react-hooks/refs` lint rule).
3. **Dialogs with no focus management at all**, declaring `aria-modal="true"`: the three SOP dialogs, Create Work Order drawer, Bulk Archive,
   Asset Detail modal, SOP query modal, and the dashboard room-list drawer (which also lacked `role="dialog"` entirely). All now use the hook.

Dark-mode overlay pass: see C.3.

**Still without focus management (known gaps, not fixed in this PR):** `AssetDetailPanel`, `RoomStatusBoard` (its confirm dialog),
`AICopilotBubble` (floating chat declared `aria-modal`), `FeedbackButton`, the `housekeeping/out-of-order` page dialog, and the clean-type
prompt in `AssignmentWorkspace`. `TaskNextAction` manages its own focus. These were found by grep, not opened in a browser.

### C.2 Not tested on any overlay
Unsaved-changes protection, destructive-confirmation wording, disabled-button explanations, submit/retry flows, and drawer behavior with
real data. The mock answers every write with `{}`.

### C.3 Dark mode
Run after the fixes above, with dark mode set the way the app actually reads it (`patelrep-ui-prefs.theme = "dark"`; each run asserted
`data-dv2-mode="dark"`): **28 route×viewport runs, 142 openers, 66 overlays opened (64 dialogs, 2 menus). 0 horizontal overflow, 0 page
errors, every dialog named, every dialog took focus, every overlay closed on Escape, and every dialog returned focus to its opener.**
Spot checks in dark: the dashboard room-list drawer (modal, labelled, Tab stays inside, Escape closes, focus returns to the tile), and the
error boundary Retry (`#60A5FA` fill with `#0B1220` text, the V2 dark primary). A captured screenshot of the dark command palette shows
legible navy surfaces. Dark screenshots were kept only for the dashboard overlays; other dark overlays are covered by the measurements above,
not by a visual review. **Contrast of every legacy-styled surface in dark was not swept**; only the token pairs (T1) and the screens
looked at are covered.

---

## D. Visual quality

- **Light mode, responsive:** T2, 14 routes at 1440 and 390 px, zero horizontal overflow. 1280, 1024 and 768 px were verified by Phase 7 for
  the dashboard only; **not re-verified here and not checked for other routes**.
- **Dark mode:** see C.3. Phase 7's "dark" screenshots must be treated with care: in this audit I found that the OS color scheme does **not**
  drive V2 dark mode; the app's own preference does (`patelrep-ui-prefs` in localStorage). My first "dark" probe pass was silently light, so no
  dark claim in this report comes from it.
- **Mobile light/dark, Dynamic Type, Spanish expansion, safe areas, keyboard-open forms, 320/375/390 dp:** **None.** Unit tests only.
- **Cross-platform consistency:** web and mobile share the V2 token set and a parity test (T1). In the light-mode pages Phase 8 inspected, there was no web color drift beyond
  B.1. Mobile uppercase residue is A.1. The web selected-state inconsistency is in B.1.

---

## E. Accessibility

| Item | Evidence |
|---|---|
| Contrast of the new tokens, both modes | T1: web `check:contrast` (10 enforced pairings) and the mobile contrast suite pass |
| Touch targets without a role **or** label (mobile) | T3 static sweep: **14 of 651**. Ten are intentional scrims already marked `accessible={false}`; the real gaps are two controls in the **legacy** Guest Requests list (an icon-only add button and the filter chips) which V2 replaces. Not patched, legacy |
| Web dialog semantics, focus, Escape | T2 (section C) |
| Status never by color alone | The Phase 7 doc says the V2 dashboard pairs every status color with icon and text (not independently verified in Phase 8). Legacy surfaces keep their own status presentation: **not audited here** |
| Screen reader (VoiceOver/TalkBack/NVDA), keyboard-only walkthroughs, Dynamic Type, reduced motion | **None. Not performed.** Precise checklist in K.3 |

---

## F. Functional reliability

1. **Mobile:** `tsc` clean, ESLint clean, full Jest: see the CI table in section L for the final numbers. Phase 7 saw one timeout in
   `PmInspection` under load; it passed in the Phase 8 full runs.
2. **Web:** `tsc` clean, ESLint 0 errors (5 pre-existing warnings), `test:unit` all passing, frozen-file check OK, i18n parity (3,722 keys) OK,
   contrast gate OK.
3. **Behavior changes that are NOT behind the flag** (they reach production the moment this merges; each is an accessibility fix):
   - `useModalFocusTrap` opener tracking (affects every drawer/modal that uses it)
   - `CommandPalette` focus return
   - SOP page dialogs, `CreateWorkOrderDrawer`, `BulkArchiveModal`, `AssetDetailModal`, `SOPQueryModal` now trap Tab and return focus
   - dashboard room-list drawer is now a labelled modal dialog
   - `eas.json` production profile gains `EXPO_PUBLIC_APP_ENV=production` (arms the guard; changes nothing else)
   These were verified in a browser on the pages listed in section C, not across every consumer of the hook.
4. **End-to-end workflows (§19): not performed.** The mock cannot complete a write, and no device or staging session was driven. Flows
   listed in the brief (housekeeper cleaning, inspector inspection, supervisor assignment, work-order completion, guest request, logbook,
   lost & found, report filtering, admin setting edit) are **unverified in V2**. Existing automated tests cover their logic with the
   scope on or off; they are not a substitute.

---

## G. Security and operational safety

### G.1 Diff safety (§17), verified
`git diff origin/main...HEAD --name-only` outside `apps/mobile`, `apps/web`, `docs`: only `.wolf/cerebrum.md` and `.wolf/memory.md`
(assistant bookkeeping, no product effect). No `supabase/`, no `apps/api/`, no `.github/`, no Dockerfile, no Railway/Vercel config, no secret.
Mobile/web `.env.example` and web `package.json` (`test:unit` file list) changed. No staging or production reset was run.

### G.2 Permissions, tenancy, offline
Role navigation, RBAC, `hotel_id` scoping and the offline engine are **unchanged by V2** (no logic edits; T3 diff review). They were not
re-tested on a device. The six sync states (saved locally, waiting, syncing, synced, failed, conflict) are **not** one shared component:
each flow has its own copy. The copy I sampled is honest about local-only state ("The room isn't Clean until the server confirms"), but
V2 does not unify the vocabulary.

### G.3 AI and paid features (§13), verified by code reading
- V2 added no AI call, no capability flag change and no credit-accounting change. The web V2 dashboard sections never fetch and never call
  AI (T1 test). Mobile `AssistantSheet` changed only geometry/palette.
- **Pre-existing finding, not caused by V2:** for **Engineer, Front Desk and GM**, `useCopilotBrief` (called from the app layout) POSTs to
  `/ai/engineer|front-desk|gm/briefing` automatically on mount, and the engineer endpoint calls Anthropic and reports credits. The
  housekeeper and supervisor roles were already moved to tap-to-load. This is a real "automatic paid AI call on screen mount" and is outside
  a design-only PR. Remediation: make those three briefings tap-to-load (or cached) like the other two roles.

---

## H. Performance

**Not measured.** No pre-V2 baseline was captured and no benchmark was run, so no performance claim is made. The existing perf tests under
`apps/mobile/__tests__/perf` run inside the Jest suite and passed. The V2 scope reads a context value and the font tokens are bundle-time
constants, so a large regression is not expected, but that is an expectation, not a measurement.

---

## I. Production activation

### I.1 How it works today
| | Web | Mobile |
|---|---|---|
| Switch | `NEXT_PUBLIC_DESIGN_V2_PREVIEW=true` | `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true` |
| When read | **Build time** (inlined by Next; Dockerfile `ARG` list does not include it) | **Bundle time** (inlined by Metro) |
| Production guard | `NEXT_PUBLIC_APP_ENV=production`, set by `production-release.yml` at deploy | `EXPO_PUBLIC_APP_ENV=production` |
| Guard armed? | **Yes** | **It was not.** No EAS profile set it, so a stray flag in a production build would have enabled V2. **Fixed in this PR** (`eas.json` + test) |
| Effect when on | whole app, every user, every tenant | whole app, every user, every tenant |

**Consequence:** with the guards intact, V2 can never reach production users. After merge, production still shows only the old design. That
is the "CI is green but nobody sees it" trap the brief warns about; it is real and unresolved.

### I.2 Gaps to close before any rollout
1. **No runtime control.** The flag is global and compile-time; there is no per-tenant or per-role switch and no way to turn it off without a rebuild.
2. **OTA bypass of the new guard.** EAS Update is configured (`updates.url`, `runtimeVersion` `1.0.0`, no workflow publishes updates). Build-profile `env`
   in `eas.json` does **not** apply to a hand-run `eas update`, so an OTA bundle exported with the preview flag set and `EXPO_PUBLIC_APP_ENV` unset
   would still enable V2 for **every installed 1.0.0 binary**. The guard also fails **open** (unset environment = allowed); a test pins that.
3. **No mobile flag reader.** The registry/rollout machinery exists (`apps/api/core/feature_registry.py`, admin-only `feature-rollout.yml`,
   `hotels.enabled_features` already returned to web), and `hk_ai_assistant` is a UI-only precedent, but mobile has no reader on this branch.
4. **Web on Vercel** (`patelrep-web.vercel.app`) is a second deployment whose `NEXT_PUBLIC_APP_ENV` was not inspected.

### I.3 Recommendation: Option A (controlled, reversible rollout). Option B (replace the legacy look) is not recommended
Option B deletes the legacy tokens, the `evening`/`mobileHandoff` primitives and the flag, so rollback becomes a revert-and-redeploy of both web
and a store binary. With zero device evidence, that is the wrong trade. Option A, as a **separate, approved change** (it touches `apps/api`, so it
is out of scope for this design-only PR):

1. Register `design_v2` as a `release`, `backend_enforced=False` flag in `feature_registry.py` and its web mirror
   (`scripts/check-feature-flag-registry.mjs` gates parity). Default off. No migration, no billing impact.
2. Web: in `ShellV2`/`DashboardShell`, enable V2 when the preview flag is on **or** the hotel's `enabled_features` contains `design_v2`; keep the
   production hard-off only for the build flag, not for the tenant flag.
3. Mobile: read the same flag from the already-fetched hotel record; V2 scope active when the flag is on. Make the guard fail **closed**
   (require an explicit non-production `EXPO_PUBLIC_APP_ENV`) and update the pinned test deliberately.
4. Turn it on for **one staging tenant**, then one pilot tenant, with `Feature Rollout` (admin-only, tenant-by-tenant, audited).
5. Gate the first production tenant on: a device pass of K.3, a screen-reader pass, and the three open items B3/G.3/C.1.

### I.4 Exactly how users would see it, after approval
Merge to `main` → existing release workflow deploys web (flag off) and the next store build ships the code (flag off) → an admin dispatches
`Feature Rollout` with `design_v2=true` for one tenant → that tenant's web session and mobile app switch on the next load.

### I.5 Rollback
Dispatch `Feature Rollout` with `enabled=false` for that tenant (seconds, no rebuild, no redeploy). Because the code path stays in both
bundles, existing 1.0.0 binaries are compatible with old and new server state. Cached per-user preferences (`patelrep-ui-prefs.theme`) are
shared with the legacy look and need no migration. Until step 1-3 exist, **there is no safe rollback for a production activation**.

---

## J. Cleanup (§15): what was and was not removed
**Nothing was deleted.** Each legacy artifact is still required by something: the flag-off path (production today), protected status-contract
tests, unmigrated surfaces (A.1, B), and rollback. Candidates for a later removal PR, **after** rollout: `evening`/`mobileHandoff` primitives,
`serifFont`/`monoFont` call sites, uppercase `headerMeta`, `housekeeperAccent`, legacy `Sidebar`, legacy dashboard branch, per-file raw-gray
overrides (about 20 files still use raw palette classes, measured; the three largest are the `onboarding`, `logbook` and `scheduling` pages, now covered by the remap). Phase 8 only *reduced* the
need for them (fonts, uppercase, stray utilities, italic).

---

## K. Open blockers, device checklist, decisions

### K.1 Blockers
| ID | Severity | Area | Problem | Remediation |
|---|---|---|---|---|
| B1 | **High** (activation) | Release | No runtime activation mechanism; web and mobile production are hard-off; OTA can bypass the guard (I.2) | I.3, separate approved change |
| B2 | **High** (activation) | Mobile | No device/emulator run, no assistive tech, no real-data run of any V2 mobile screen | K.3 on one iPhone and one Android phone |
| B3 | Medium | Web | `/reports` unverified with data (its overview payload is large); the guest-request detail drawer on the Tasks board was not opened; 13 settings screens and 5 account/billing routes unopened | Run against staging with real data, or build a fuller fixture |
| B4 | Medium | AI/cost | Engineer, Front Desk, GM auto-fire a paid briefing on mount (pre-existing) | G.3 |
| B5 | Medium | A11y | Six more web dialogs without focus management (C.1) | Apply the hook; low risk, mechanical |
| B6 | Medium | Mobile visual | 17 files keep uppercase micro-labels under V2 (A.1) | Edit text nodes with a device in hand |
| B7 | Low | Web visual | Inconsistent selected-state styling inside forms (B.1) | Component-level redesign |
| B8 | Low | Process | Five production-reaching a11y fixes ride in a "design" PR (F.3) | Accept consciously, or split them into their own PR |

### K.2 Why the decisions are what they are
- **Merge: NOT READY.** Not because merging would change production visuals (it would not), but because the brief names unverified core workflows
  and unfinished areas as blockers, and F.4/B3 are exactly that. The shortest path to **READY TO MERGE**: green CI on the final SHA, plus either
  the K.3 device pass for the seven roles or your explicit decision to merge with the flag off and treat K.3 as the activation gate.
- **Activation: NOT READY.** B1 and B2 each independently block it.

### K.3 Device and assistive-technology QA checklist (none of this has been done)
Per role (Housekeeper, Inspector, Supervisor, Engineer, Chief Engineer, Front Desk, GM), on one notched iPhone and one Android phone, build with the preview
flag on, light **and** dark, English **and** Spanish:
1. Home → primary action → nested screen → back; active tab highlighted; hidden routes (Profile > Language, Notifications, a detail screen) do not bounce to Home.
2. Every sheet: open, scroll, keyboard open with the footer still reachable, submit, retry after airplane-mode failure, cancel with unsaved input, swipe-down/back dismissal.
3. At 320 dp and at the largest system font: no clipped text, no overlapping controls, long Spanish labels wrap.
4. Offline: complete a room / task / work-order update / PM, confirm "saved locally" copy, reconnect, confirm it syncs once and the confirmed state replaces the pending one.
5. VoiceOver and TalkBack: every control has a name, reading order matches the visual order, sheet focus moves in and returns, status is announced.
6. AI surfaces: nothing paid fires on open; unavailable-AI state; suggestion visibly separate from operational data.
7. Web: keyboard-only walk of the command palette, one drawer per area, and the account menu; NVDA or VoiceOver on the dashboard.

---

## L. CI and test evidence
**Baseline before Phase 8:** PR #200 head `91ea771d` had all 27 checks green (CI Gate, Staging Gate, Build/Web, both Room-Board regression gates,
Database Migration Gate, i18n parity, frozen-file guard, security scan, mobile Jest/lint/type-check, Vercel). `main` had not moved since the branch
point (`0 behind, 10 ahead`); mergeability was `CLEAN`.

**Local runs on the final Phase 8 code** (these are not a substitute for CI on the pushed SHA):

| Suite | Result |
|---|---|
| Mobile `tsc --noEmit` | clean |
| Mobile ESLint | clean |
| Mobile Jest (full) | **481 / 481 suites, 10,870 / 10,870 tests** |
| Web `tsc --noEmit` | clean |
| Web ESLint | 0 errors, 5 warnings (pre-existing, files this PR does not touch) |
| Web `test:unit` | **485 / 485** (480 before Phase 8, +5 Phase 8 contract tests) |
| Web `check:frozen-files` | OK |
| Web `check:i18n-parity` | OK (3,722 keys) |
| Web `check:contrast` | OK, all enforced pairings AA in both modes |
| Web production build, V2 on | succeeded 4 times, once per fix round |
| Flag-off web/mobile builds | **not run locally**; covered by CI `Build / Web` and mobile jobs on the pushed SHA |

**CI on the final pushed SHA is recorded on the PR, not here:** a document cannot contain the hash of the commit that contains it.

**Not run:** Playwright E2E suites (`phase1`, `phase4`, `reports`, `i18n`, `staging`, `regression`), the Room-Board visual gates locally (CI runs them),
any staging session, any device or emulator, any assistive technology.


---

# Phase 9 addendum: completion pass

Evidence tiers are the same as above (T1 automated, T2 real browser against the hermetic mock, T3 code inspection, None). Device,
emulator and assistive-technology runs are **DEFERRED BY OWNER**; nothing below claims them.

## Correction to section B

Section B's "Remap" status described the **legacy** page variants. Production tenants have all redesigned sections on (migration 098), and the
mock did not. See design doc section 68 for the full explanation and section 69 for the current per-screen matrix.

## Blocker status after Phase 9

| ID | Was | Now | Evidence |
|---|---|---|---|
| B1 | No runtime activation mechanism | **Unchanged, still open.** Out of scope for this pass by the owner's instruction | none |
| B2 | No device/emulator/AT run | **DEFERRED BY OWNER.** Still no device evidence | none |
| B3 | `/reports` unverified with data | **Closed for rendering.** Fixtures give every Reports view representative data; rendered light/dark, 1440/390, 0 overflow, 0 errors. Data-rich drawers and exports not exercised | T2 + T1 shape tests |
| B4 | Engineer, Front Desk, GM auto-fire a paid briefing | **Closed (client).** Tap-to-load, own commit `3c570baf`, regression tests for mount/re-render/remount/account switch. API and credit accounting untouched | T1 |
| B5 | Six web dialogs without focus management | **Closed.** All six handled; contract test pins them | T1 (T2 for the discard drawers) |
| B6 | 17 mobile files with uppercase labels | **Closed for 16.** The 17th is the asset print label, intentionally unchanged. No device view of the result | T1 |
| B7 | Inconsistent selected states | **Closed** in the toggles that use the three legacy patterns; one solid-primary language. Components that style selection another way were not found by grep and may remain | T2 on Tasks, Logbook, Work Order, Scheduling |
| B8 | Production-reaching a11y fixes ride in a design PR | **Larger now:** Phase 8's five plus this pass's six (see below). The owner decides whether to accept or split them | disclosure |

### Production-reaching changes (not behind the flag)

1. Phase 8: `useModalFocusTrap` opener tracking, `CommandPalette` focus return, SOP/Create-WO/Bulk-archive/Asset-detail/SOP-query dialogs,
   dashboard room-list drawer, `eas.json` production env.
2. Phase 9 web a11y: asset deactivate confirm, Room Board clean-type prompt (frozen file, hash bumped with a reasoned entry), Assignment Workspace
   clean-type prompt, Out-of-order create and detail dialogs; AI Copilot and Feedback launchers (non-modal, Escape, focus return).
3. Phase 9 mobile AI: tap-to-load briefings for Engineer, Front Desk, GM (explicit owner approval; this changes behavior for production users after release).

Everything else added in this pass is behind the V2 flag or is test infrastructure.

## New findings made while verifying

- Dark mode: the floating **Feedback** button was unreadable (near-white text on a near-white pill). Fixed.
- The Lost & Found **Returns** tab showed `NaN` against the old mock. That was a fixture gap (the summary endpoint returns a counts object);
  with fixtures it shows the counts. Not an app defect.
- Dev-server hydration warnings on the Work Orders page appeared only after adding new i18n keys without restarting the dev server (stale
  server-side locale); the production build is the check of record.

## Still not done (explicit)

- Structural redesign of Housekeeping Team Plan/Assignments/Room detail, Engineering assets/PM/vendors/WO record, Guest Operations drawers, Scheduling,
  12 settings screens and the remaining pages listed as Color-only in section 69.
- Production activation, tenant rollout, device and assistive-technology QA, performance measurement.

**Decisions are unchanged: merge NOT READY, production activation NOT READY.** The device checklist (K.3) remains the activation gate.

## Phase 9 local verification (not a substitute for CI on the pushed SHA)

| Suite | Result |
|---|---|
| Mobile `tsc --noEmit` | clean |
| Mobile ESLint | clean |
| Mobile Jest (full) | **482 / 482 suites, 10,894 / 10,894 tests** (was 481 / 10,870) |
| Web `tsc --noEmit` | clean |
| Web ESLint (`--quiet`) | 0 errors |
| Web `test:unit` | **507 / 507** (was 485): dialog a11y + discard-guard contracts, fixture shape tests |
| Web `check:frozen-files` | OK (one reasoned allowlist entry: `RoomStatusBoard.tsx`, focus trap only) |
| Web `check:i18n-parity` | OK (3,733 keys) |
| Web `check:contrast` | OK, all enforced pairings AA in both modes |
| Web production build, V2 flag **off** | succeeded (the hermetic runner builds it) |
| Browser, V2 on, redesigned sections on | 38 routes x {1440, 390} x {light, dark}: **0 horizontal overflow**; `body[data-dv2-mode]` asserted; routes with errors were fixture gaps, all fixed and re-run clean except Housekeeping's realtime WebSocket (the mock has no realtime) |
| Browser, real drawers | Create Task, Add Handoff, Create Work Order, Invite person opened; discard-guard flow exercised (clean close, dirty prompt, Escape keeps editing, Discard returns focus) in all three create drawers |

**Not verified locally:** the Room-Board visual gate. The committed baselines are Linux; a Windows run has no `win32` baseline to compare, so it
wrote new ones (deleted, not committed). The flag-off Housekeeping filters, summary and Attention card are the original markup behind
`isDesignV2PreviewEnabled()` (diff vs Phase 8 shows only additions plus wrapper ternaries that reduce to the original class strings when the
flag is off), and CI's gate is the check of record. Playwright E2E suites other than that gate, staging sessions, devices and assistive technology were not run.

## Phase 10 addendum

See design doc sections 72 and 73. Summary: the data-driven review found nine real defects (four are production bugs independent of V2: the
breadcrumb object-key text, the missing Readings label, duplicated overdue PM rows, "Hvac"), all fixed with regression tests where they can be pinned.
The production-reaching (ungated) list grows by those bug fixes, the singular/plural Team Plan summary and the phone-width week navigation. Merge and
activation decisions are unchanged (NOT READY); device checks remain **DEFERRED BY OWNER**.


## Phase 11 addendum

See design doc sections 74 and 75. Summary: the browser review opened the remaining drawers and sub-views with fixture data and found real
defects, **all production-reaching and independent of V2**: full-width Engineering drawers (a Tailwind class that was never generated), eight
overlays whose action row was clipped by an inherited `space-y` margin, two drawers that never trapped focus or closed on Escape, claim stay dates
shown a day early, six raw i18n keys, a "no access" flash for GMs, and a squeezed Lost & Found title on phones. Only the Predictions selected state is
gated by the V2 flag. Each fix has a regression test, and a new `i18nKeysResolve` test fails the build when any literal `t()` key is undefined.

**Production-reaching list (now larger).** Add to the Phase 8, 9 and 10 lists: the items above, `PageHeader` wrapping (affects every page header only
when its title block would drop below 14 rem), and the `common.*` / `logbook.viewAll` keys.

**Decisions are unchanged: merge NOT READY, production activation NOT READY.** The status matrix in design doc section 75 states exactly which
screens were verified, which were only route-checked, and which remain (Onboarding amber accents; every mutation path; Readings with data).
Device and assistive-technology testing remain **DEFERRED BY OWNER**.


## Phase 12 addendum: final implementation fixes

Device, emulator and screen-reader testing remain **DEFERRED BY OWNER** and were not attempted. Everything below is automated or browser-on-localhost.

**Onboarding V2: done for presentation, with one pre-existing functional defect left as is.**
All six wizard steps now render in Precision Slate + Electric Blue in light and dark. The wizard's own button, stepper, AI panel and selected step label
all hung off `var(--caution)`, which V2 maps to the `pickup` status colour (burnt orange / amber), so a scoped block in `contentRemapV2.css`
(`[data-onboarding-v2]`) re-points the three caution tokens to the primary family for the wizard subtree only. Also fixed there: white text on solid
primary fills in dark, completed-step dots (white on green-400, about 1.9:1), `border-amber-100/50` hairlines, and the text inputs, which set no
background and so showed Chromium's grey `rgb(59,59,59)` on the navy card. Nothing applies without the V2 body scope, so the legacy look is unchanged.
A browser test scans every rendered element of all six steps for orange/amber hues (zero found in both modes) and checks contrast of each step's primary action.

**Shared defect found while doing this (V2 dark only):** the shared primary button and about 30 other `bg-accent text-white` elements put white text on
the dark-mode primary (`#60A5FA`), 2.5:1. One V2-dark-scoped rule gives them the on-primary ink. No effect with V2 off.

**Not fixed, needs a product decision (production, independent of V2):** the manual-entry tab's "Save Rooms & Continue" calls `onComplete()` directly and sends
nothing, so typed rooms are never saved (since the initial commit). `POST /rooms/import` is not a drop-in: it requires `room_type_code` (the tab collects none),
is GM/supervisor only, and resets the status of rooms that already exist to DIRTY. A `test.fail()` browser test records the correct behaviour and will flag the day it is fixed.

**Automated workflow verification (isolated fixtures, no production or shared-staging writes).**
`lib/api/operationalWorkflows.test.ts` (21 cases, in the CI `test:unit` list) drives the real typed clients and the real transport against a stubbed `fetch`:
inspection submit (JSON and multipart with photos), required-answer and photo gating, release refused with 409, reclean; meter readings and work-order
completion with structured parts; PM completion and vendor engagement; Lost & Found claims, pickup and shipping returns, disposition and void; logbook
create, resolve, archive, carry-forward, acknowledge, delete; plus 403 guards, 409 conflicts, 422 field messages, 5xx leaks, network loss, 204 and Retry-After.
`e2e/workflows-hermetic.spec.ts` (`npm run test:e2e:workflows`) walks the wizard in a real browser with intercepted writes: field validation sends nothing, the typed
profile is the exact payload, a server rejection keeps the user on step 1, then CSV import, invites (partial failure reported), Opera connect (unverified stays put) and SOP upload.
**Not wired into CI:** a separate workflow job would be a control-plane change, which was out of scope. The unit test runs in CI; the browser spec runs locally.
Not covered: browser-level drives of the Lost & Found, Logbook and Engineering drawers (their request contracts and error paths are covered at the client layer;
their permission-driven action visibility comes from API capabilities and was reviewed in Phases 10 and 11, not re-driven here).

**Real defect fixed (production-reaching, independent of V2):** `toFriendlyError` in `lib/api/client.ts` replaced any server message containing the substring
`code` with "Something went wrong", so validation messages such as `[body.postal_code] Field required`, `[body.problem_code_id] ...` (the work-order completion form)
or "ZIP code does not match" never reached the form. It now treats only the raw database shape (`code: 23505`, `"code": ...`) as unreadable.

**Mobile Jest.** The failing check was a clock-dependent test, not an infrastructure problem. Attempt 1 of the Phase 11 run started at 05:57 UTC, which is
23:57 in Chicago; `TaskHistory.test.tsx` builds its "completed today" fixtures from the real `Date.now()` (one and two minutes ago) and the screen groups by hotel day, so
they crossed midnight and landed in "yesterday" (3 failures in 1 of 482 suites; attempt 2 passed minutes later). The test now pins the clock with the existing `pinMidweekClock` helper.
The other seven files using the same `NOW = Date.now()` pattern were run with the system clock forced to 00:00:30 Chicago: all pass. No test was weakened, skipped or retried to get green.

**Production-reaching changes in this pass (not behind the V2 flag):** the `toFriendlyError` fix above, and the inert `data-onboarding-v2` attribute on the wizard roots.
Everything else is V2-scoped CSS or test code.
