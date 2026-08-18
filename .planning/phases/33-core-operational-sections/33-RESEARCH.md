# Phase 33: Core Operational Sections - Research

**Researched:** 2026-08-17
**Domain:** Next.js 14 App Router — additive visual-chrome restyle of 9 operational sections behind the Phase-30 `web_redesign_sections` feature flag. Frontend-only, zero behavior/data/RBAC change.
**Confidence:** HIGH (all findings are direct codebase reads of the actual section files; no external library research needed — this phase consumes only what Phase 30-32 already built)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary — presentation only, zero behavior change.** Redesign the visual chrome (page shell, loading/empty/error states, general presentation) of 9 operational sections onto the Phase-30 token/variant system, matching Phase 31 (shell) and Phase 32 (dashboard homes). In scope: Tasks, SOP Library, Logbook, Guest Requests, Lost & Found, Safety, Evidence, Programs, Scheduling (SEC-01a). No behavior/data/RBAC change. User delegated all implementation decisions to Claude — proceed autonomously through discuss/plan without check-ins.

**Empty/loading/error states are first-class scope (Success Criterion #2).** Each section's empty, loading, AND error states must be redesigned, not just the happy path. Most sections don't yet use the shared `StateBlock` consistently — migrating them is a real, non-trivial part of the phase.

**Flag mechanism — 9 keys, one per section (NOT one shared key).** `isSectionRedesigned(sectionKey: string, hotel)` takes a plain string; `web_redesign_sections` is typed `string[]` everywhere. No type extension needed. Register 9 new keys, casing-consistent with the existing `'shell'`/`'dashboard'` single-word precedent:
- Single word, lowercase: `'tasks'`, `'sop'`, `'logbook'`, `'safety'`, `'evidence'`, `'programs'`, `'scheduling'`
- camelCase for the two multi-word domains: `'guestRequests'`, `'lostFound'`

**StateBlock adoption — target end state for all 9 sections.** Every section ends this phase using the shared `StateBlock` (loading/empty/error) consistently, modeled on **Evidence's existing implementation** (real `status` branching, `onRetry` wired to the same refetch/reload the page already has, `t()`-wrapped messages, no bespoke skeleton/empty component reinvented). No new state-presentation component — 100% consumption of Phase 30-32 infrastructure.

**i18n cleanup scope — fix hardcoded strings inside touched states; don't do an exhaustive audit.** Any hardcoded English literal found *inside a state this phase is already touching* (loading/empty/error, and the chrome around it) must be converted to an i18n key in both `en.ts`/`es.ts` — in-scope cleanup, not scope creep, since the phase rebuilds that JSX anyway. Explicitly includes Scheduling's hardcoded strings passed as `StateBlock`/`EmptyState` object-literal props, and Safety's `MANAGER_TABS` module-level tab-label array (tabs are a `PageHeader` chrome prop). Hardcoded strings entirely outside touched states (e.g. deep create-form field labels) are lower priority — fix opportunistically if trivial; flag large remaining pockets (e.g. `SafetyPrograms.tsx` form-validation strings) as deferred rather than expanding scope.

**Guest Requests needs net-new chrome, not a restyle.** It has zero shared chrome today (no `PageHeader`, no `StateBlock`). Add `PageHeader` (title + the existing Active/History tabs via `PageHeader`'s `tabs` prop) then `StateBlock` for the kanban columns' loading/empty states — same visual family as the other 8, but written from scratch rather than migrated.

**Lost & Found / `LogFoundItemModal` — additive-only.** The page chrome around the modal redesigns freely. The modal itself (`LogFoundItemModal.tsx`, Phase-30 frozen, hash-pinned) may only *gain* new variants/props if genuinely needed — never mutate an existing prop/variant, because `RoomDetailDrawer` (frozen, excluded Room-Board surface) depends on its current behavior. A genuine hash bump must go through `frozen-files-allowlist.json` with justification. The Room-Board regression gate must still pass (Success Criterion #4).

### Claude's Discretion
- Exact `StateBlock` prop values (loadingLabel text, empty icon, error retry wiring) per section — follow Evidence's pattern, adapt copy per domain.
- Whether Safety's 4 sub-components share one `'safety'` flag check at parent `page.tsx` level or each reads independently — whichever composes cleaner given `ComplianceDashboard` already has partial `StateBlock` wiring.
- Whether Programs' 3 sub-panels each get their own error-state wiring or share one parent-level boundary — match how their data-fetching is actually structured.
- Exact card/grid/spacing values within the v2 token system, motion/transition timing (use existing `--motion-*`/`--ease-*` tokens).
- Plan wave grouping / how the 9 sections split across parallel plans — planner's call, informed by which sections share files (none do) and which are largest.

### Deferred Ideas (OUT OF SCOPE)
- Full exhaustive i18n literal-string audit across all 9 sections beyond what the loading/empty/error redesign touches (e.g. `SafetyPrograms.tsx` form-validation strings, create-form field labels) — flag remaining pockets in the close-out summary for a future cleanup pass.
- Any new capability for these 9 sections (new filters, fields, endpoints) — presentation-only per ROADMAP.
</user_constraints>

## Summary

Phase 33 is a **frontend-only additive restyle** of 9 operational sections, each gated behind its own new `web_redesign_sections` key. It is structurally identical to Phase 32 (which restyled the 6 dashboard homes behind one `'dashboard'` key) — the same `isSectionRedesigned` flag read, the same `StateBlock` empty/error contract, the same frozen-file discipline, the same `en.ts`/`es.ts` parity gate. Nothing new needs to be built; every primitive (`PageHeader`, `StateBlock`, `EmptyState`, `RedesignGate`) already exists and already has a proven consumer.

The real work is uneven across the 9 and concentrated in two places: **(1) migrating each section's ad-hoc loading/empty/error rendering to `StateBlock`** — and, critically, **adding error states that don't exist yet** (several sections use react-query but only destructure `isLoading`, never `isError`/`refetch`, so no error branch renders today); and **(2) i18n**: four sections (SOP, Logbook, Lost & Found, Scheduling) have **no i18n namespace at all** and are almost entirely hardcoded English, while Guest Requests has a namespace that covers only its create-form, not the kanban page. Tasks and Evidence are already clean (81 and 74 `t()` calls, 0 raw) and Evidence is the reference implementation for the target end-state.

**Two factual corrections to CONTEXT.md, both verified against source:** (a) **Programs DOES have a page-level error state today** — `programs/page.tsx:51` reads `overview.isError` and renders a `loadError` card; it is ad-hoc (not `StateBlock`) and the *sub-panels* don't read `isError`, but the "add a real error state where none exists" framing is slightly off — the query already exposes `isError`/`refetch`, so wiring is trivial, not net-new. (b) The recurring true gap across sections is not "no error handling possible" but "**error state available from react-query but never read**" — Tasks, Guest Requests, and Lost & Found all destructure only `{ data, isLoading }`; adding `isError, refetch` to the existing destructure and rendering `StateBlock status='error'` is zero-data-change (it reads state the query already produces).

**Primary recommendation:** Follow the Phase-32 plan shape exactly — one wave-1 i18n-foundation plan that adds ALL locale keys for all 9 sections to `en.ts`/`es.ts` atomically (avoids parallel locale-file merge conflicts and keeps `check:i18n-parity` green), then N parallel wave-2 content plans grouped by effort (isolating the giant Scheduling file and the frozen-modal Lost & Found), then a wave-3 close-out verification plan. Per-section, read the flag with the Phase-32 direct-read pattern (`isSectionRedesigned('<key>', useHotelStore(s=>s.hotel))`) inside the real page component, branch legacy-unchanged vs v2, and wire `StateBlock` for all three states with `onRetry` pointed at whatever refetch/reload mechanism that section already has.

## Standard Stack

No new dependencies. Everything below already exists in-repo and already has a Phase-31/32 consumer.

### Core (consume as-is — do not modify)
| Component | File | Purpose | Notes |
|-----------|------|---------|-------|
| `isSectionRedesigned` | `lib/utils/redesignFlag.ts` | `(sectionKey: string, hotel) => hotel?.web_redesign_sections?.includes(sectionKey) ?? false` | Free-form string key; no registry, no type union |
| `RedesignGate` | `components/shared/RedesignGate.tsx` | `<RedesignGate section=… v2=… legacy=… />` declarative swap; reads `useHotelStore(s=>s.hotel)` internally | Optional — use if a whole-page v2/legacy swap is cleaner than an internal branch |
| `StateBlock` | `components/ui/StateBlock.tsx` | `status?: 'loading'\|'empty'\|'error'\|null`, `loadingLabel`, `empty: EmptyStateProps`, `error: { message?, onRetry? }`, `children` | `status` null/omitted → renders `children`. Built-in i18n defaults: `common.loading`/`common.error`/`common.retry`/`common.noResults` |
| `EmptyState` | `components/ui/EmptyState.tsx` | `icon?`, `title`, `body?`, `action?` | `StateBlock status='empty'` delegates here |
| `PageHeader` | `components/shared/PageHeader.tsx` | `eyebrow`/`title`/`subtitle`/`meta`/`actions`/`tabs`; auto-swaps to `Breadcrumbs` on sub-routes | Already in 8/9 sections; only Guest Requests lacks it |

### ⚠️ StateBlock's `loading` status is a SPINNER, not a skeleton
`StateBlock status='loading'` renders a `Loader2` spinner + `common.loading` text (verified `StateBlock.tsx:23-30`). Phase 32 established that the "skeleton not spinner" convention means: **use `StateBlock` for `empty` and `error`, and keep/build inline skeleton cards for `loading`.** Every in-scope section already has an inline `animate-pulse` skeleton (Tasks `h-[42px]` rows, SOP/Logbook/Lost&Found local `SkeletonCard()`, Guest Requests column pulses, Scheduling row pulses) — restyle those skeletons to the v2 card shell; do NOT route card loading through `StateBlock status='loading'`. Evidence (the reference) does pass `status='loading'` for its spinner — that's fine where a spinner is acceptable, but match each section's existing loading affordance to avoid layout shift and honor the convention.

**Installation:** none.

## Current State Per Section (verified file reads, 2026-08-17)

All 9 route pages live at `apps/web/app/(dashboard)/<section>/page.tsx`. Line counts and structure:

| # | Section | Route file (LOC) | Sub-component files | PageHeader | StateBlock today | Data layer | Retry mechanism available | i18n namespace |
|---|---------|------------------|---------------------|------------|------------------|------------|---------------------------|----------------|
| 1 | Tasks | `tasks/page.tsx` (738) | — (single file) | ✅ | ❌ (inline skeleton + inline empty; **no error branch**) | react-query `{data,isLoading}` | add `isError,refetch` to existing query | ✅ `tasks:` clean (81 `t()`, 0 raw) |
| 2 | SOP | `sop/page.tsx` (552) | — | ✅ | ❌ (local `SkeletonCard()`/`EmptyState()` shadow shared; inline `fetchError`) | manual `useState`+`fetchDocuments(silent)` | `onRetry: () => fetchDocuments()` (callable already exists, `sop/page.tsx:~365`) | ❌ **no namespace** (1 `t()`, mostly raw) |
| 3 | Logbook | `logbook/page.tsx` (911) | — | ✅ | ❌ (local `SkeletonCard()`; hardcoded validation errors) | react-query `{data:entries,isLoading}` | add `isError,refetch` | ❌ **no namespace** (5 `t()`) |
| 4 | Guest Requests | `guest-requests/page.tsx` (10, thin `<Suspense>` wrapper) → `components/guest-requests/GuestRequestsPage.tsx` (316) + `GuestRequestDrawer.tsx` (429), `HistoryTab.tsx` (106), `NewRequestModal.tsx` (275) | 4 files | ❌ **none** (raw `<h1>` header + raw tab buttons) | ❌ (column pulses + `"No requests"` text; **no error branch**) | react-query `{data,isLoading}` | add `isError,refetch` | ⚠️ `guestRequests:` exists but covers **only** `NewRequestModal` form — kanban strings all raw |
| 5 | Lost & Found | `lost-found/page.tsx` (622) | — (imports frozen `LogFoundItemModal`) | ✅ | ⚠️ uses `EmptyState` directly (hardcoded titles); local `SkeletonCard()`; **no error branch** | react-query `{data:items,isLoading}` | add `isError,refetch` | ❌ **no namespace** (1 `t()`) |
| 6 | Safety | `safety/page.tsx` (83) | `components/safety/`: `ComplianceDashboard.tsx` (132), `IncidentReview.tsx` (99), `SafetyInformation.tsx` (105), `SafetyPrograms.tsx` (131) | ✅ (parent) | ⚠️ only `ComplianceDashboard` uses `StateBlock`; others manual loading/error w/ hardcoded `"Unable to load…"` | manual `useState`+`load()` callbacks (each sub-component) | `onRetry: () => void load()` (callable exists per sub-component) | ✅ `safety:` (9 `t()` in page; `MANAGER_TABS` labels raw; sub-panels partly raw) |
| 7 | Evidence | `evidence/page.tsx` (540) | — | ✅ | ✅ **fully wired — reference impl** (`evidence/page.tsx:512-516`: `status`/`loadingLabel`/`error.onRetry`/`empty.title`) | manual `useState`+`load()` | `onRetry: () => void load()` (already wired) | ✅ `evidence:` clean (74 `t()`, 0 raw) |
| 8 | Programs | `programs/page.tsx` (85) | `components/programs/`: `HousekeepingDepthPanels.tsx` (245), `DeepCleanAreasPanel.tsx` (237), `InspectionDepthPanel.tsx` (183) | ✅ (parent) | ❌ ad-hoc `loadError` Card at page level (`programs/page.tsx:51`); sub-panels guard empty on `!isLoading` only | react-query `overview` (shared `OVERVIEW_KEY`) — **`isError`/`isLoading`/`refetch` already read at page level** | `onRetry: () => overview.refetch()` (already used for the refresh button) | ✅ `programs:` (12 `t()`; sub-panels partly raw) |
| 9 | Scheduling | `scheduling/page.tsx` (1388) | — (largest) | ✅ | ⚠️ partially wired (`scheduling/page.tsx:158`, `705`, `1032`, `1141`) but **strings hardcoded as object-literal props** (`error={{message:'Failed to load roster.',…}}`, `EmptyState title="No shifts defined yet…"`) | react-query multiple (`rosterQuery`, `assignmentsQuery`, `staffQuery`) | `onRetry: () => query.refetch()` (already used) | ❌ **no namespace** (2 `t()`; 13+ raw incl. hidden object-literal props) |

### Cross-section file sharing — VERIFIED NONE
Grepped every sub-component importer. Confirmed:
- **No section imports another in-scope section's component.** Guest Requests' 4 files are imported only within Guest Requests; Safety's 4 sub-components only by `safety/page.tsx`; Programs' 3 panels only within Programs (they cross-import *each other* — `HousekeepingDepthPanels` ⇄ `DeepCleanAreasPanel` ⇄ `InspectionDepthPanel` — so all 3 must live in one plan, but that circle is fully contained inside Programs).
- **This makes high wave-parallelism safe** — the only shared files any two plans would both touch are `en.ts`/`es.ts` (locale) and the frozen manifest (read-only). See wave-grouping recommendation.

### Frozen-primitive imports — VERIFIED, only Lost & Found
Grepped all 9 sections + sub-components for `RoomStatusBoard`/`RoomDetailDrawer`/`EngineeringRoomBoard`/`RoomCard`/`LogFoundItemModal`. **Only hit:** `lost-found/page.tsx:23` imports `LogFoundItemModal` (frozen). No other in-scope section imports any frozen Room-Board file. Note the sections DO freely import `Button`, `Card`, `Pill`, `StatusDot` etc. from `components/ui/` — `Button.tsx` and `primitives.tsx` are frozen and must be imported-not-edited, but importing them is allowed and normal (Phase 32 did the same). The frozen constraint bites only if a plan tries to *edit* one of those files.

## Architecture Patterns (prescriptive for the planner)

### Pattern 1: Flag read + branch — single-file pages (Tasks, SOP, Logbook, Lost & Found, Evidence, Scheduling, and Guest Requests' `GuestRequestsPage`)
Direct read inside the real page component (Phase-32 pattern, verified in every `components/dashboard/*Dashboard.tsx`):
```tsx
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
// …
const hotel = useHotelStore((s) => s.hotel)
const v2 = isSectionRedesigned('tasks', hotel)   // key per section
// legacy JSX unchanged when !v2; v2 JSX = new tokens + StateBlock states
```
The legacy branch must stay byte-behaviorally identical (flag off = today's UI), exactly as Phase 31/32 kept legacy branches untouched. For Guest Requests, the flag read goes in `GuestRequestsPage.tsx` (the real component), NOT the 10-line `page.tsx` Suspense wrapper.

### Pattern 2: Flag read for split sections with sub-components (Safety, Programs) — RECOMMENDATION
Both have a thin parent `page.tsx` (83 / 85 LOC) that owns the `PageHeader` + tabs/metrics and mounts tightly-coupled sub-components sharing one route and (for Programs) one cached query. **Recommend: read the flag ONCE in the parent `page.tsx` and thread a `redesigned` boolean prop down to the sub-components** (Phase-31 "pattern 1: prop-threaded `redesigned`"). Rationale:
- Safety's 4 panels + Programs' 3 panels are one conceptual surface reachable only via their parent — threading avoids 4-5 duplicate `useHotelStore` reads and keeps the flag decision in one place.
- Programs' 3 panels share `OVERVIEW_KEY` — one flag decision matches one query.
- Alternative (each sub-component reads the flag itself, Phase-32 style) is also acceptable and CONTEXT explicitly leaves this to discretion; prop-threading is simply cleaner here. Either is correct — pick one per section and be consistent within that section.

### Pattern 3: StateBlock wiring per section — the core mechanical change
Model on Evidence (`evidence/page.tsx:512-516`), the verified reference:
```tsx
<StateBlock
  status={loading ? 'loading' : error ? 'error' : items.length === 0 ? 'empty' : null}
  loadingLabel={t('common.loading')}
  error={{ message: t('<section>.loadError'), onRetry: () => refetchOrReload() }}
  empty={{ title: t('<section>.empty.title'), body: t('<section>.empty.body') }}
>
  {/* data-present children */}
</StateBlock>
```
**`onRetry` wiring differs by data layer (verified per section):**
- **react-query sections** (Tasks, Logbook, Guest Requests, Lost & Found, Programs, Scheduling): `onRetry: () => refetch()`. For Tasks/Logbook/Guest Requests/Lost & Found, **first add `isError, refetch` to the existing `useQuery` destructure** — they currently take only `{ data, isLoading }`, which is exactly why no error state renders today. This is zero-data-change: `isError`/`refetch` are already produced by the query.
- **manual `useState`+`useEffect` sections** (SOP, Safety, Evidence): `onRetry: () => void load()` where `load`/`fetchDocuments` is the callable the component already defines. SOP's is `fetchDocuments()` (`sop/page.tsx:~365`); Evidence's is `load()` (already wired); Safety's sub-components each have `load()`.
- **Per the skeleton convention:** keep the existing inline `animate-pulse` skeleton for the `loading` state (restyled to v2), OR pass `status='loading'` only where a spinner is acceptable. Don't introduce layout shift.

### Pattern 4: Guest Requests net-new chrome
`GuestRequestsPage.tsx` currently renders a raw `<div>` header (`<h1>Guest Requests</h1>` + subtitle) and raw `<button>` tabs (`guest-requests/GuestRequestsPage.tsx:220-249`). Replace with `<PageHeader title={t('guestRequests.pageTitle')} subtitle={…} tabs={[{label:t('guestRequests.tabActive'), active, onClick}, {label:t('guestRequests.tabHistory'), …}]} actions={<Button …>New Request</Button>} />`. Then migrate the per-column `"No requests"` text (`:274`) to `StateBlock status='empty'` and add an error branch (`isError` from the existing query). The 3 kanban column labels (`Open`/`Acknowledged`/`Verify Resolution` in the `COLUMNS` array `:39-62`), the card action buttons (`Acknowledge`/`Dispatch`/`Arrived`/`Contacted`/`Resolve`/`Verify`), `URGENT`, `SLA overdue`, and `timeAgo` suffixes (`m ago`/`h ago`/`d ago`) are all raw and inside touched chrome → i18n them.

### Anti-patterns to avoid
- **Don't** route card loading through `StateBlock status='loading'` (spinner) where the section uses skeletons — violates the skeleton-not-spinner convention.
- **Don't** edit any frozen file (`Button.tsx`, `primitives.tsx`, `RoomCard.tsx`, `LogFoundItemModal.tsx`, the two boards). Importing them is fine; editing re-triggers the Room-Board pixel-diff gate or fails `check:frozen-files`.
- **Don't** re-tint the six room-status tokens (`--alert`/`--info`/`--ready`/`--progress`/`--caution`/`--blocked`) for generic chrome — add a new `*-v2` token if a different tint is needed. Guest Requests' column headers use `--info`/`--caution`/`--ready` for status meaning — keep them.
- **Don't** add or remove any query, mutation, filter, or field — presentation only. Adding `isError`/`refetch` to an *existing* query destructure is allowed (reads existing state); adding a *new* query is not.
- **Don't** change the legacy branch — flag-off must equal today's UI byte-for-byte behavior.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Loading spinner / empty / error panel | New per-section skeleton or empty component (SOP/Logbook/Lost&Found already did this and it's the anti-pattern being removed) | `StateBlock` + `EmptyState` | Phase 30-32 already built + i18n'd these; local copies shadow the shared component and drift |
| Page header + tabs (Guest Requests) | Raw `<h1>`/`<button>` header | `PageHeader` with `tabs` prop | Consistent chrome, breadcrumb auto-swap, already used by 8/9 sections |
| Feature-flag branching | New context/env check | `isSectionRedesigned` / `RedesignGate` | The whole milestone runs on this one utility |
| Retry affordance | Custom retry button | `StateBlock error.onRetry` (renders `common.retry` Button) | Already styled, i18n'd, and points at the query's own refetch |

**Key insight:** This phase adds *zero* infrastructure. If a plan finds itself writing a new skeleton/empty/error component, it's doing it wrong — the correct move is deleting the local one and calling `StateBlock`.

## Common Pitfalls

### Pitfall 1: "Add an error state" when the query never exposed one to the UI
**What goes wrong:** Tasks/Guest Requests/Lost & Found use react-query but destructure only `{ data, isLoading }`, so today an API failure renders as an empty list, not an error. A naive "restyle the error state" reads as "there's nothing to restyle."
**How to avoid:** Add `isError, refetch` to the existing destructure and render `StateBlock status='error'`. This is the literal meaning of Success Criterion #2 for these sections. Verify it's zero-data-change (you're reading state the query already computes).
**Warning sign:** A section's `useQuery` call with no `isError` in scope.

### Pitfall 2: Hidden hardcoded strings inside object-literal props (Scheduling)
**What goes wrong:** Scheduling *looks* i18n-partially-done because it uses `StateBlock`, but the copy is hardcoded English inside props: `error={{ message: 'Failed to load roster.' }}`, `EmptyState title="No shifts defined yet…"`, `title="Staff Scheduling"` (`scheduling/page.tsx:159-160, 705, 1032, 1141, 1297-1298`). A JSX-text grep misses these.
**How to avoid:** Grep for `title=`/`message=`/`subtitle=` string literals, not just `>text<`. CONTEXT explicitly flags this as in-scope.

### Pitfall 3: Safety's tab labels are a module-level array
**What goes wrong:** `MANAGER_TABS` (`safety/page.tsx:18-23`) holds `{id, label}` with hardcoded English labels, defined at module scope, then mapped into `PageHeader tabs`. Because it's outside the component, `t()` can't be called there directly.
**How to avoid:** Move the label resolution inside the component (`tabs={MANAGER_TABS.map(x => ({ label: t(\`safety.tabs.${x.id}\`), … }))}`) or make `MANAGER_TABS` hold i18n keys. Tabs are a `PageHeader` chrome prop → in scope.

### Pitfall 4: Four sections have NO i18n namespace
**What goes wrong:** SOP, Logbook, Lost & Found, Scheduling have no top-level key in `en.ts`/`es.ts` (only `nav.*` labels like `nav.sopLibrary` exist). Adding scattered keys under wrong namespaces, or to only one locale, breaks `check:i18n-parity`.
**How to avoid:** Create four new sibling blocks (`sop:`, `logbook:`, `lostFound:`, `scheduling:`) in BOTH files in the same edit. See i18n contract.

### Pitfall 5: Lost & Found frozen-modal temptation
**What goes wrong:** Redesigning the L&F page might tempt a tweak to `LogFoundItemModal` (e.g. a v2 variant). Any byte change fails `check:frozen-files` and, if it renders differently, the Room-Board regression gate (RoomDetailDrawer uses the same modal).
**How to avoid:** Restyle only the page chrome *around* the modal. If a new variant is genuinely required, bump the hash in `frozen-files.json` AND add a reasoned entry to `frozen-files-allowlist.json` in the same change (mechanism verified below). Default expectation: **the modal is untouched and the allowlist stays empty.**

## i18n Contract (verified)

- Files: `apps/web/i18n/locales/en.ts` and `es.ts` — plain nested TS objects, currently **1482 lines each, identical length** (parity is clean today). `en` starts `const en = {`.
- **Namespaces present:** `common`, `programs` (line 178), `evidence` (958), `safety` (962), `tasks` (1325), `guestRequests` (1455). **Absent (must be created):** `sop`, `logbook`, `lostFound`, `scheduling`.
- **`guestRequests` is partial:** it covers `NewRequestModal` form fields only (`newRequest`, `roomNumber`, `priority…`, `createRequest`, etc., `en.ts:1455-1481`). The kanban page strings (page title/subtitle, Active/History tabs, column labels, card action buttons, `URGENT`, `No requests`, time-ago suffixes) are NOT present → extend this block.
- **Shared state copy already in `common.*`:** `loading`, `noResults` ("Nothing here yet"), `error`, `retry`. Reuse for generic states; add section-specific empty/error copy per namespace.
- **Rough i18n effort per section** (new keys to add, both locales):
  - Tasks — minimal (add error-state key; empty already `tasks.empty.*`)
  - Evidence — minimal (add error key if not present; reference impl)
  - Programs — small (extend; `programs.loadError` exists; sub-panel empties)
  - Safety — small-medium (`safety.tabs.*`, sub-panel `loadError`s replacing hardcoded `"Unable to load…"`)
  - Guest Requests — medium (extend block with ~15-20 kanban/card keys)
  - SOP — medium (new namespace: header, skeleton/empty copy, `loadError`, upload-modal copy if touched)
  - Logbook — medium (new namespace: header, empty, `loadError`, validation strings if touched)
  - Lost & Found — medium (new namespace: header, empty titles/bodies, `loadError`)
  - Scheduling — medium-large (new namespace: page title/subtitle + all the hidden object-literal-prop strings)
- **Gate:** `npm run check:i18n-parity` (`scripts/check-i18n-parity.mjs`) + `verify:i18n-gate`. Every `en` key needs an `es` counterpart or CI fails.

## Frozen-File Mechanics (verified)

- **Manifest:** `apps/web/frozen-files.json`. Two freeze classes: `files` (NAME-freeze, sha256 of full bytes) and `room_status_values` (VALUE-freeze, no allowlist escape).
- **LogFoundItemModal current hash:** `649c9516cb9961483fa0e6cebf1b783cce3a8e5670f26b801ed9ef26130a656c` (`frozen-files.json:7`).
- **Allowlist:** `apps/web/frozen-files-allowlist.json` exists, `entries: []` (empty). To legitimately change a frozen `files` entry: bump its hash in `frozen-files.json` AND add `{ file, new_hash, reason, approved }` to the allowlist `entries` in the same PR. The allowlist does **not** apply to `room_status_values` (hard failure, no escape).
- **Guard:** `npm run check:frozen-files` (`scripts/check-frozen-files.mjs`).
- **Expectation for Phase 33:** no frozen file is edited; allowlist stays empty; the modal is untouched.

## Verification Gates (run before declaring any task done)

```bash
cd apps/web
npm run type-check            # tsc --noEmit
npm run check:frozen-files    # frozen manifest guard (must stay green — no frozen edits expected)
npm run check:contrast        # dark-mode WCAG AA contrast gate (every new token/variant pairing)
npm run check:i18n-parity     # en/es key parity (every new key in both locales)
npm run verify:i18n-gate      # i18n gate
npm run build                 # Next.js build (Phase 31/32 gated each task on this)
npm run test:e2e:regression   # Room-Board baseline pixel-diff (Success Criterion #4 safety net)
```
Plus the mandatory Self-Verification Policy (CLAUDE.md): run `npm run dev:web`/`dev:api`, log in (GM test account in memory), toggle the new section flag(s) on for the test hotel (add the key string to `web_redesign_sections` via `PATCH /v1/hotels/{id}` or directly in Supabase — there is no settings-UI toggle), and click through each redesigned section in the browser (light + dark, EN + ES) confirming empty/loading/error render. The network-diff requirement (same-inputs→same-outputs, Success Criterion #3) is satisfied structurally by not touching any query/mutation — spot-check the Network tab shows identical requests flag-on vs flag-off.

## Recommended Wave / Plan Grouping

**Follow the proven Phase-32 shape** (1 foundation plan → parallel content plans → 1 close-out), adapted for 9 independent sections and one shared-file risk (the locale files).

**Why a wave-1 i18n foundation plan (strongly recommended):** the ONLY files multiple parallel content plans would both write are `en.ts`/`es.ts`. Nine sections editing two shared files in parallel = merge conflicts + parity-gate flakiness. Phase 32 solved this by adding all locale keys first in one plan. Do the same: **wave-1 plan adds the 4 new namespaces (`sop`, `logbook`, `lostFound`, `scheduling`) and extends the 5 existing ones (`guestRequests`, `safety`, `programs`, `tasks`, `evidence`) in both `en.ts`/`es.ts`, atomically.** Content plans then only *consume* keys — zero locale-file writes in wave 2, so they run truly parallel with no shared-file contention.

**Wave-2 content plans — grouped by effort, not alphabetically.** Effort ≈ LOC + i18n dirtiness + net-new work. Isolate the two risk/size outliers (Scheduling = 1388 LOC largest; Lost & Found = only frozen-modal importer). Recommended 5 content plans:

| Plan | Sections | Rationale |
|------|----------|-----------|
| 33-02 | **Tasks + Evidence** | Both already clean/near-done — Tasks needs only an error branch + skeleton restyle; Evidence is the reference impl needing only token polish. A fast "known-good" plan that also produces the canonical StateBlock example other plans mirror. |
| 33-03 | **SOP + Logbook** | Both single-file, both new namespaces, both have local `SkeletonCard()`/`EmptyState()` to delete in favor of shared. Similar shape → one plan. |
| 33-04 | **Guest Requests + Lost & Found** | Guest Requests = heaviest net-new (PageHeader from scratch, 4 files, ~20 new keys). Lost & Found = the sole frozen-modal importer (isolate the `LogFoundItemModal` freeze discipline + regression-gate risk into one plan). |
| 33-05 | **Safety + Programs** | Both are parent-`page.tsx` + tightly-coupled sub-components (Safety 4, Programs 3 with a circular import). Share the "flag-thread-to-subpanels" Pattern 2 → same reviewer mental model. |
| 33-06 | **Scheduling** | 1388 LOC, largest single file, multiple queries, hidden object-literal-prop i18n. Big enough to own a plan. |

**Wave-3:** **33-07 close-out verification** — run the full gate suite across the combined wave-2 changes, re-pass the Room-Board regression harness (these changes must be inert to it), do the live flag-on/flag-off + EN/ES + light/dark browser walkthrough per section, and write the close-out summary flagging any deferred i18n pockets (per CONTEXT deferred list).

**Total: 7 plans** (1 i18n + 5 content + 1 close-out) vs Phase 32's 6. One extra is justified by 9 sections (vs 6 homes) and the Scheduling/L&F outliers.

**Alternative (fewer plans):** fold Scheduling into 33-05 or pair L&F with Safety/Programs to drop to 4 content plans (6 total). Not recommended — it unbalances effort and mixes the frozen-modal risk with unrelated work. The 5-content split keeps each plan reviewable and risk-isolated.

**Dependency graph:** `33-02..33-06` all `depends_on: [33-01]` (need the keys), all mutually parallel (no shared files — verified). `33-07 depends_on: [33-02, 33-03, 33-04, 33-05, 33-06]`.

## Open Questions

1. **Safety/Programs flag threading vs per-panel read.** Recommend prop-thread from parent `page.tsx` (Pattern 2); CONTEXT leaves to discretion. LOW risk — both work; pick one and be consistent per section.
2. **Does any section's loading skeleton need `status='loading'` spinner instead?** Evidence uses the spinner and it's acceptable there. Per section, keep the existing skeleton unless it was a spinner already. LOW — cosmetic, follow existing affordance.
3. **Guest Requests `refetchInterval: 30_000` polling** (`GuestRequestsPage.tsx:171`) — leave untouched (behavior). Just ensure the error state doesn't disrupt the poll. LOW.
4. **Wave-1 author needs all copy upfront.** The i18n foundation plan must enumerate every new key before content plans run. Mitigate by having it list keys per section with English + Spanish values, derived from the current hardcoded strings (which this research has already located per section). MEDIUM effort, LOW risk — the strings already exist in code to copy from.

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-08-17)
- All 9 route files: `apps/web/app/(dashboard)/{tasks,sop,logbook,guest-requests,lost-found,safety,evidence,programs,scheduling}/page.tsx`
- Sub-components: `components/guest-requests/{GuestRequestsPage,GuestRequestDrawer,HistoryTab,NewRequestModal}.tsx`, `components/safety/{ComplianceDashboard,IncidentReview,SafetyInformation,SafetyPrograms}.tsx`, `components/programs/{HousekeepingDepthPanels,DeepCleanAreasPanel,InspectionDepthPanel}.tsx`
- `components/ui/StateBlock.tsx`, `components/ui/EmptyState.tsx` (props), `components/shared/{PageHeader,RedesignGate}.tsx`, `lib/utils/redesignFlag.ts`
- `apps/web/frozen-files.json`, `apps/web/frozen-files-allowlist.json`, `package.json` (gate scripts)
- `apps/web/i18n/locales/en.ts` / `es.ts` (namespace inventory, line refs, parity)
- Import graph via grep (cross-section sharing + frozen-primitive imports — both verified)
- `.planning/phases/32-role-dashboard-homes/32-RESEARCH.md` + `32-0{1..6}-PLAN.md` headers (wave/parallel structure, direct-read flag pattern), `components/dashboard/*Dashboard.tsx` (flag-read precedent)
- `.planning/phases/33-core-operational-sections/33-CONTEXT.md`, `33-requirements.md`

### Secondary / Tertiary
None — no external library research required; this phase is internal composition only.

## Metadata

**Confidence breakdown:**
- Per-section current state / file map / LOC: HIGH — every claim is a direct read.
- Cross-section sharing + frozen imports: HIGH — exhaustive grep, results shown.
- Flag/StateBlock/i18n/frozen contracts: HIGH — verified against source + Phase 30-32 artifacts.
- Wave grouping: MEDIUM-HIGH — grounded in verified no-shared-files + LOC/effort, but the exact split is a judgment call the planner may tune.
- Two CONTEXT corrections (Programs already reads `isError`; the real gap is "isError available but unread"): HIGH — verified at `programs/page.tsx:51` and per-section destructures.

**Research date:** 2026-08-17
**Valid until:** ~2026-09-16 (stable; internal component work, no fast-moving external dependency)

## RESEARCH COMPLETE
