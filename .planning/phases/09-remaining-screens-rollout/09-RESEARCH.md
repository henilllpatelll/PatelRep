# Phase 9: Remaining Screens Rollout - Research

**Researched:** 2026-07-30
**Domain:** Primitive/theme migration (call-site swap) of the remaining 13 mobile screens (~5,600 lines) + 7 `components/supervisor/` files onto Phase 7's theme/primitive layer, plus the mandatory i18n gate-widening for 4 Phase-8 floor files. Expo Router (SDK 54) React Native app.
**Confidence:** HIGH (every count, Alert classification, and token gap below is a direct repo read/grep this session, not training data)

## Summary

Phase 9 is the same *pure call-site migration* as Phase 8 — no new visual design, no new dependencies, no behavior/data/RBAC changes — applied to every screen Phase 8 didn't touch. The mechanical contract is identical and already fully documented in `08-PATTERNS.md`: swap `C.*` → `theme.*` via the verified mapping table, wrap non-pressable `Card` in `Pressable`, and reclassify each `Alert.alert` as confirm-stays / feedback→Toast per D-10. This research verified, file-by-file, the exact `C.*` reference counts (712 total across the 28 files), the 29 `Alert.alert` call sites (6 stay blocking, 23 convert to Toast), and reconciled the mandatory i18n backlog (the roadmap's "22 raw literals" = **16 JSX-text nodes + 6 placeholder attributes** across the 4 gate-exempt files).

Three findings materially change planning versus a naive "same as Phase 8" assumption:

1. **The Wave-0 `tokens.ts` gap that blocked Phase 8 is already fixed** — `textDisabled`, `accentBrassSoft`, `accentBrassLine` now exist in both `lightTheme`/`darkTheme` (`tokens.ts:83-85,111-113`). Phase 9 needs **no** token prerequisite for the ordinary screens. [VERIFIED: tokens.ts read this session]

2. **`copilot/index.tsx` is not a `C.*` screen — it is built entirely on hard-coded `darkTheme.*` tokens** (1 `C.` ref total; ~40 `darkTheme.*` refs). It renders an *intentionally dark* AI aesthetic and uses three keys that exist **only in `darkTheme`** (`surfaceElevated`, `glass`, `glassBorder`) with **no `lightTheme` equivalent**. Naively routing it through `useTheme()` (pinned to light this milestone) would flip the entire screen to a broken/undefined light palette — a visible redesign that directly violates D-09's "migration not rebuild." This needs a **user decision** before SCREENS-08 can be planned (see Open Questions #1). [VERIFIED: copilot/index.tsx + tokens.ts read this session]

3. **The `components/shared/evening.tsx` composite components** (`StatusPill`, `StatusRail`, `ProgressBar`, `Chip`, `AIBriefingCard`, `SectionHeader`) are used heavily across the home/dashboard family (16 `SectionHeader`, 5 `Chip`, 5 `AIBriefingCard`, 4 `StatusRail`/`ProgressBar` call sites) but are **explicitly out of scope** (Deferred section of CONTEXT + Phase 8 precedent). Screens keep *calling* them; only each screen's own `C.*` refs migrate. `evening.tsx` will therefore still `import { C }` after Phase 9 — which is fine, because it is a shared-component library file, not a *screen* (success criterion #5 says "no *screen*"). The one exception is `CompanionHome.tsx`'s `FocusCard`/`ShiftMosaic`/`SignalChips`, which ARE in scope per D-05. [VERIFIED: grep of evening imports this session]

