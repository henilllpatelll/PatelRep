# Phase 9: Remaining Screens Rollout - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 31 (28 migration files + `eslint.config.mjs` + `en.json` + `es.json`; 0 new files — pure call-site migration + i18n wiring)
**Analogs found:** 28 / 28 migration files (every one maps to a **now-shipped Phase 8 migrated exemplar** — a decisive upgrade over Phase 8's mapping, which had no migrated screen to copy from)

All paths below are relative to `apps/mobile/` unless noted. Import alias `@/` = `apps/mobile/`.

**Framing note (why this map is stronger than Phase 8's):** Phase 8 shipped primitives *and then migrated 17 screens onto them*. Those 17 migrated files are now real, in-tree, fully-migrated exemplars. So unlike Phase 8's mapper — which could only point at primitive source + a mapping table — this phase has **concrete before/after reference screens already in the codebase**. Three were read in full this session and serve as the canonical analogs for all 28 files:
- `app/(app)/work-orders/index.tsx` (Phase 8, 490L) — the exemplar **list/CRUD screen**: `useTheme()` hook, inline `{ color: theme.* }` style merge, `StateBlock` empty/loading, hero on `theme.shell.*`, `WorkOrderCard` rows.
- `components/engineering/WorkOrderCard.tsx` (Phase 8, 256L) — the exemplar **tappable card**: `Pressable`-wraps-`Card`, `StatusBadge` chips, `Button` inline action, the `CATEGORY_META`-on-static-`lightTheme` escape hatch.
- `app/(app)/inspect/index.tsx` (Phase 8) — the exemplar **`useToast()` handler** conversion.

The `08-PATTERNS.md` contracts (primitive prop signatures, the `C.*`→`theme.*` map, the Alert→Toast rule, `Pressable`-wraps-`Card`) apply **verbatim** — do not re-derive them; this map cites the live migrated code that already embodies them.

---

## File Classification

### Screens (18 files, `app/(app)/**`) — SCREENS-01,02,03,04,05,06,07,08,09,10

| File | Lines | Role | Data Flow | Closest Analog (Phase 8 migrated) | Match |
|---|---|---|---|---|---|
| `profile/index.tsx` | 539 | screen/detail | request-response (fetch + sign-out) | `work-orders/index.tsx` (chrome) + `inspect/index.tsx` (Toast) | exact |
| `home/index.tsx` | 570 | screen/dashboard | CRUD (multi-widget fetch) | `work-orders/index.tsx` | exact |
| `assignments/index.tsx` | 741 | screen/list | CRUD (list + reassign/remove) | `work-orders/index.tsx` + `inspect/index.tsx` | exact |
| `scheduling/index.tsx` | 156 | screen/list | CRUD (read-mostly) | `work-orders/index.tsx` | exact |
| `staff/index.tsx` | 158 | screen/list | CRUD (read-mostly) | `work-orders/index.tsx` | exact |
| `assets/index.tsx` | 296 | screen/list | CRUD (list + create WO) | `work-orders/index.tsx` + `inspect/index.tsx` | exact |
| `pm-schedules/index.tsx` | 336 | screen/list | CRUD (list + complete) | `work-orders/index.tsx` + `inspect/index.tsx` | exact |
| `guest-requests/index.tsx` | 277 | screen/list | CRUD (list) | `work-orders/index.tsx` | exact |
| `guest-requests/[requestId].tsx` | 317 | screen/detail | request-response (fetch one + mutations) | `app/(app)/work-orders/[woId].tsx` (Phase 8 detail) | exact |
| `lost-found/index.tsx` | 290 | screen/list | CRUD (list + log item) | `work-orders/index.tsx` + `inspect/index.tsx` | exact |
| `logbook/index.tsx` | 206 | screen/list | CRUD (list) | `work-orders/index.tsx` | exact |
| `logbook/new.tsx` | 156 | screen/form | request-response (create) | `inspect/index.tsx` (form submit) | exact |
| `sop/index.tsx` | 133 | screen/list | CRUD (list) | `work-orders/index.tsx` | exact |
| `sop/[sopId].tsx` | 122 | screen/detail | request-response (fetch one) | `work-orders/[woId].tsx` | exact |
| `copilot/index.tsx` | 425 | screen/chat | streaming/event-driven (AI chat) | **anomaly — dark-token, see D-11 section** | partial |
| `alerts/index.tsx` | 177 | screen/list | CRUD (list) | `work-orders/index.tsx` | exact |
| `notifications/index.tsx` | 152 | screen/list | CRUD (list) | `work-orders/index.tsx` | exact |
| `room-status/index.tsx` | 576 | screen/list | CRUD (list + action sheets) | `work-orders/index.tsx` + `inspect/index.tsx` | exact |

### Dashboard composite components (3 files) — SCREENS-02, D-05

| File | Lines | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `components/home/SupervisorHome.tsx` | 405 | component/dashboard | presentational + CRUD props | `work-orders/index.tsx` (chrome) + `WorkOrderCard.tsx` (cards) | exact |
| `components/engineering/EngineerHome.tsx` | 637 | component/dashboard | presentational + CRUD props | `work-orders/index.tsx` + `WorkOrderCard.tsx` | exact |
| `components/home/CompanionHome.tsx` | 337 | component/dashboard | presentational (exports FocusCard/ShiftMosaic/SignalChips) | `WorkOrderCard.tsx` (card shell) | exact |

### Supervisor modals/sheets (7 files, `components/supervisor/**`) — SCREENS-03, D-07/D-08

| File | Lines | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `atoms.tsx` | 235 | component/atoms (shared) | presentational | `WorkOrderCard.tsx` primitives + `08-PATTERNS.md` modal section | role-match |
| `RoomDetailSheet.tsx` | 363 | component/sheet (**own plan, D-08**) | request-response (2 confirms stay + 2 Toast) | `work-orders/[woId].tsx` (mixed confirm+Toast handlers) | role-match |
| `BroadcastModal.tsx` | 137 | component/modal | request-response (submit → Toast) | `inspect/index.tsx` Toast + `08-PATTERNS.md` `CreateWorkOrderModal` note | role-match |
| `DirectMessageModal.tsx` | 118 | component/modal | request-response (submit → Toast) | `inspect/index.tsx` | role-match |
| `EndShiftModal.tsx` | 139 | component/modal | request-response (submit → Toast) | `inspect/index.tsx` | role-match |
| `HousekeeperPicker.tsx` | 146 | component/modal | request-response (select, 0 Alert) | `WorkOrderCard.tsx` (pure color/component swap) | role-match |
| `ShiftNoteModal.tsx` | 104 | component/modal | request-response (submit → Toast) | `inspect/index.tsx` | role-match |

### Config + i18n (3 files) — mandatory backlog

| File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `eslint.config.mjs` | config | transform | itself (remove 4 `ignores` entries) | exact |
| `i18n/locales/en.json` | config/locale | transform | existing `workOrders.*`/`tasks.*` namespaces | exact |
| `i18n/locales/es.json` | config/locale | transform | mirror of `en.json` (parity-critical) | exact |

---

## Pattern Assignments

### All 18 screens + 3 dashboards — shared conversion pattern

**Canonical analog: `app/(app)/work-orders/index.tsx` (Phase 8, migrated, read in full this session).** Copy these exact patterns; they are live, shipped code — not a spec.

**1. Hook import + call** (`work-orders/index.tsx:21,42`):
```typescript
import { useTheme } from "@/lib/theme/useTheme";
// inside component body, top:
const theme = useTheme();
```
Every in-scope file starts at **0 `useTheme()` calls** — all need this added.

**2. Inline color-merge, NOT a `makeStyles` rewrite** — keep each file's existing `StyleSheet.create()` for layout; append a `{ color: theme.* }` / `{ backgroundColor: theme.* }` object as the LAST element of the `style` array (`work-orders/index.tsx:240-256` shows the exact idiom):
```tsx
<View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
  <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("workOrders.kicker")}</Text>
  <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("workOrders.title")}</Text>
```
Dark-hero screens (profile, home, SupervisorHome, EngineerHome, CompanionHome, assignments, assets, pm-schedules, guest-requests, room-status) route their hero chrome through `theme.shell.*` (`theme.shell.bg`/`.ink`/`.ink2`/`.ink3`/`.surface`), exactly as `work-orders/index.tsx:240-256` does.

**3. `StateBlock` for loading/empty** (`work-orders/index.tsx:334-360,371`):
```tsx
{loading ? <StateBlock status="loading" /> : ...}
<StateBlock
  status="empty"
  emptyIcon="list-outline"
  emptyTitle={t("workOrders.emptyOpen")}
  emptyBody={t("workOrders.emptyOpenHint")}
  style={[styles.inlineEmpty, { borderColor: theme.borderSubtle, backgroundColor: theme.surfaceSubtle }]}
/>
```
If `onRetry` is passed, `retryLabel` is REQUIRED (runtime throw otherwise — `StateBlock.tsx:60-62`).

**4. `RefreshControl` tint** (`work-orders/index.tsx:379`): `tintColor={theme.primaryAction}`.

### Tappable card/row files — `Pressable`-wraps-`Card`

**Canonical analog: `components/engineering/WorkOrderCard.tsx` (Phase 8, migrated, read in full this session).** `Card` has NO `onPress` prop — wrap it. Applies to every list-row/card that is currently a single `TouchableOpacity`: `room-status` room cards, guest-requests rows, lost-found rows, logbook rows, assignments rows, assets rows, pm-schedules rows, and the dashboard cards in SupervisorHome/EngineerHome/CompanionHome.

**Exact pattern** (`WorkOrderCard.tsx:70-72,195-196`):
```tsx
<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={wo.title} testID={`wo-${wo.id}`}>
  <Card style={[styles.cardLayoutOverrides, isAlert && { borderColor: theme.status.dirtyLine }]}>
    {/* existing internal content, structurally unchanged */}
  </Card>
</Pressable>
```
`styles.cardLayoutOverrides` re-applies the asymmetric padding/position that `Card`'s uniform `padding:16` base drops — passed via `style` (merged LAST) (`WorkOrderCard.tsx:201-208`):
```typescript
cardLayoutOverrides: {
  position: "relative", overflow: "hidden",
  paddingLeft: 16, paddingRight: 12, paddingVertical: 13, gap: 10,
},
```

**Status/priority chips → `StatusBadge`** (`WorkOrderCard.tsx:101-108`):
```tsx
{isEmergency ? (
  <StatusBadge statusKey="emergency" label={t("workOrders.chipEmergency")} />
) : isUrgent ? (
  <StatusBadge statusKey="urgent" label={t("workOrders.chipUrgent")} />
) : wo.priority === "low" ? (
  <StatusBadge statusKey="low" label="LOW" />
) : null}
{onHold ? <StatusBadge statusKey="onHold" label={t("workOrders.chipOnHold")} /> : null}
```
`label` is caller-provided/already-translated; `StatusBadge` never calls `t()` internally. 13-key closed enum: `ready|clean|dirty|occupied|pickup|outOfOrder|emergency|urgent|low|onHold|overdue|inProgress|completed`. Chips/tiles that have NO `StatusKey` match (category tile, location chip, guest chip, VIP/DND) stay hand-rolled and are only color-migrated to `theme.*` (`WorkOrderCard.tsx:96-129`).

**Inline action → `Button`** (`WorkOrderCard.tsx:184-193`):
```tsx
<Button label={t("workOrders.claim")} onPress={onClaim} loading={claiming} variant="secondary" size="sm" icon="hand-right-outline" style={styles.claimBtn} />
```
`variant="destructive"` resolves through `theme.status.dirty` internally — never pass an inline hex. `loading` replaces the label in place (no layout shift). `label` is a required plain string (no icon-only shape — for icon-only controls use the `IconButton` primitive, e.g. copilot send/mic).

**Static-object escape hatch** (`WorkOrderCard.tsx:27-40`): when a color map is consumed as a plain object by an out-of-scope file (no hook available), source it from the static `lightTheme` export instead of `useTheme()` — values are identical this milestone. `CATEGORY_META` does exactly this. Reuse this reading for any similar shared const in EngineerHome/CompanionHome.

### `Alert.alert` → `useToast()` handlers (11 files, 29 calls: 6 stay, 23 convert)

**Canonical analog: `app/(app)/inspect/index.tsx` (Phase 8, migrated).**
```typescript
import { useToast } from "@/lib/theme/useToast";        // inspect/index.tsx:19
const toast = useToast();                                // inspect/index.tsx:56
// ...
toast.error(t("inspect.submitError"));                   // inspect/index.tsx:185
```
Contract: `toast.success(msg)` / `toast.error(msg)` / `toast.info(msg)` — each takes an **already-translated string** (caller owns `t()`). The full call-by-call classification is in `09-RESEARCH.md` §"Alert.alert → Toast Classification" — apply it directly, do not re-classify. Highlights:

- **6 stay `Alert.alert`** (genuine confirm/choice): `profile:163`, `assignments:238`, `RoomDetailSheet:50`, `RoomDetailSheet:191`, `room-status:311`, `room-status:330`.
- **23 convert to Toast** across assignments, assets, pm-schedules, lost-found, copilot(×6), room-status(×3), and all 4 supervisor modals with alerts.
- **Locked "success → side effect" pattern:** `BroadcastModal:38→onClose` and `ShiftNoteModal:28→onClose` — fire together: `toast.success(msg); onClose();`. Do NOT gate the side effect behind toast dismissal.
- **Pitfall (verbatim from Phase 8):** these handlers mix real `await api.*` / `enqueueAction` business logic with the alert. **Change ONLY the feedback call** — never touch the preceding awaited calls, early-return guards, or tenant-scoping args.

### `copilot/index.tsx` — anomaly (SCREENS-08, D-09/D-10/D-11)

**No clean full-screen analog** — it is built on static `darkTheme.*` tokens, not `C.*`. Resolved by **D-11: keep dark, minimal migration.** Do NOT route through `useTheme()` (would resolve `surfaceElevated`/`glass`/`glassBorder` to `undefined` in light mode — Pitfall 4). Scope is exactly:
- Migrate the **1 real `C.` ref** only: `C.alert` (:285) → `theme.status.dirty`.
- Convert all **6 `Alert.alert` → Toast** (all outcome-reporting; the 3 confirm actions are in-UI `confirmCard` buttons, not alerts).
- Adopt `Button`/`IconButton` on send/mic/quick-action/confirm-card controls (analog: `WorkOrderCard.tsx` `Button` usage + `IconButton` for icon-only send/mic).
- `confirmCard` (:201-242) MAY become a `Card` + two `Button`; message **bubbles stay as-is** (D-09 forbids force-fitting `Card`).
- **No `tokens.ts` change; `MobileVisualTokens.test.ts` untouched.** The static `darkTheme` import at :19 stays.

---

## Shared Patterns

### `C.*` → `theme.*` migration map (applies to all 28 migration files)
**Do not re-derive.** Full verified table in `08-RESEARCH.md` §"`C.*` → `theme.*` Migration Map" and `08-PATTERNS.md` §"Shared Patterns". Name-change gotchas (a rename-only find/replace mis-colors): `C.caution`→`theme.status.pickup`, `C.alert`→`theme.status.dirty`, `C.info`→`theme.status.clean`, `C.ooo`→`theme.status.outOfOrder`. The `ink4`/`brassSoft`/`brassLine` gap that blocked Phase 8 is **already fixed**: `theme.textDisabled`/`theme.accentBrassSoft`/`theme.accentBrassLine` now exist — no Wave-0 token prereq this phase. `shellTokens`/`C.shell*` → `theme.shell.*`.

### Style merge order (every primitive call site)
Primitive's own base + color object apply first; caller's `style` prop LAST in the array. Pass layout overrides (asymmetric padding, `flexDirection:"row"`, `position:"relative"`) to `Card`/`Button` via `style`, never by overriding internal base. Confirmed live in `WorkOrderCard.tsx:72,201-208`.

### `evening.tsx` composites — OUT OF SCOPE (D-13, anti-pattern)
`StatusPill`/`StatusRail`/`ProgressBar`/`Chip`/`AIBriefingCard`/`SectionHeader` in `components/shared/evening.tsx` stay unmigrated; `evening.tsx` may keep `import { C }` (it's a shared library, not a *screen* — criterion #5 reads route/screen files only). Screens keep *calling* these composites unchanged; only each screen's own `C.*` refs migrate. Do NOT "helpfully" migrate `evening.tsx` internals — that reopens Phase 8's deliberately-excluded surface and risks Room Board/Inspect regressions. **Exception:** `CompanionHome.tsx`'s own `FocusCard`/`ShiftMosaic`/`SignalChips` ARE in scope (D-05).

### Role-tab safety (Pitfall 8 — peaks this phase)
The home/dashboard family spans 5 role paths / 4 files. No in-scope task may rename/move a file, change a default-export shape, or drop a role guard — `lib/navigation/roleTabs.ts` is string-matched and frozen. D-06: keep `FrontDeskHomeScreen`/`GMHomeScreen` inline in `home/index.tsx` (no extraction). Diff review DoD: only `StyleSheet`/JSX-color/`Alert`/`TouchableOpacity` lines changed.

### Definition-of-Done per file
`grep -c "\bC\.[a-zA-Z]"` on each touched screen/component returns **0** (except `evening.tsx`, deliberately out of scope). "Looks migrated" is not acceptance.

---

## i18n Gate-Widening (mandatory backlog — 4 files + eslint + 2 locales)

**Goal:** remove the 4 `ignores` entries (`eslint.config.mjs:47-50`), wire `t()` for all 22 literals (16 JSX-text + 6 placeholders), add EN+ES keys, `npm run lint` green.

**`eslint.config.mjs` change** — delete these 4 lines from the `ignores` block (`:47-50`):
```
'components/engineering/CreateWorkOrderModal.tsx',
'components/housekeeping/ReportIssueModal.tsx',
'components/housekeeping/SupplyRequestModal.tsx',
'app/(app)/tasks/index.tsx',
```
Leave the surrounding rule config (`markupOnly: true` at :63) as-is — D-12 keeps the gate narrow (do NOT flip `markupOnly` to enforce placeholders app-wide).

**Concrete i18n exemplar — `app/(app)/tasks/index.tsx` (one of the 4 backlog files, already Phase-8-migrated onto `theme.*`).** It already uses `t()` correctly for most strings but has residual raw literals. The exact "before" at `:248` vs `:253`:
```tsx
<Text style={[styles.previewLabel, { color: theme.ai.primary }]}>{t("tasks.aiPreviewLabel")}</Text>   // ✅ already wired
...
<Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>Room {aiPreview.room_number}</Text>    // ❌ :253 raw literal — the gate violation
```
**After** (mirrors the interpolation idiom already used across the app):
```tsx
<Text style={[styles.previewMeta, { color: theme.shell.ink2 }]}>{t("tasks.roomLabel", { room: aiPreview.room_number })}</Text>
```

**Placeholder wiring exemplar — `work-orders/index.tsx:275-276` (Phase 8 migrated)** shows the exact placeholder + placeholderTextColor idiom the 6 placeholder literals must adopt:
```tsx
placeholder={t("workOrders.searchPlaceholder", { defaultValue: "Search work orders…" })}
placeholderTextColor={theme.textDisabled}
```

**The 22 literals** (exact lines in `09-RESEARCH.md` §"Mandatory i18n Gate-Widening"): 16 JSX-text across `tasks/index.tsx:253`, `CreateWorkOrderModal.tsx` (121,155,166,191,221), `ReportIssueModal.tsx` (95,96,101,113,159,191×2), `SupplyRequestModal.tsx` (82,84×2); plus 6 `placeholder=` attrs in `CreateWorkOrderModal.tsx` (133,146,160), `ReportIssueModal.tsx` (105,195), `SupplyRequestModal.tsx` (128). ⚠️ The `markupOnly:true` gate will NOT force the 6 placeholders (empirically verified) — wire them anyway per D-12's full-22 mandate.

**Locale-key structure** (`i18n/locales/en.json`): keys are nested under per-domain namespaces — `workOrders` (`:462`), `tasks` (`:623`), `reportIssue` (`:697`), `supplies` (`:392`). Namespace new keys under these existing objects. Some strings repeat across modals ("Category"/"Priority"/"Room {n}") — dedupe into shared keys. **`es.json` parity is mandatory** (Pitfall 5): a missing ES key silently falls back to English with NO lint error — cross-check every new key in both files. Human-review the ES for safety-adjacent work-order/issue copy.

---

## No Analog Found

| File | Role | Reason | Planner guidance |
|---|---|---|---|
| `copilot/index.tsx` (full-screen chrome) | screen/chat | Built on static `darkTheme.*`, not `C.*`; intentional dark AI aesthetic with 3 dark-only keys (no light equivalent). No migrated chat screen exists. | Follow D-11 minimal-migration scope above (1 `C.` ref + 6 Toast + Button/IconButton), NOT the standard `work-orders/index.tsx` full-`useTheme()` pattern. Message bubbles stay as-is. |
| `components/supervisor/*` modal shells | component/modal | Phase 8 migrated screens/cards, but no supervisor-style bottom-sheet was migrated. Sub-patterns (Button/Toast/StatusBadge) have analogs; the sheet container does not. | Migrate internals via `WorkOrderCard.tsx` (Button/StatusBadge/color) + `inspect/index.tsx` (Toast); leave each `Modal`/overlay wrapper structurally untouched. `atoms.tsx` is shared — migrate it first within its task. `RoomDetailSheet.tsx` gets its own plan (D-08). |

---

## Metadata

**Analog search scope:** `apps/mobile/app/(app)/work-orders/` (list exemplar, full read), `apps/mobile/components/engineering/WorkOrderCard.tsx` (card exemplar, full read), `apps/mobile/app/(app)/inspect/index.tsx` (Toast exemplar, grepped), `apps/mobile/app/(app)/tasks/index.tsx` (i18n backlog exemplar, targeted read), `apps/mobile/eslint.config.mjs` (full read), `apps/mobile/i18n/locales/en.json` (namespace grep). Primitive prop signatures + `C.*`→`theme.*` map cited from `08-PATTERNS.md`/`08-RESEARCH.md` (not re-derived).
**Files scanned (full/targeted read this session):** `work-orders/index.tsx`, `WorkOrderCard.tsx`, `eslint.config.mjs`, `tasks/index.tsx` (:240-264), `inspect/index.tsx` (grep), `en.json` (grep). All other 28-file counts/line numbers cited from `09-RESEARCH.md`'s verified census (HIGH confidence, same-session grep).
**Pattern extraction date:** 2026-07-30
</content>
</invoke>