**Primary recommendation:** Plan in D-01 usage-frequency order across ~7 waves (Profile+Dashboards → Supervisor screens+modals → Engineering-adjacent → Guest-service → Logbook+SOP → AI Copilot → Alerts+Notifications+Room Status), sizing plans at ~150-400 lines of migration each (Phase 8's granularity), which yields ~13-16 plans. Reuse `08-PATTERNS.md`'s contracts verbatim — do not re-derive the mapping table or re-design any primitive. Surface the copilot dark-theme question to the user during plan review rather than silently picking a reading.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Screen rendering (all 13 screens) | Native Mobile Client (`app/(app)/**`) | — | Expo Router screens; pure presentation, no SSR tier exists |
| Dashboard composite components (`SupervisorHome`, `EngineerHome`, `CompanionHome`) | Native Mobile Client (`components/home/**`, `components/engineering/**`) | — | Presentational; imported into `home/index.tsx` |
| Supervisor modals/sheets (7 files) | Native Mobile Client (`components/supervisor/**`) | — | Presentational + request-response form submits |
| Primitive components (Button/Card/StateBlock/StatusBadge/Toast) | Native Mobile Client (`components/ui/**`, `lib/theme/**`) | — | Built in Phase 7; Phase 9 only consumes |
| i18n string resolution (`t()`, EN+ES keys) | Native Mobile Client (`react-i18next` + `i18n/` locales) | — | 4 backlog files get new keys; all others reuse existing keys |
| Offline sync, RBAC, data contracts, AI/API business logic | API / Backend + `stores/appStore.ts` / `lib/offline/**` (frozen) | — | Explicitly out of scope — Phase 9 must not touch these or the shapes they mutate |

**Conclusion:** 100% of Phase 9 work is in the Native Mobile Client tier. No task should touch `apps/api/**`, `lib/offline/**`, `stores/appStore.ts`'s queue shape, or `lib/navigation/roleTabs.ts`. Any task action proposing edits to those paths is out of scope and should be flagged by the plan-checker.

## Standard Stack

No new libraries. Phase 9 consumes exactly what Phase 7 shipped and Phase 8 already exercised — **zero new npm dependencies** [VERIFIED: `.planning/research/STACK.md` + no new imports needed]. The full stack table is in `08-RESEARCH.md` §"Standard Stack" (react-native 0.81.5, @expo/vector-icons ^15, react-i18next ^14.1.2). Nothing changes.

**Do not add:** no `react-native-toast-message` (broken on SDK 54), no styling library, no new UI kit.

## Don't Hand-Roll

Identical to Phase 8 — the primitives exist to replace these exact hand-rolled patterns, which recur dozens of times across the 28 in-scope files:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card surface (bg/border/radius/shadow) | A per-screen `styles.card` | `components/ui/Card.tsx` (wrap in `Pressable` if tappable) | Extracted from `RoomQueueCard`'s exact shell in Phase 7 |
| Status color+icon+label chip | A new chip/pill | `components/ui/StatusBadge.tsx` | 13-key closed enum covers every room/WO/task status |
| Loading/empty/error block | Hand-rolled spinner + custom empty card | `components/ui/StateBlock.tsx` | One `status` prop; `retryLabel` required whenever `onRetry` passed |
| Non-blocking feedback | A custom banner/snackbar | `useToast()` | Positioned below `OfflineBanner`; 23 `Alert.alert` sites convert here |
| Primary/secondary/destructive button w/ loading | `TouchableOpacity` + `ActivityIndicator` | `components/ui/Button.tsx` | Loading replaces label in place, no layout shift |

**Key insight:** every screen in scope currently hand-rolls all five. See the `C.` reference counts table below for the per-file scale.

## `C.*` → `theme.*` Migration Map

**Do not re-derive.** The exhaustive, verified table lives in `08-RESEARCH.md` §"`C.*` → `theme.*` Migration Map" and `08-PATTERNS.md` §"Shared Patterns". It applies unchanged to all Phase 9 files. Critical reminders carried forward:

- **Name changes, not just path changes:** `C.caution`→`theme.status.pickup`, `C.alert`→`theme.status.dirty`, `C.info`→`theme.status.clean`, `C.ooo`→`theme.status.outOfOrder`. A rename-only find/replace will silently mis-color. Each site needs its color *role* identified. [VERIFIED: tokens.ts:127-178]
- **`C.ink4`/`C.brassSoft`/`C.brassLine` NOW have theme paths** (unlike during Phase 8): `theme.textDisabled` (`#B7AA99`), `theme.accentBrassSoft` (`#F4E7C6`), `theme.accentBrassLine` (`#E2C679`). Phase 8's Wave-0 fix already added them. [VERIFIED: tokens.ts:83-85]
- **Dark-hero screens use `shellTokens`** (`import { shellTokens }` or `C.shell*`) for their dark chrome heroes → route to `theme.shell.*` (same object reference; migrate for reactivity consistency). Confirmed in scope for: `profile`, `home`, `SupervisorHome`, `EngineerHome`, `CompanionHome`, `assignments`, `assets`, `pm-schedules`, `guest-requests`, `room-status`. [VERIFIED: grep this session]

### New token gap (AI/copilot only) — `surfaceElevated`, `glass`, `glassBorder`
These three keys exist in `darkTheme` but **NOT in `lightTheme`** (`tokens.ts:98,114,115`). They are used by `copilot/index.tsx` (via its static `darkTheme` import) and nowhere else in Phase 9 scope. They only become a blocker **if** the planner decides to route copilot through `useTheme()` in light mode. If copilot stays intentionally dark (recommended — see Open Questions #1), no `tokens.ts` change is needed and `MobileVisualTokens.test.ts` is untouched. [VERIFIED: tokens.ts + copilot read this session]

## `C.` / `Alert.alert` / `useTheme` Census (verified via grep, informs task sizing)

Every file starts at **0 `useTheme()` calls** — all need the hook added. `C.` counts are the literal Definition-of-Done target (must end at 0 per D-03, except the shared-component caveat noted above).

| File | Lines | `C.` refs | `Alert.alert` | `Touchable` | Req | Notes |
|---|---|---|---|---|---|---|
| `app/(app)/profile/index.tsx` | 539 | 24 | 1 (stays) | 9 | SCREENS-01 | Sign-out confirm at :163 stays `Alert.alert` |
| `app/(app)/home/index.tsx` | 570 | 31 | 0 | 7 | SCREENS-02 | `HousekeeperHomeScreen` default + inline `FrontDeskHomeScreen`(:248)/`GMHomeScreen`(:300) |
| `components/home/SupervisorHome.tsx` | 405 | 57 | 0 | 17 | SCREENS-02 | Highest `C.` count outside a screen file |
| `components/engineering/EngineerHome.tsx` | 637 | 32 | 0 | 13 | SCREENS-02 | Largest file in phase |
| `components/home/CompanionHome.tsx` | 337 | 12 | 0 | 7 | SCREENS-02 | Exports `FocusCard`/`ShiftMosaic`/`SignalChips` (in scope, D-05) |
| `app/(app)/assignments/index.tsx` | 741 | 52 | 2 (1 stays) | 16 | SCREENS-03 | Largest screen; :238 action-sheet stays, :361 lateCo info→Toast |
| `app/(app)/scheduling/index.tsx` | 156 | 21 | 0 | 0 | SCREENS-03 | **0 `t()` calls** — raw literals, not gated |
| `app/(app)/staff/index.tsx` | 158 | 17 | 0 | 0 | SCREENS-03 | Partial `t()` |
| `components/supervisor/atoms.tsx` | 235 | 21 | 0 | 7 | SCREENS-03 (D-07) | **0 `t()`** shared atoms |
| `components/supervisor/BroadcastModal.tsx` | 137 | 16 | 2 (both→Toast) | 11 | SCREENS-03 (D-07) | Hardcoded EN "Sent"/"Error" (not gated, stays untranslated) |
| `components/supervisor/DirectMessageModal.tsx` | 118 | 11 | 1 (→Toast) | 5 | SCREENS-03 (D-07) | :37 sendError→Toast |
| `components/supervisor/EndShiftModal.tsx` | 139 | 16 | 1 (→Toast) | 5 | SCREENS-03 (D-07) | :43 submitError→Toast |
| `components/supervisor/HousekeeperPicker.tsx` | 146 | 12 | 0 | 6 | SCREENS-03 (D-07) | |
| `components/supervisor/RoomDetailSheet.tsx` | 363 | 50 | 4 (2 stay) | 14 | SCREENS-03 (D-07, **D-08 own plan**) | :50/:191 confirms stay; :206/:208→Toast |
| `components/supervisor/ShiftNoteModal.tsx` | 104 | 10 | 2 (both→Toast) | 9 | SCREENS-03 (D-07) | Hardcoded EN "Saved"/"Error" |
| `app/(app)/assets/index.tsx` | 296 | 22 | 3 (all→Toast) | 0 | SCREENS-04 | :126/:144 error, :138 success→Toast |
| `app/(app)/pm-schedules/index.tsx` | 336 | 48 | 1 (→Toast) | 5 | SCREENS-04 | :93 completeError→Toast |
| `app/(app)/guest-requests/index.tsx` | 277 | 29 | 0 | 7 | SCREENS-05 | List (pair w/ detail per D-02) |
| `app/(app)/guest-requests/[requestId].tsx` | 317 | 40 | 0 | 11 | SCREENS-05 | **0 `t()`** detail |
| `app/(app)/lost-found/index.tsx` | 290 | 42 | 1 (→Toast) | 11 | SCREENS-05 | **0 `t()`**; :99 hardcoded EN error→Toast |
| `app/(app)/logbook/index.tsx` | 206 | 27 | 0 | 3 | SCREENS-06 | List (pair w/ new per D-02) |
| `app/(app)/logbook/new.tsx` | 156 | 24 | 0 | 3 | SCREENS-06 | |
| `app/(app)/sop/index.tsx` | 133 | 19 | 0 | 3 | SCREENS-07 | **0 `t()`** list (pair w/ detail) |
| `app/(app)/sop/[sopId].tsx` | 122 | 23 | 0 | 0 | SCREENS-07 | **0 `t()`** detail |
| `app/(app)/copilot/index.tsx` | 425 | **1** | 6 (all→Toast) | 19 | SCREENS-08 (D-09/D-10) | **Anomaly: built on `darkTheme.*`, not `C.*` — see Open Questions #1** |
| `app/(app)/alerts/index.tsx` | 177 | 20 | 0 | 0 | SCREENS-09 | |
| `app/(app)/notifications/index.tsx` | 152 | 17 | 0 | 3 | SCREENS-09 | **0 `t()`** |
| `app/(app)/room-status/index.tsx` | 576 | 44 | 5 (2 stay) | 12 | SCREENS-10 (D-04) | :311/:330 action-sheets stay; :286/:298/:433 errors→Toast; renders `CreateWorkOrderModal` |

**Totals:** ~712 `C.` references, 29 `Alert.alert` calls (6 stay blocking, 23 → Toast), 0 `useTheme()` calls anywhere (all need it added).

**Task-sizing implication:** the four largest migrations — `assignments` (52), `SupervisorHome` (57), `RoomDetailSheet` (50, already carved out by D-08), `room-status` (44) — each warrant their own plan or a 2-task split for reviewability, mirroring how Phase 8 split `[roomId].tsx`/`[woId].tsx`. The small screens (`scheduling` 21, `staff` 17, `sop` pair 42 combined, `alerts` 20, `notifications` 17, `logbook` pair 51) can each be a single task or bundled 2-per-plan.

## Alert.alert → Toast Classification (D-10, verified per call site)

D-10's rule (from Phase 8 D-04): **confirm/choice dialogs (Yes/Cancel or multi-button action sheets gating a state change) stay `Alert.alert`; outcome-reporting (success/error after the fact) converts to `Toast`.** All 29 calls classified below with surrounding code read this session.

### Stays `Alert.alert` (6 calls — genuine confirm/choice)
| File:Line | What | Why it stays |
|---|---|---|
| `profile:163` | Sign-out confirm (title + confirm + Cancel/Confirm buttons) | Blocking confirm before a state change |
| `assignments:238` | Room action sheet (Reassign / Remove-assignment / Cancel) | Multi-way choice menu |
| `RoomDetailSheet:50` | `confirmRemove` (Cancel / Confirm) before removing an assignment | Blocking confirm |
| `RoomDetailSheet:191` | DND-override wellness-check confirm (Cancel / Confirm) | Blocking confirm |
| `room-status:311` | OOO-reason sub-menu (Cancel / No reason / Add reason) | 3-way choice |
| `room-status:330` | Room action sheet (Create WO / OOO options / Cancel) | Multi-way choice menu |

### Converts to `Toast` (23 calls — outcome reporting)
| File:Line(s) | Variant | Note |
|---|---|---|
| `assignments:361` | `info` | lateCo details (title+body, no buttons) |
| `BroadcastModal:38` / `:40` | `success` / `error` | **Hardcoded EN** ("Sent", "Message queued…", "Error") — pass through as-is; :38 fires `onClose` side-effect together with toast |
| `DirectMessageModal:37` | `error` | `t("directMessage.sendError")` |
| `EndShiftModal:43` | `error` | `t("endShift.submitError")` |
| `RoomDetailSheet:206` / `:208` | `success` / `error` | dndOverrideCreated / dndOverrideError |
| `ShiftNoteModal:28` / `:30` | `success` / `error` | **Hardcoded EN** ("Saved", "Shift note logged.", "Error"); :28 fires `onClose` together |
| `assets:126` / `:138` / `:144` | `error` / `success` / `error` | :138 woCreated success (has title+body — combine into one toast string) |
| `pm-schedules:93` | `error` | completeError |
| `lost-found:99` | `error` | **Hardcoded EN** ("Error", "Could not log item. Try again.") |
| `copilot:158` / `:168` / `:178` | `success` (×3) | taskCreated / workOrderCreated / guestRequestCreated (all use `t()`) |
| `copilot:160` / `:170` / `:180` | `error` (×3) | Each drops a hardcoded `"Error"` title → `toast.error(err.message)` |
| `room-status:286` / `:298` / `:433` | `error` (×3) | oooError / removeOooError / oooError |

**Locked pattern (carried from Phase 8):** for the two "success → OK → side effect" cases (`BroadcastModal:38`→`onClose`, `ShiftNoteModal:28`→`onClose`), fire the toast and the side effect together (`toast.success(msg); onClose();`) — do not gate the side effect behind toast dismissal. **Only change the feedback call** inside each handler — do not alter the preceding `await api.*` calls or early-return guards (these handlers mix real business logic with the alert).

**copilot note:** the three `confirmTask`/`confirmWorkOrder`/`confirmGuestRequest` actions are triggered by *in-UI* Create/Dismiss buttons (the `confirmCard`, `copilot/index.tsx:201-242`), **not** by `Alert.alert` — so there are zero blocking confirms in copilot; all 6 alerts are pure outcome reporting → Toast.

## Mandatory i18n Gate-Widening (backlog — non-negotiable)

**Goal:** remove the 4 `ignores` entries from `apps/mobile/eslint.config.mjs:47-50` and wire real `t()` calls (EN+ES keys) so `npm run lint` enforces the gate on these Phase-8 floor files.

**Current `ignores` block** (`eslint.config.mjs:38-51`) — the 4 entries to remove:
```
'components/engineering/CreateWorkOrderModal.tsx',
'components/housekeeping/ReportIssueModal.tsx',
'components/housekeeping/SupplyRequestModal.tsx',
'app/(app)/tasks/index.tsx',
```
[VERIFIED: eslint.config.mjs read this session]

**Reconciling the roadmap's "22 raw literals":** verified by running eslint with the ignores removed, plus a placeholder grep. The 22 = **16 JSX-text nodes** (which the `markupOnly:true` gate flags and will hard-fail on) **+ 6 `placeholder=` attributes** (present, safety/UX copy, but which the current `markupOnly` config does **not** flag — see caveat below).

**The 16 gate-enforced JSX-text violations** (exact, from eslint probe this session):
| File | Line(s) | Strings |
|---|---|---|
| `tasks/index.tsx` | 253 | `Room {aiPreview.room_number}` |
| `CreateWorkOrderModal.tsx` | 121,155,166,191,221 | "New Work Order", "Location", "Category", "Priority", "Reported By" |
| `ReportIssueModal.tsx` | 95,96,101,113,159,191(×2) | "Submit Work Order", "Room {roomNumber}", "Issue title", "Category", "Priority", "Details", "(optional)" (+ two `*` required-asterisks) |
| `SupplyRequestModal.tsx` | 82,84(×2) | "Request Supplies", "Room {roomNumber} — tap what you need" |

**The 6 placeholder attributes** (part of the 22, NOT currently gate-flagged):
| File | Line(s) | Placeholder |
|---|---|---|
| `CreateWorkOrderModal.tsx` | 133,146,160 | "What needs to be fixed?", "Details (optional)", "Room number or area (e.g. 204, Lobby HVAC)" |
| `ReportIssueModal.tsx` | 105,195 | "e.g. Toilet not flushing, A/C not cooling", "Describe what you found…" |
| `SupplyRequestModal.tsx` | 128 | "Other (e.g. extra pillow, folding cot...)" |

⚠️ **Gate caveat (important for the planner):** the rule is configured `markupOnly: true` (`eslint.config.mjs:60-66`). In this mode eslint-plugin-i18next flags only JSX **text children**, and the `jsx-attributes.include: ['aria-label','placeholder','title']` config is effectively bypassed — confirmed empirically (my probe reported 16 violations, **zero** of them placeholders). Consequence: after wiring `t()` for the 16 text nodes and removing the ignores, `npm run lint` will pass **even if the 6 placeholders are left in English**. To honor the *full* 22-literal mandate (which includes safety-adjacent copy), the planner must wire the 6 placeholders too, even though the gate won't force it. Optionally the planner may also flip `markupOnly:false` (or otherwise make the attribute check active) so the gate actually protects placeholders going forward — but that would widen enforcement app-wide and is beyond the stated backlog scope; recommend flagging to the user, not doing silently. `[ASSUMED]` that the roadmap intends the 6 placeholders be translated as part of "22"; the arithmetic (16+6=22) strongly supports this.

**Also worth translating (not in the 22, but same files):** Phase 8 converted these modals' `Alert.alert` → Toast, passing hardcoded English strings straight into `toast.*()` calls (`CreateWorkOrderModal` "Work Order Created"/"Error"; `SupplyRequestModal` "Nothing selected"/"Requested"/"Error"). A thorough i18n pass on these files should also key those toast strings. Flag to the user; they are the "safety-critical copy" the exemption comment (`eslint.config.mjs:44-45`) warned about shipping unreviewed.

**New EN+ES keys needed:** ~13-15 distinct message keys (some of the 16 text nodes reuse the same string across modals — e.g. "Category"/"Priority"/"Room {n}") plus 6 placeholder keys. The planner should namespace them under the existing per-domain keyspaces (`workOrders.*`, `reportIssue.*`, `supplies.*`, `tasks.*`). Existing ES locale files under `apps/mobile/i18n/` must get matching keys — a missing ES key is a silent English fallback, not a lint error, so cross-check EN/ES parity per key.

## Architecture Patterns

### Recommended Wave Breakdown (respects D-01 usage order + D-02 pairing + D-05/D-08)

This is a **strong starting point, not a mandate** (D-03 gives the planner wave-count discretion). Sized at Phase 8's ~150-400-lines-per-plan granularity.

```
Wave 0 (prerequisite): i18n gate-widening (backlog) — can run first or in parallel
  └─ Task: wire t() for 16 text + 6 placeholder literals across the 4 files, add EN+ES keys,
           remove the 4 ignores entries, confirm `npm run lint` passes.
  └─ NOTE: NO tokens.ts prerequisite this phase (ink4/brass gap already fixed in Phase 8).

Wave 1 — Profile + Dashboard family (SCREENS-01, SCREENS-02; highest daily traffic, D-05)
  ├─ Task: profile/index.tsx (539L, 24 C., sign-out Alert stays)
  ├─ Task: home/index.tsx (570L, 31 C.) — HousekeeperHomeScreen + inline FrontDesk/GM (D-06: keep inline)
  ├─ Task: SupervisorHome.tsx (405L, 57 C.) — dedicated (highest C. count)
  ├─ Task: EngineerHome.tsx (637L, 32 C.) — dedicated (largest file)
  └─ Task: CompanionHome.tsx (337L, 12 C.) — FocusCard/ShiftMosaic/SignalChips (D-05 in scope)

Wave 2 — Supervisor screens + modals (SCREENS-03, D-07/D-08)
  ├─ Task: assignments/index.tsx (741L, 52 C., 2 Alert) — largest screen, consider A/B split
  ├─ Task: scheduling/index.tsx + staff/index.tsx (156+158L, 21+17 C.) — bundle two small screens
  ├─ Task: RoomDetailSheet.tsx (363L, 50 C., 4 Alert) — OWN plan (D-08)
  └─ Task: 6 small supervisor files — atoms/Broadcast/DirectMessage/EndShift/HousekeeperPicker/ShiftNote
           (104-235L each) — bundle; note atoms.tsx is shared, migrate first within the task

Wave 3 — Engineering-adjacent (SCREENS-04)
  └─ Task: assets/index.tsx + pm-schedules/index.tsx (296+336L, 22+48 C., 4 Alert total)

Wave 4 — Guest-service (SCREENS-05, D-02 pairing)
  ├─ Task: guest-requests/index.tsx + [requestId].tsx (277+317L, 29+40 C.) — list+detail together
  └─ Task: lost-found/index.tsx (290L, 42 C., 1 Alert)

Wave 5 — Logbook + SOP (SCREENS-06, SCREENS-07, D-02 pairing)
  ├─ Task: logbook/index.tsx + new.tsx (206+156L, 27+24 C.)
  └─ Task: sop/index.tsx + [sopId].tsx (133+122L, 19+23 C.)

Wave 6 — AI Copilot (SCREENS-08, D-09/D-10) — SEQUENCE LAST or gate on user decision
  └─ Task: copilot/index.tsx — BLOCKED on Open Questions #1 (dark-theme decision) before writing actions

Wave 7 — Alerts/Notifications + Room Status (SCREENS-09, SCREENS-10, D-04)
  ├─ Task: alerts/index.tsx + notifications/index.tsx (177+152L, 20+17 C.)
  └─ Task: room-status/index.tsx (576L, 44 C., 5 Alert) + D-04 verification of CreateWorkOrderModal integration
```
~15 plans. Every wave is independently shippable/testable, matching `.planning/research/ARCHITECTURE.md`'s P1 rollout guidance.

### Pattern: inline color props, not `makeStyles` rewrite (carried from Phase 7/8)
Keep each file's existing `StyleSheet.create()` for layout/spacing; change only `C.*`/`shellTokens.*` color refs to `theme.*` pulled from `useTheme()` inline at render. Lowest-diff, most reviewable. Do **not** introduce a `makeStyles(theme)` refactor.

### Pattern: `Pressable` wraps `Card` (carried from Phase 8)
`Card` has no `onPress`. Screens whose card/row is a single `TouchableOpacity` (e.g. `room-status`'s room cards `:274`, list rows in guest-requests/lost-found/logbook) must wrap `Card` in `Pressable` and re-apply asymmetric padding via the `style` prop (base-first, caller-last merge order). See `08-PATTERNS.md` §"`Card` has no `onPress`".

### D-06 — home/index.tsx inline-split question
`home/index.tsx` imports `FocusCard`/`ShiftMosaic`/`SignalChips` from `CompanionHome`, `SupervisorHome`, and `EngineerHome` (all already separate files) but defines `FrontDeskHomeScreen` (`:248`) and `GMHomeScreen` (`:300`) inline. **Recommendation: do NOT extract them** — there is no migration benefit; a pure in-place color swap is fully consistent with the "migration not rebuild" boundary. Extraction would add diff noise and risk changing the default-export/route shape (Pitfall 8). Only extract if a concrete migration blocker emerges (none found). [ASSUMED — planner has D-06 discretion]

### Anti-Pattern: touching `evening.tsx`'s shared composites
`StatusPill`, `StatusRail`, `ProgressBar`, `Chip`, `AIBriefingCard`, `SectionHeader` (in `evening.tsx`) are **out of scope** (Deferred section + Phase 8 precedent). Screens keep calling them unchanged; only screen-local `C.*` migrates. Do not "helpfully" migrate `evening.tsx`'s internals — that reopens Phase 8's deliberately-excluded surface and risks regressions on already-shipped screens (Room Board, Inspect) that also consume them.

## Runtime State Inventory

Phase 9 is a presentation-layer code migration with **no** rename/rebrand/data-migration component. For completeness against the five categories:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB keys, collection names, or user_ids are renamed. `copilot` reads/writes `AsyncStorage` key `@patelrep/copilot_history` — unchanged, do not touch. | None |
| Live service config | None — no external service config references screen code. | None |
| OS-registered state | None. | None |
| Secrets/env vars | None — no env var names change. | None |
| Build artifacts | None from this phase. **Verify at phase end:** a full EAS Android build (DARK-04 is Phase 10, but Phase 8's phase-gate ran a build; recommend the same smoke check) confirms no broken import. | Optional build smoke check |

**Nothing found in 4 of 5 categories — verified by grep (no rename operations in scope).**

## Common Pitfalls

### Pitfall 1 (highest risk this phase): `C` vs `theme` dual source, at 3× Phase 8's scale
712 `C.` references across 28 files is the largest burn-down in the milestone. **Definition of Done per task:** `grep -c "\bC\.[a-zA-Z]"` on the touched file returns 0 (except `evening.tsx`, deliberately out of scope). Do not accept "looks migrated." A partially-migrated file that ships is Pitfall 2 from `.planning/research/PITFALLS.md`.

### Pitfall 2: role-tab breakage during dashboard restructuring (`.planning/research/PITFALLS.md` Pitfall 8 — peaks here)
The home/dashboard family spans 5 role paths and 4 files with role-conditional rendering. A "styling-only" edit that accidentally changes a default-export shape, moves a file, or drops a role guard silently breaks one role's tab via `lib/navigation/roleTabs.ts` (string-matched, frozen). **Avoid:** no in-scope task renames/moves any file or touches `roleTabs.ts`. **Verify:** diff review confirms only `StyleSheet`/JSX-color/import lines changed — no route-identity, component-signature, or role-conditional changes.

### Pitfall 3: business logic mixed into `Alert.alert` handlers
`room-status`, `assignments`, `RoomDetailSheet`, `assets`, and `copilot` all embed real `api.*` calls in the same handler bodies as the alerts being converted. **Guidance:** each task action must say "change only the feedback call — do not alter preceding awaited API calls or early-return guards." (Carried verbatim from Phase 8's "New pitfall.")

### Pitfall 4: copilot's dark tokens silently breaking under `useTheme()`
Covered in Summary #2 / Open Questions #1. If copilot is migrated to `useTheme()` without adding `lightTheme.surfaceElevated`/`glass`/`glassBorder`, those colors resolve `undefined` at runtime — a broken screen, not a caught error. Do not migrate copilot's `darkTheme.*` refs blindly.

### Pitfall 5: EN/ES key parity in the i18n backlog
A new EN key without its ES counterpart falls back to English silently (no lint error). Cross-check every new key in both `apps/mobile/i18n/` locale files.

## State of the Art

No framework/library changes since Phase 8's research (dated 2026-07-29, one day prior). All primitives, hooks, and the `tokens.ts` shape are stable and were re-verified this session. No deprecated APIs in scope.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `copilot/index.tsx`'s dark aesthetic is **intentional** and should be preserved, not flipped to light-mode via `useTheme()`; SCREENS-08 for copilot means "route the 1 `C.` ref + Alert→Toast + Button/IconButton on the send/mic/confirm actions" while the chat surface stays dark. | Open Questions #1 | HIGH — if the user actually wants copilot light-mode, this needs new `lightTheme` keys (`surfaceElevated`/`glass`/`glassBorder`) + a visible redesign, which is net-new scope. Must confirm before planning SCREENS-08. |
| A2 | The roadmap's "22 raw literals" = 16 JSX-text + 6 placeholders. | i18n section | LOW — arithmetic (16+6=22) and file grep both confirm; if the intended 22 counts differently, the enforced gate DoD (16 text nodes) is unaffected. |
| A3 | `evening.tsx`'s `StatusPill`/`StatusRail`/`ProgressBar`/`Chip`/`AIBriefingCard`/`SectionHeader` stay out of scope; `evening.tsx` still importing `C` after Phase 9 does NOT violate success criterion #5 ("no *screen* imports C") because it is a shared-component file. | Summary #3 / Anti-Pattern | MEDIUM — if the user reads criterion #5 as "no *file* imports C", `evening.tsx` (and `atoms.tsx` if any C remains) would need inclusion; flag during plan review. |
| A4 | D-06: keep `FrontDeskHomeScreen`/`GMHomeScreen` inline (no extraction). | D-06 pattern | LOW — pure planner discretion; either reading satisfies the requirement. |
| A5 | Supervisor modals' hardcoded English strings (`BroadcastModal`, `ShiftNoteModal`) stay untranslated this phase (not in i18n gate `files` list, not in the 4-file backlog). | Census / Alert table | LOW — consistent with migration-not-rebuild; flag that `components/supervisor/**` is not yet i18n-gated if the user expects full-app coverage. |

## Open Questions

1. **How should `copilot/index.tsx` (SCREENS-08) be migrated given it renders an intentional dark AI aesthetic on `darkTheme.*` tokens?** [BLOCKING for SCREENS-08]
   - What we know: 1 `C.` ref (`C.alert` at :285), ~40 `darkTheme.*` refs (static import, `:19`), 6 `Alert.alert` (all→Toast). Uses `darkTheme.surfaceElevated`/`glass`/`glassBorder` which have no `lightTheme` equivalent. D-09 says "theme-wired in place, structure stays, only `C.*` route through `useTheme()`, Card not force-fit onto bubbles."
   - What's unclear: D-09 was written assuming copilot was a `C.*` screen like the others. It is not. "Route `C.*` through `useTheme()`" affects exactly 1 ref. The other ~40 dark refs have no clean light-mode target. Three readings: (a) keep the chat surface dark as designed, migrate only the 1 `C.` ref + Alert→Toast + wrap send/mic/confirm buttons in `Button`/`IconButton`; (b) add `lightTheme` equivalents for the 3 dark-only keys and flip the whole screen to light (visible redesign — violates "not rebuild"); (c) leave copilot mostly as-is and count SCREENS-08 satisfied by the primitive-button + Toast adoption only.
   - Recommendation: **(a)** — preserve the dark AI aesthetic (it's a deliberate design, mirrors web's AI surfaces), convert the 6 alerts to Toast, adopt `Button`/`IconButton` for the send/mic/quick-action/confirm-card controls, and route the single `C.alert` to `theme.status.dirty`. Surface this to the user during plan review; do not silently pick (b). `[ASSUMED]` — needs user confirmation.

2. **Should `copilot`'s `confirmCard` (`:201-242`) become a `Card` primitive?** D-09 forbids force-fitting `Card` onto chat *bubbles*, but the confirmCard is a genuine confirmation container (label + title + Create/Dismiss buttons), not a bubble. It is a reasonable `Card` + two `Button` target. Recommendation: yes for the confirmCard, no for the message bubbles — but this rides on Open Question #1's resolution. Planner should decide alongside #1.

3. **Does `MobileVisualTokens.test.ts` assert on `tokens.ts` shape?** Only matters if the planner adds `lightTheme` keys for the copilot light-mode path (Open Q#1 reading b). If copilot stays dark, `tokens.ts` is untouched and this is moot. Read the test before any `tokens.ts` edit. (Same caveat Phase 8 flagged.)

## Environment Availability

Skipped — Phase 9 is a code/config-only presentation migration with no new external tools, services, or runtimes. Existing toolchain (Node/npm, Jest/jest-expo, eslint, tsc) is already present and exercised by Phase 8. A full EAS Android build is a Phase-10 requirement (DARK-04) but recommended as an optional phase-end smoke check here.

## Validation Architecture

`workflow.nyquist_validation` is `true` [VERIFIED: `.planning/config.json:13`] — this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^29.7.0 + `jest-expo` ~54.0.0 + `@testing-library/react-native` ^12.9.0 |
| Config file | none dedicated; `jest-expo` preset (per `08-RESEARCH.md`, unchanged) |
| Quick run command | `cd apps/mobile && npx jest __tests__/screens/<Name>.test.tsx` |
| Full suite command | `cd apps/mobile && npm test` |

### Existing test coverage (confirmed via `ls __tests__/` this session)
Present and relevant: `ProfileHandoff.test.tsx` (SCREENS-01), `HousekeeperHome.test.tsx` + `EngineerHome.test.tsx` (SCREENS-02), `GuestRequestsList.test.tsx` (SCREENS-05), `RoomStatusList.test.tsx` (SCREENS-10), plus `MobileVisualTokens.test.ts` (token-shape guard). **No dedicated test** for: SupervisorHome, CompanionHome, assignments, scheduling, staff, all 7 supervisor files, assets, pm-schedules, guest-requests detail, lost-found, logbook (both), sop (both), copilot, alerts, notifications.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCREENS-01 | Profile renders via primitives, sign-out unchanged | component | `npx jest __tests__/screens/ProfileHandoff.test.tsx` | ✅ |
| SCREENS-02 | 5 dashboards render via primitives, role-gating unchanged | component | `npx jest __tests__/screens/HousekeeperHome.test.tsx __tests__/screens/EngineerHome.test.tsx` | ✅ (2 of 5; SupervisorHome/Companion/FrontDesk/GM ❌ Wave 0 optional) |
| SCREENS-03 | Supervisor screens + modals render via primitives | component | `npx jest __tests__/screens/` (assignments/scheduling/staff/supervisor) | ❌ Wave 0 optional |
| SCREENS-04 | Assets + PM schedules render via primitives | component | (assets/pm-schedules) | ❌ Wave 0 optional |
| SCREENS-05 | Guest-service renders via primitives | component | `npx jest __tests__/screens/GuestRequestsList.test.tsx` | ✅ (list; detail/lost-found ❌) |
| SCREENS-06 | Logbook renders via primitives | component | (logbook) | ❌ Wave 0 optional |
| SCREENS-07 | SOP renders via primitives | component | (sop) | ❌ Wave 0 optional |
| SCREENS-08 | Copilot renders via primitives, chat behavior unchanged | component | (copilot) | ❌ Wave 0 optional |
| SCREENS-09 | Alerts/Notifications render via primitives | component | (alerts/notifications) | ❌ Wave 0 optional |
| SCREENS-10 | Room Status renders via primitives, CreateWorkOrderModal integration intact (D-04) | component | `npx jest __tests__/screens/RoomStatusList.test.tsx` | ✅ (verify it targets room-status vs room-board) |

### Sampling Rate
- **Per task commit:** the touched screen's existing test (where present) + `npm run type-check` (`tsc --noEmit`) + `npm run lint` (the i18n gate — **now enforcing the 4 formerly-exempt files** once Wave 0 lands).
- **Per wave merge:** full `npm test` + `npm run type-check` + `npm run lint`.
- **Phase gate:** full suite green + a manual simulator/device pass per wave verifying no visual regression, offline banner still renders above any new Toast, and EN/ES both render without new truncation on the busiest screens (dashboards, assignments, room-status).

### Wave 0 Gaps
- [ ] i18n backlog (mandatory, not a test): remove 4 `ignores`, wire 16 text + 6 placeholder literals, add EN+ES keys, `npm run lint` green.
- [ ] Following Phase 8's precedent, **new per-screen test files are optional** — Phase 8 relied on existing tests + type-check + lint + manual pass rather than authoring a test per screen. Recommend the same: do not block the phase on writing ~18 new test files; add a smoke render test only where a screen has notably complex conditional rendering (dashboards, copilot) if the planner wants extra safety.
- [ ] Read `MobileVisualTokens.test.ts` before any `tokens.ts` edit (only if Open Q#1 resolves toward light-mode copilot).

## Security Domain

`security_enforcement` is not set in config → treated as enabled. Phase 9 is presentation-only per its explicit boundary — **no new attack surface**; the live risk is **regression**, identical in shape to Phase 8:

| Pattern | STRIDE | Standard Mitigation (must not regress) |
|---------|--------|---------------------|
| A "styling-only" diff drops a role check or `hotel_id`-scoped fetch inside a handler touched for its `Alert.alert`→`Toast` conversion (`room-status`, `assignments`, `RoomDetailSheet`, `assets`, `copilot`) | Elevation of Privilege / Information Disclosure | Diff review per task: only color/`Alert.alert`/`TouchableOpacity` lines change; any diff touching `api.*` args, a `require_role`-equivalent guard, or tenant scoping is out of scope |
| A modal's success-path side effect (navigate/close) silently dropped when converting a gating success alert to Toast (`BroadcastModal`, `ShiftNoteModal`) | UX/state-consistency regression | Locked pattern: fire `toast.success()` and the side effect together |
| Shipping unreviewed Spanish for safety-adjacent copy in the i18n backlog (the exemption comment's stated fear) | (Correctness/safety, not classic security) | Human review of new ES keys for the 4 files, especially work-order/issue copy |

No ASVS category (V2-V6) is newly applicable — RBAC (V4) and input validation (V5) live in untouched backend/API code. No new secrets, auth flows, or data-boundary code introduced.

## Sources

### Primary (HIGH confidence — direct repo reads/greps this session)
- `apps/mobile/components/shared/tokens.ts` — full read; confirmed Phase 8's Wave-0 keys present, and the `surfaceElevated`/`glass`/`glassBorder` dark-only gap
- `apps/mobile/app/(app)/copilot/index.tsx` — full read; the `darkTheme.*` anomaly + 6-alert classification
- `apps/mobile/app/(app)/room-status/index.tsx` — full read; D-04 integration point, 5-alert classification, `Pressable`-wraps-`Card` targets
- `apps/mobile/eslint.config.mjs` — full read; exact `ignores` block + `markupOnly` gate behavior
- eslint probe (ignores removed) — verified the 16 gate-enforced JSX-text violations
- grep census across all 28 in-scope files: `C.` counts, `Alert.alert` sites (with surrounding context read for classification), `useTheme`/`TouchableOpacity`/`t(` counts, `shellTokens`/`evening` import map, placeholder literals, home-family coupling
- `ls __tests__/` — existing coverage inventory; `.planning/config.json` — nyquist flag

### Secondary (read this session, HIGH confidence — prior-phase authoritative docs)
- `.planning/phases/08-floor-role-rollout/08-PATTERNS.md` + `08-RESEARCH.md` — the reusable `C→theme` map, Alert→Toast rule, `Pressable`-wraps-`Card` pattern, primitive prop signatures (cited, not re-derived)
- `.planning/phases/09-remaining-screens-rollout/09-CONTEXT.md` — D-01..D-10 + canonical refs
- `.planning/REQUIREMENTS.md` — SCREENS-01..10 full text

## Metadata

**Confidence breakdown:**
- Standard stack / no-new-deps: HIGH — inherited from Phase 8, re-confirmed no new imports needed
- `C.`/`Alert.alert` census + classification: HIGH — every count is a grep this session; every alert read with surrounding code
- `C→theme` mapping + token-gap status: HIGH — direct `tokens.ts` read, Phase 8's gap confirmed fixed
- i18n backlog reconciliation (16+6=22): HIGH — eslint probe + placeholder grep
- copilot dark-theme handling: MEDIUM — the *facts* are HIGH (verified), but the *intended resolution* is genuinely a user decision, flagged ASSUMED (A1)
- evening.tsx scope reading: MEDIUM — Phase 8 precedent + Deferred section support it, but criterion #5's "screen" wording is the planner's to confirm (A3)

**Research date:** 2026-07-30
**Valid until:** ~14 days (stable internal codebase; re-verify `C.` counts and Alert line numbers if any in-scope file is edited out-of-band before planning completes)
