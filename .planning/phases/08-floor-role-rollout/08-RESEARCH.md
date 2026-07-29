# Phase 8: Floor-Role Rollout - Research

**Researched:** 2026-07-29
**Domain:** Primitive migration (call-site swap) of 5 native mobile floor screens + 6 modals + 3 shared cards onto Phase 7's theme/primitive layer, in an Expo Router (SDK 54) React Native app
**Confidence:** HIGH

## Summary

Phase 7 shipped a complete, working primitive layer (`useTheme()`, `Button`, `Card`, `EmptyState`, `StateBlock`, `StatusBadge`, `useToast()`) with zero screen adoption. Phase 8 is pure call-site migration: every file in scope already exists, already renders correctly, and already gets its colors from the frozen `C` constant (`apps/mobile/components/shared/tokens.ts`). This research verified, file-by-file, exactly how many `C.*` references and `Alert.alert` calls each in-scope file has, built a complete `C.*` → `theme.*` key-mapping table, classified every `Alert.alert` call site against D-04's confirm-vs-feedback rule, and found two concrete architectural gaps the planner must account for: (1) two color families used pervasively in every in-scope file (`C.ink4`, `C.brassSoft`/`C.brassLine`) have **no equivalent** in the reactive `theme` object returned by `useTheme()` — they exist only in the flat `C` compatibility constant — so full migration depth (D-03) is impossible without a small `tokens.ts` addition; (2) the new `Card` primitive is a plain, non-pressable `View` (no `onPress` prop), but `RoomQueueCard`, `WorkOrderCard`, and `TaskCard`'s entire outer shell is an interactive `TouchableOpacity` — so their D-08/D-09 rebuild requires wrapping `Card` in a `Pressable`/`TouchableOpacity`, not replacing the touchable with `Card` directly.

**Primary recommendation:** Plan Phase 8 in D-01 traffic order (My Rooms → Room Board → Work Orders → Tasks → Inspect) as 5 waves, each wave = one list+detail pair (or single screen) plus its reachable modals, with a small "fix the token gap" prerequisite task before Wave 1 that adds `ink4`/`brassSoft`/`brassLine`-equivalent keys to `lightTheme`/`darkTheme` in `tokens.ts`. `[roomId].tsx` (1137 lines, 112 `C.` refs, 43 `TouchableOpacity`) and `[woId].tsx` (970 lines, 79 `C.` refs, 21 `TouchableOpacity`) are large enough to warrant splitting into 2 tasks each within their wave (e.g., "header/status/actions" vs. "notes/blockers/checklist/photo" sections) purely for reviewability — the migration itself has no natural architectural seam since it's one file's `StyleSheet.create`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Screen rendering (My Rooms, Room Board, Work Orders, Tasks, Inspect) | Native Mobile Client (`app/(app)/**`) | — | Expo Router screens; pure presentation, no server rendering tier exists in this app |
| Primitive components (Button, Card, EmptyState, StateBlock, StatusBadge) | Native Mobile Client (`components/ui/**`) | — | Already built in Phase 7; Phase 8 only consumes them |
| Theme resolution (`useTheme()`) | Native Mobile Client (`lib/theme/**`) | — | React Context, in-process, no network/backend involvement |
| Toast feedback (`useToast()`) | Native Mobile Client (`lib/theme/ToastProvider.tsx`) | — | In-process queue; Phase 8 wires call sites, doesn't touch the provider |
| Offline sync queue, RBAC, data contracts, inspection-submission logic | API / Backend (unchanged) + `stores/appStore.ts`/`lib/offline/**` | — | Explicitly frozen per phase boundary — Phase 8 must not touch these files or the shapes they mutate |
| i18n string resolution (`t()`) | Native Mobile Client (`react-i18next`) | — | Existing keys are reused verbatim; no new keys needed except where noted in Open Questions |

**Conclusion:** 100% of this phase's work is in the Native Mobile Client tier. Nothing in this phase should touch `apps/api/**`, `lib/offline/**`, `stores/appStore.ts`'s queue shape, or `lib/navigation/roleTabs.ts`. Any task action that proposes editing those paths is out of scope and should be flagged by the plan-checker.

## Standard Stack

No new libraries. This phase consumes what Phase 7 already shipped — zero new npm dependencies (confirmed, `.planning/research/STACK.md`). All primitives, the theme hook, and the toast system already exist and are verified working (read directly, see Code Examples below).

### Core (already installed, already in use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-native` | 0.81.5 | `Pressable`, `View`, `Text`, `ActivityIndicator` — primitives' rendering base | Already the only UI runtime |
| `@expo/vector-icons` (Ionicons) | ^15.0.3 | Icon set for `Button`, `StatusBadge`, `EmptyState` | Already the only icon lib; `StatusBadge`'s icon set is a closed enum keyed by `StatusKey` |
| `react-i18next` | ^14.1.2 | `t()` calls passed as primitive props | Primitives take zero hardcoded strings — every label/title/body is caller-supplied |

### Don't add
No `react-native-toast-message` (broken on SDK 54, per `.planning/research/STACK.md`), no styling library, no new UI kit. This phase is a pure call-site rewrite of existing screens onto existing primitives.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card surface (bg/border/radius/shadow) | A new `styles.card` per screen | `components/ui/Card.tsx` | Already extracted from `RoomQueueCard`'s exact shell; verified — see Code Examples |
| Status color+icon+label chip | A new chip/pill component | `components/ui/StatusBadge.tsx` | Covers all 13 status keys needed by rooms + work orders + tasks (verified below) |
| Loading/empty/error block | Hand-rolled `ActivityIndicator` + custom empty card | `components/ui/StateBlock.tsx` | One component, `status` prop, already wired to `EmptyState`/`Button` for retry |
| Non-blocking feedback | A custom banner/snackbar | `useToast()` from `lib/theme/useToast.ts` | Already positioned below `OfflineBanner`, already respects D-01..D-04 |
| Primary/secondary/destructive button with loading | A new `TouchableOpacity` + `ActivityIndicator` combo (the pattern every in-scope file currently uses) | `components/ui/Button.tsx` | Loading state already replaces label in-place with no layout shift (verified) |

**Key insight:** every "Don't Hand-Roll" item in this table is not a general RN best-practice reminder — it is a literal pattern that appears, hand-rolled, dozens of times across the 15 in-scope files (see `C.` reference counts below). The primitives exist specifically to replace these exact patterns.

## Code Examples

Verified by direct read of `apps/mobile/components/ui/*.tsx` and `apps/mobile/lib/theme/*.ts` (all HIGH confidence, this-repo source, not training data):

### `useTheme()` — exact hook shape
```typescript
// apps/mobile/lib/theme/useTheme.ts
export function useTheme() {
  const mode = useThemeMode();          // ThemeProvider currently pins "light" (Phase 10 unlocks dark)
  return useMemo(() => getThemeTokens(mode), [mode]);
}
```
Returns the same object shape as `lightTheme`/`darkTheme` in `tokens.ts` — see the mapping table below for exact keys.

### `Button` — exact prop signature
```typescript
// apps/mobile/components/ui/Button.tsx
interface ButtonProps {
  label: string;                 // no default, no ReactNode — plain string only
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";  // default "primary"
  size?: "sm" | "md" | "lg";     // default "md"; sm minHeight 44, md 48, lg 56
  loading?: boolean;             // spinner replaces label in place, no layout shift
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
}
```
`destructive` always resolves to `theme.status.dirty` (never an inline hex). A `claimBtn`/`confirmBtn`/`doneBtn` call site converts as:
```tsx
// BEFORE (WorkOrderCard.tsx:182-198)
<TouchableOpacity style={styles.claimBtn} onPress={onClaim} disabled={claiming} ...>
  {claiming ? <ActivityIndicator size="small" color={C.accent} /> : (
    <><Ionicons name="hand-right-outline" size={14} color={C.accent} />
      <Text style={styles.claimText}>{t("workOrders.claim")}</Text></>
  )}
</TouchableOpacity>

// AFTER
<Button
  label={t("workOrders.claim")}
  onPress={onClaim}
  loading={claiming}
  variant="secondary"
  size="sm"
  icon="hand-right-outline"
/>
```

### `Card` — exact prop signature (no `onPress`)
```typescript
// apps/mobile/components/ui/Card.tsx
interface CardProps {
  children: React.ReactNode;
  dimmed?: boolean;     // maps to the RoomQueueCard "cardDimmed"/exception-row look
  style?: StyleProp<ViewStyle>;
}
```
`Card`'s own `styles.base` is `{ borderWidth:1, borderRadius:16, padding:16, shadowRadius:10, shadowOffset:{0,3} }` — a **uniform** padding box. `RoomQueueCard`/`WorkOrderCard`/`TaskCard`'s existing shells use asymmetric padding (`paddingLeft:16, paddingRight:12`) and `flexDirection:"row"` — these must be passed via the `style` prop (merge order is base-first, caller-last per Phase 7's Pitfall 6 contract, so caller overrides apply correctly).

**Critical gotcha (not covered by Phase 7 CONTEXT/PATTERNS, found in this research):** `Card` renders a plain `View`, not `Pressable`. But `RoomQueueCard`, `WorkOrderCard`, and `TaskCard` are each currently a single interactive `TouchableOpacity` — the entire card is the tap target (`onPress={onPress}` on the outermost element, `WorkOrderCard.tsx:61-68`, `evening.tsx:196`). Since `Card` has no `onPress`, D-08/D-09's rebuild must wrap `Card` in a `Pressable`/`TouchableOpacity` rather than replace the touchable with `Card` directly:
```tsx
// Pattern for rebuilding WorkOrderCard/TaskCard/RoomQueueCard on Card:
<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={wo.title}>
  <Card style={[styles.cardLayoutOverrides, isAlert && styles.cardAlertOverride]}>
    {/* existing internal layout, chips → StatusBadge */}
  </Card>
</Pressable>
```
This is a design decision the planner should lock explicitly (Claude's Discretion in 08-CONTEXT.md already defers "internal file/component structure" — this finding narrows that discretion to a concrete, buildable pattern).

### `StatusBadge` — exact prop signature and full status-key coverage
```typescript
// apps/mobile/components/ui/StatusBadge.tsx
interface StatusBadgeProps {
  statusKey: "ready" | "clean" | "dirty" | "occupied" | "pickup" | "outOfOrder"
           | "emergency" | "urgent" | "low" | "onHold" | "overdue" | "inProgress" | "completed";
  label: string;   // caller-provided, already-translated — no internal t() call
  style?: StyleProp<ViewStyle>;
}
```
**Verified full coverage** — every status this phase's screens render maps cleanly to an existing `StatusKey`:

| Domain | Current value/condition | `StatusKey` | Source |
|---|---|---|---|
| Room status | `DIRTY` | `dirty` | `evening.tsx` `STATUS_META` |
| Room status | `OCCUPIED` | `occupied` | ″ |
| Room status | `PICKUP` | `pickup` | ″ |
| Room status | `IN_PROGRESS` | `inProgress` | ″ |
| Room status | `CLEAN` | `clean` | ″ |
| Room status | `INSPECTED` | `ready` | ″ |
| Room status | `OOO` / `OUT_OF_ORDER` / `OUT_OF_SERVICE` | `outOfOrder` | ″ |
| WO priority | `wo.priority === "emergency"` | `emergency` | `WorkOrderCard.tsx:49,95-98` |
| WO priority | `wo.priority === "urgent"` | `urgent` | ″ |
| WO priority | `wo.priority === "low"` | `low` | ″ |
| WO status | `wo.status === "on_hold"` | `onHold` | `WorkOrderCard.tsx:51,111-115` |
| WO due | `due?.kind === "overdue"` | `overdue` | `WorkOrderCard.tsx:138-141` |
| WO status | `wo.status === "completed"` | `completed` | `WorkOrderCard.tsx:172-175` (currently a bare checkmark badge, not a chip — planner should decide whether to keep bare-icon or upgrade to full `StatusBadge`; D-11 forbids an icon-only escape hatch, so the bare checkmark badge should become a full `StatusBadge` for consistency) |
| Task priority | `priority === "urgent" \|\| "high"` | `urgent` | `TaskCard.tsx:55,100-105` |
| Task status | `task.status === "in_progress"` | `inProgress` | `TaskCard.tsx:57,106-110` |
| Task due | `overdueMinutes != null` | `overdue` | `TaskCard.tsx:60-65,123-124` |

No status value in scope lacks a `StatusKey`. This significantly de-risks D-08/D-09 — it is a mechanical chip swap, not a design decision.

### `StateBlock` — exact prop union
```typescript
// apps/mobile/components/ui/StateBlock.tsx
type StateBlockProps =
  | { status: "loading" }
  | { status: "empty"; emptyIcon?: IconName; emptyTitle: string; emptyBody?: string }
  | { status: "error"; errorIcon?: IconName; errorMessage: string; onRetry?: () => void; retryLabel?: string }
  | { status: "ready"; children: React.ReactNode };
```
Note: `retryLabel` is **required** whenever `onRetry` is passed (throws at runtime otherwise — enforced in the component, not just types). My Rooms' 3 ad-hoc empty blocks (`my-rooms/index.tsx:232-237,292-295,310-314` — no rooms / all done / nothing done yet) convert directly:
```tsx
// BEFORE
<View style={styles.emptyCard}>
  <Text style={styles.emptyTitle}>{t("rooms.allRoomsDone")}</Text>
  <Text style={styles.emptyText}>{t("rooms.allRoomsDoneHint")}</Text>
</View>

// AFTER
<StateBlock status="empty" emptyIcon="checkmark-done-outline" emptyTitle={t("rooms.allRoomsDone")} emptyBody={t("rooms.allRoomsDoneHint")} />
```

### `useToast()` — exact contract
```typescript
// apps/mobile/lib/theme/useToast.ts
const { success, error, info } = useToast();
success(message: string): void;   // 3s auto-dismiss
error(message: string): void;     // 5s auto-dismiss
info(message: string): void;      // 3s auto-dismiss
```
Only one toast visible at a time (new replaces current); tap does nothing; swipe dismisses early. All three take an already-translated string — the caller still owns `t()`.

## `C.*` → `theme.*` Migration Map (verified against `tokens.ts`, exhaustive)

This is the reference table every task action in Phase 8 should cite directly instead of writing "migrate colors to theme" vaguely.

| Legacy `C.*` key | `useTheme()` equivalent | Notes |
|---|---|---|
| `C.paper` | `theme.background` | |
| `C.surface` | `theme.surface` | |
| `C.surface2` | `theme.surfaceSubtle` | |
| `C.surface3` | `theme.surfaceMuted` | |
| `C.line` | `theme.border` | |
| `C.line2` | `theme.borderSubtle` | |
| `C.ink` | `theme.textPrimary` | |
| `C.ink2` | `theme.textSecondary` | |
| `C.ink3` | `theme.textMuted` | |
| **`C.ink4`** | **NO EQUIVALENT** | See Gap below |
| `C.primary` | `theme.primary` | |
| `C.accent` | `theme.primaryAction` | |
| `C.accentSoft` | `theme.primarySoft` | |
| `C.accentLine` | `theme.primaryLine` | |
| `C.brass` | `theme.accentBrass` | |
| **`C.brassSoft`** | **NO EQUIVALENT** | See Gap below |
| **`C.brassLine`** | **NO EQUIVALENT** | See Gap below |
| `C.clay` | `theme.accentClay` | |
| `C.shell*` (bg/Surface/Raised/Line/Ink/Ink2/Ink3) | `theme.shell.*` (bg/surface/raised/line/ink/ink2/ink3) | Same object reference either way (`lightTheme.shell = shellTokens`) — screens that `import { shellTokens }` directly (not via `C`) should also switch to `theme.shell` for reactivity consistency, even though the values are numerically identical today |
| `C.ready` / `readySoft` / `readyLine` | `theme.status.ready` / `readySoft` / `readyLine` | |
| `C.caution` / `cautionSoft` / `cautionLine` | `theme.status.pickup` / `pickupSoft` / `pickupLine` | Name changes: "caution" (legacy) → "pickup" (theme) |
| `C.alert` / `alertSoft` / `alertLine` | `theme.status.dirty` / `dirtySoft` / `dirtyLine` | Name changes: "alert" → "dirty" |
| `C.info` / `infoSoft` / `infoLine` | `theme.status.clean` / `cleanSoft` / `cleanLine` | Name changes: "info" → "clean" |
| `C.occupied` | `theme.status.occupied` | |
| `C.ooo` / `oooSoft` / `oooLine` | `theme.status.outOfOrder` / `outOfOrderSoft` / `outOfOrderLine` | |
| `C.ai` / `aiSecondary` / `aiElectric` / `aiSoft` / `aiLine` / `aiGlow` | `theme.ai.primary` / `secondary` / `electric` / `soft` / `line` / `glow` | Not used in Phase 8 scope files (AI screens are Phase 9) |
| `C.glass` / `glassBorder` | **NO EQUIVALENT in light mode** (`lightTheme` has no `glass`/`glassBorder` key; `C.glass` always points at `darkTheme.glass` regardless of active mode) | Not found in any Phase 8 in-scope file — confirmed via grep, safe to ignore this phase |

### Gap: `C.ink4`, `C.brassSoft`, `C.brassLine` have no `theme.*` path — action required before Wave 1

`tokens.ts` defines these three as **hardcoded literals inside the flat `C` object only** (`ink4: "#B7AA99"`, `brassSoft: "#F4E7C6"`, `brassLine: "#E2C679"` — `tokens.ts:127,133-134`) — they are never derived from `lightTheme`/`darkTheme`, so `useTheme()` cannot produce them. Grep confirmed all three are used **pervasively across every single Phase 8 in-scope file**:

- `C.ink4`: `room-board/index.tsx`, `my-rooms/[roomId].tsx`, `inspect/index.tsx` (×4), `work-orders/index.tsx` (×6), `tasks/index.tsx` (×3), `work-orders/[woId].tsx` (×6), `WorkOrderCard.tsx` (×4), `TaskCard.tsx`, `evening.tsx`/`RoomQueueCard` (×3) — used for muted icons, placeholder text color, low-priority chip text, chevrons, disabled-button background.
- `C.brassSoft`/`C.brassLine`: `my-rooms/[roomId].tsx`, `WorkOrderCard.tsx` (furniture category), `TaskCard.tsx` (lost_found category), `evening.tsx`/`RoomQueueCard` (VIP badge), `ChecklistSection.tsx`, `ReportIssueModal.tsx` — the "brass/VIP" accent family.

Since D-03 requires **zero** legacy `C`-token usage left in these files after Phase 8, and these three colors have no reactive path today, the planner must schedule a small, low-risk prerequisite task (before Wave 1, or as Wave 1's first task) that adds the missing keys to `lightTheme`/`darkTheme` in `tokens.ts` — e.g. `textDisabled: "#B7AA99"` and an `accentBrassSoft`/`accentBrassLine` pair (or nest them under a small `brass: { soft, line }` group) — mirroring the existing pattern (`accentBrass` already exists; only the soft/line variants are missing). This is a **data-only** addition (no new primitive, no new provider), consistent with Phase 7's "tokens.ts is data, keep in place" precedent, and does not reopen Phase 7's scope — it is squarely Phase 8's problem since Phase 7 never needed these two color families. Not flagged in `.planning/research/PITFALLS.md` because that research predates this file-level grep.

## Alert.alert → Toast Classification (D-04), verified per call site

CONTEXT.md's canonical-refs figure of "~24 Alert.alert calls" covers only 3 files (`my-rooms/[roomId].tsx` 11, `work-orders/[woId].tsx` 11, `inspect/index.tsx` 2). **This research found 8 additional `Alert.alert` calls in the in-scope modals** (D-05 scope), for an actual total of 32 across 6 files. Full classification below — only **2 of 32** are genuine confirm/choice dialogs that must stay blocking per D-04; the other 30 are outcome-reporting and convert to `Toast`.

### `my-rooms/[roomId].tsx` — 11 calls, **all 11 → Toast** (zero confirm dialogs)
| Line | Call | Classification | Toast variant |
|---|---|---|---|
| 351 | Status update failed | Outcome (error) | `error` |
| 400 | Undo failed | Outcome (error) | `error` |
| 407 | "Notes need connection" (offline block) | Outcome (info, not a choice — action simply can't proceed) | `info` |
| 425 | Save note failed | Outcome (error) | `error` |
| 434 | "Blockers need connection" | Outcome (info) | `info` |
| 452 | DND escalation notice (title-only, no buttons) | Outcome (info, auto-continues to `sendSupervisorEscalation`) | `info` |
| 462 | Report blocker failed | Outcome (error) | `error` |
| 470 | "DND needs connection" | Outcome (info) | `info` |
| 480 | Update DND failed | Outcome (error) | `error` |
| 488 | "Service needs connection" | Outcome (info) | `info` |
| 498 | Update service failed | Outcome (error) | `error` |

### `work-orders/[woId].tsx` — 11 calls, **10 → Toast, 1 stays Alert.alert**
| Line | Call | Classification | Action |
|---|---|---|---|
| 172 | Claim failed | Outcome (error) | → Toast `error` |
| 188 | "Completed" (single OK button, `onPress: () => router.back()`) | Outcome — action already succeeded; OK only triggers navigation, not a Yes/Cancel choice | → Toast `success`, then `router.back()` called directly (no dismiss-gate needed) |
| 194 | "Offline, queued" | Outcome (info) | → Toast `info` |
| 197 | Complete failed | Outcome (error) | → Toast `error` |
| 210 | Set-status failed | Outcome (error) | → Toast `error` |
| 228 | Add-comment failed | Outcome (error) | → Toast `error` |
| 242 | Arrive failed | Outcome (error) | → Toast `error` |
| **250** | **Escalate confirm** — `Cancel` / `Confirm` buttons, gates a state-changing escalation action | **Genuine confirm/choice** | **STAYS `Alert.alert`** |
| 265 | Escalate-failed (nested inside the confirm's onPress) | Outcome (error) | → Toast `error` |
| 279 | Camera permission denied | Outcome (error/info) | → Toast `error` |
| 297 | Add-photo failed | Outcome (error) | → Toast `error` |

### `inspect/index.tsx` — 2 calls, **both → Toast**
| Line | Call | Classification |
|---|---|---|
| 176 | Submit inspection failed | Outcome (error) → Toast `error` |
| 346 | Reclean failed | Outcome (error) → Toast `error` |

### Modals (D-05 scope, not counted in CONTEXT.md's "~24") — 8 calls, **7 → Toast, 1 stays Alert.alert**
| File | Line | Call | Classification |
|---|---|---|---|
| `FoundItemModal.tsx` | 63 | Camera permission denied | Outcome (error) → Toast `error` |
| `FoundItemModal.tsx` | **79** | `showPhotoOptions()` — 3-way action sheet: Take Photo / Choose Gallery / Cancel | **Genuine choice** → **STAYS `Alert.alert`** |
| `FoundItemModal.tsx` | 98 | Offline error | Outcome (error) → Toast `error` |
| `SupplyRequestModal.tsx` | 47 | "Nothing selected" validation | Outcome (error) → Toast `error` |
| `SupplyRequestModal.tsx` | 59 | "Requested" success (OK → `reset(); onClose();`) | Outcome (success) → Toast `success`, call `reset()`/`onClose()` directly (no dismiss-gate) |
| `SupplyRequestModal.tsx` | 63 | Request failed | Outcome (error) → Toast `error` |
| `CreateWorkOrderModal.tsx` | 89 | "Work Order Created" success (OK → `onClose`) | Outcome (success) → Toast `success`, call `onClose()` directly |
| `CreateWorkOrderModal.tsx` | 91 | Create failed | Outcome (error) → Toast `error` |

`KnockModal.tsx` and `ReportIssueModal.tsx` have **zero** `Alert.alert` calls (confirmed via grep) — nothing to convert in either.

**Notable i18n detail:** `SupplyRequestModal.tsx` and `CreateWorkOrderModal.tsx`'s `Alert.alert` calls use **hardcoded English literals** directly (`"Nothing selected"`, `"Requested"`, `"Work Order Created"`, `"Error"`), not `t()` — these two files are the i18n-gate-exempt files (D-06/eslint.config.mjs). Per D-06, Phase 8 passes these strings through to `Toast` as-is (no new `t()` wiring); this is expected and does not violate the ESLint gate since `i18next/no-literal-string` is `markupOnly: true` (only flags JSX text/attributes, not string arguments to a `Toast` call) — confirmed by reading `apps/mobile/eslint.config.mjs`.

**Pattern for the "success → OK → side effect" cases (188, 59, 89):** all three currently gate a side effect (navigate back / reset+close / close) behind the user tapping "OK" on the success alert. Converting to `Toast` removes that gate — the recommended pattern is to fire the toast and the side effect together (`toast.success(msg); onClose();`), since the action already succeeded and there is no reason to make the user's next step wait on a modal dismiss. Flag this as a locked pattern for the planner rather than 3 independent judgment calls.

## `C.` Reference Counts Per In-Scope File (verified via grep, informs task sizing)

| File | Lines | `C.` refs | `Alert.alert` | `TouchableOpacity` | Notes |
|---|---|---|---|---|---|
| `my-rooms/index.tsx` | 391 | 11 | 0 | 4 | Read in full — see Code Examples for its 3 empty-state blocks and loading spinner |
| `my-rooms/[roomId].tsx` | 1137 | **112** | 11 | 43 | Largest file in scope — recommend splitting into 2 tasks |
| `room-board/index.tsx` | 413 | 25 | 0 | — | |
| `work-orders/index.tsx` | 474 | 29 | 0 | — | Has search bar + filter chips (uses `C.ink4` for placeholder/icon) |
| `work-orders/[woId].tsx` | 970 | **79** | 11 (1 stays) | 21 | Second-largest — recommend splitting into 2 tasks |
| `tasks/index.tsx` | 382 | 15 | 0 | — | i18n-gate-exempt (D-06) |
| `inspect/index.tsx` | 668 | 64 | 2 | — | Fail-checklist UI is text/checkbox based, not photo-based (see Open Questions) |
| `WorkOrderCard.tsx` | 316 | 53 | 0 | 2 (outer card + claim button) | Full rebuild target (D-08) — read in full, see Code Examples |
| `TaskCard.tsx` | 287 | 43 | 0 | 3 (done/confirm/cancel buttons) | Full rebuild target (D-08) — read in full, see Code Examples |
| `evening.tsx` (`RoomQueueCard` only, per D-09) | 415 total | 41 (whole file; `RoomQueueCard` itself ~30) | 0 | 1 (the card itself) | Only `RoomQueueCard`'s card-shell usage is in scope — `StatusPill`/`StatusRail`/`ProgressBar`/`Chip`/`AIBriefingCard`/`SectionHeader` exports stay untouched (D-09) |
| `CreateWorkOrderModal.tsx` | 318 | 31 | 2 (1 success, 1 error) | — | i18n-gate-exempt |
| `ReportIssueModal.tsx` | 336 | 36 | 0 | — | i18n-gate-exempt |
| `SupplyRequestModal.tsx` | 167 | 17 | 3 (1 validation, 1 success, 1 error) | — | i18n-gate-exempt |
| `KnockModal.tsx` | 121 | 5 | 0 | — | Smallest modal, likely a single task alongside another small file |
| `FoundItemModal.tsx` | 286 | 0 | 3 (1 error, 1 action-sheet stays, 1 error) | — | Already uses `t()` throughout (not exempt) — zero `C.` hits means it likely already themes via a different path or has minimal styling; verify during planning |
| `ChecklistSection.tsx` | 326 | 23 | 0 | — | Reachable from Inspect via My Rooms room detail (D-07-analog reasoning, actually D-05) |

**Wave-sizing implication:** total `C.` references across all 17 in-scope files ≈ 565. The two detail screens alone (`[roomId].tsx` + `[woId].tsx`) account for 191 of those (34%) — confirms D-02's list+detail-together pairing is right, but each pair's *detail* file is a multi-task unit on its own, while each pair's *list* file plus its wave's modals can likely be one task.

## Architecture Patterns

### Recommended Wave Breakdown (respects D-01 traffic order + D-02 list/detail pairing)

```
Wave 0 (prerequisite, before any screen): tokens.ts gap fix
  └─ Add missing theme keys for C.ink4 / C.brassSoft / C.brassLine (see Gap section)

Wave 1 — My Rooms (FLOOR-01, highest traffic)
  ├─ Task: my-rooms/index.tsx (391 lines, 11 C. refs) — loading/empty/list → StateBlock, RoomQueueCard reuse
  ├─ Task: my-rooms/[roomId].tsx, part A — header/status/primary actions/DND/decline-service (large file, split)
  ├─ Task: my-rooms/[roomId].tsx, part B — notes/blockers/checklist/damage-photo (large file, split)
  ├─ Task: RoomQueueCard rebuild on Card+StatusBadge (D-09, in evening.tsx)
  └─ Task: reachable modals — ReportIssueModal, SupplyRequestModal, KnockModal, FoundItemModal (D-05/D-07)

Wave 2 — Room Board (FLOOR-02)
  └─ Task: room-board/index.tsx (413 lines, 25 C. refs) — single screen, no detail pair, no reachable modals in scope (D-10 excludes room-status)

Wave 3 — Work Orders (FLOOR-03)
  ├─ Task: work-orders/index.tsx (474 lines, 29 C. refs) — search/filter chips + list
  ├─ Task: work-orders/[woId].tsx, part A — status actions (claim/complete/hold/escalate/arrive)
  ├─ Task: work-orders/[woId].tsx, part B — comments/photos/activity log
  ├─ Task: WorkOrderCard rebuild on Card+StatusBadge (D-08)
  └─ Task: CreateWorkOrderModal migration (D-05/D-10 — benefits Phase 9's Room Status for free)

Wave 4 — Tasks (FLOOR-04)
  ├─ Task: tasks/index.tsx (382 lines, 15 C. refs, i18n-exempt)
  └─ Task: TaskCard rebuild on Card+StatusBadge (D-08)

Wave 5 — Inspect (FLOOR-05)
  ├─ Task: inspect/index.tsx (668 lines, 64 C. refs, 2 Alert.alert)
  └─ Task: ChecklistSection.tsx migration (D-05, reachable via My Rooms room detail — could also land in Wave 1 if ChecklistSection's only call site is `[roomId].tsx`; verify call graph during planning)
```

This mirrors `.planning/research/ARCHITECTURE.md`'s P1 rollout guidance and PITFALLS.md's Phase B pitfall set (2, 8, general regression risk) — each wave is independently shippable and testable.

### Pattern: inline color props, not `makeStyles` rewrite (carried over from Phase 7)
Every in-scope file already follows this habit (`{ backgroundColor: meta.bg }` inline in `evening.tsx`/`WorkOrderCard.tsx`). Phase 8 should **not** introduce a `makeStyles(theme)` rewrite — keep each file's existing `StyleSheet.create()` for layout/spacing, and change only the `C.*`/`shellTokens.*` color references to `theme.*` equivalents pulled from `useTheme()` inline at render, per the mapping table above. This is the lowest-diff, most reviewable approach and matches Phase 7's own primitives' internal pattern (see `Card.tsx`, `StatusBadge.tsx` source — both keep static layout in `StyleSheet.create` and interpolate only colors inline).

### Anti-Pattern: replacing an entire card's `TouchableOpacity` with `<Card>`
Already covered above (Card has no `onPress`) — flagging again here because it's the single most likely mechanical mistake during D-08/D-09 execution: a naive find-replace of `<TouchableOpacity style={styles.card} onPress={onPress}>` → `<Card onPress={onPress}>` will fail a type-check (no such prop) or silently drop the tap handler if `style`/`onPress` are spread carelessly.

## Common Pitfalls

Carried forward from `.planning/research/PITFALLS.md`, filtered to what's *live* in Phase 8 (Phase 7 was prevention-only for these):

### Pitfall 2 (from milestone research): `C` vs `theme` dual source
**What goes wrong:** A file gets partially migrated — some colors via `theme.*`, some still via `C.*` — and ships as "done." **How to avoid in Phase 8 specifically:** the `C.` reference counts table above gives an exact per-file target (e.g., `my-rooms/[roomId].tsx` starts at 112, must end at 0). Use `grep -c "C\."` on each file as the literal Definition of Done check per task, not a subjective "looks migrated" judgment. **Verification:** `grep -rn "C\." apps/mobile/app/(app)/my-rooms/[roomId].tsx` returns zero matches after the task, except any remaining `shellTokens` direct import that the task also converts to `theme.shell`.

### Pitfall 8 (from milestone research): role-gated tab registration breaks during restructuring
**What goes wrong:** A "styling-only" edit to a screen file accidentally changes its default export shape, file path, or removes a data-fetch guard, and `lib/navigation/roleTabs.ts` (string-matched, frozen this milestone) silently breaks one role's tab. **How to avoid:** no in-scope task should rename or move any of the 15 files above; `roleTabs.ts` is not touched by any Phase 8 plan. **Verification:** diff review confirms only `StyleSheet`/JSX-color/import lines changed in each file, no route-identity or component-signature changes, no changes to data-fetching `useEffect`s or role-conditional branches.

### New pitfall found in this research: RBAC/data-fetch guards live inside the same files being restyled
`my-rooms/[roomId].tsx` and `work-orders/[woId].tsx` both mix presentation (the ~80-112 `C.` refs) with real business logic in the same function bodies — e.g. `updateRoomStatus`, `handleToggleDnd`, `handleClaim`, `handleEscalate` all call `api.*`/`enqueueAction` and contain the actual state-transition logic, not just UI. Converting their `Alert.alert` calls to `Toast` touches these same functions (the `Alert.alert` call is usually the last line of a try/catch inside the handler). **Guidance for the planner:** each task action for these two files should explicitly say "only change the feedback call (`Alert.alert` → `toast.error`/`toast.success`) inside each handler — do not alter the preceding awaited API/queue calls, do not alter early-return guards" so the executing agent doesn't conflate "I'm touching this function" with license to refactor its logic.

### `ChecklistSection.tsx`'s reachability needs confirming during planning
D-05/D-07-style reasoning applies: `ChecklistSection` is described as "from Inspect, via My Rooms room detail" in CONTEXT.md's canonical refs — meaning its actual React call site is inside `my-rooms/[roomId].tsx`, not `inspect/index.tsx` directly. The planner should grep `ChecklistSection` usage before assigning it to Wave 1 vs. Wave 5 (see grep below — confirmed only one import site).

## Open Questions

1. **FLOOR-05's "photo-on-fail prompt" does not exist in the current mobile Inspect screen.**
   - What we know: `REQUIREMENTS.md`'s FLOOR-05 text says the Inspect screen must render "including the photo-on-fail prompt." `inspect/index.tsx`'s fail flow (`confirm?.result === "failed"`) is a text/checkbox checklist (`failChecklistLabel`, `TextInput` for notes) — grep confirmed **zero** `ImagePicker`/photo-upload code in `inspect/index.tsx`. The web app's Phase 1 history (`STATE.md`) mentions "`requires_photo_on_fail` enforced" for `InspectionModal` — but that is a **web** component; nothing in mobile's `inspect/index.tsx` or `ChecklistSection.tsx` implements it (confirmed via grep for `requires_photo`, `photo_url`, `ImagePicker` — no matches in either file).
   - What's unclear: whether FLOOR-05's wording is describing a feature that needs to be *built* (out of scope — Phase 8 is explicitly migration-only, "no change to underlying behavior") or is imprecise boilerplate copied from the web requirement that doesn't actually apply to mobile's current fail-checklist implementation.
   - Recommendation: the planner should treat this as **migrate the existing fail-checklist UI onto primitives, do not add a new photo capture flow** (adding one would violate the phase's explicit "no change to inspection-submission behavior" boundary and D-03's migration-not-rebuild framing). If a photo prompt is genuinely desired, that is new scope requiring its own discussion/decision, not an assumption to fold into this phase silently. Flag to the user during plan review rather than silently deciding either way — this claim is `[ASSUMED]`.

2. **`FoundItemModal.tsx` has zero `C.` references — verify its actual styling mechanism before planning its migration task.**
   - What we know: grep found 0 `C.*` hits in `FoundItemModal.tsx`, unlike every other file in scope (which have 5-112 hits each). It does have 3 `Alert.alert` calls (classified above) and is explicitly in scope per D-07.
   - What's unclear: whether it has no styling at all (unlikely for a 286-line modal), uses a different color source (e.g., inline hex, or imports from a different token path), or is mostly layout/logic with minimal chrome.
   - Recommendation: read `FoundItemModal.tsx` in full during planning (not done in this research pass, given the file didn't match the grep signal the rest of this research was organized around) to determine its actual primitive-migration surface before writing its task action.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | FLOOR-05's "photo-on-fail prompt" refers to the existing text/checkbox fail-checklist, not a new photo-capture feature to be built | Open Questions #1 | If wrong, Phase 8 under-delivers FLOOR-05's literal success criterion and needs a follow-up scope discussion with the user before/during planning |
| A2 | The `Card` primitive's lack of `onPress` is an intentional "presentational-only" design (not an oversight) that the D-08/D-09 rebuilds should route around via an outer `Pressable`, rather than a primitive gap to fix in this phase | Code Examples, `Card` gotcha | Low — Phase 7 CONTEXT.md explicitly calls Card "a pure surface wrapper," supporting this reading; if wrong, a one-line `onPress` prop addition to `Card.tsx` would be a trivial fix, but that edits a Phase 7 file from within Phase 8, which the planner should flag explicitly rather than do silently |
| A3 | Adding `ink4`/`brassSoft`/`brassLine`-equivalent keys to `lightTheme`/`darkTheme` in `tokens.ts` is in-scope for Phase 8 (not a Phase 7 amendment) since Phase 7 never needed these keys and D-03 requires full `C` burn-down in the 5 screens this phase touches | `C.*` → `theme.*` Gap section | If wrong (e.g., user wants all `tokens.ts` changes routed through a formal Phase 7 amendment), the planner should still flag this gap explicitly rather than silently leaving `C.ink4`/`C.brassSoft`/`C.brassLine` un-migrated, which would violate D-03 |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^29.7.0 + `jest-expo` ~54.0.0 + `@testing-library/react-native` ^12.9.0 |
| Config file | none dedicated found in `apps/mobile/` root — likely inline in `package.json` or inherited from `jest-expo` preset; confirm exact config during planning (not blocking — `npm test` already works per existing `__tests__/` suite) |
| Quick run command | `cd apps/mobile && npx jest __tests__/screens/MyRoomsScreen.test.tsx` (swap filename per screen) |
| Full suite command | `cd apps/mobile && npm test` (`jest --passWithNoTests`) |

### Existing test coverage for in-scope files (confirmed via glob)
| File | Existing test |
|---|---|
| `my-rooms/index.tsx` | `__tests__/screens/MyRoomsScreen.test.tsx` |
| `my-rooms/[roomId].tsx` | `__tests__/screens/RoomDetail.test.tsx` |
| `room-board/index.tsx` | `__tests__/screens/RoomStatusList.test.tsx` (verify this is room-board, not room-status, during planning — name is ambiguous) |
| `work-orders/index.tsx` | `__tests__/screens/WorkOrdersList.test.tsx` |
| `work-orders/[woId].tsx` | `__tests__/screens/WorkOrderDetail.test.tsx` |
| `tasks/index.tsx` | `__tests__/screens/TasksVariationA.test.tsx` |
| `inspect/index.tsx` | `__tests__/screens/InspectorQueue.test.tsx` (verify naming during planning) |
| `ReportIssueModal.tsx` | `__tests__/components/ReportIssueModal.test.tsx` |

No existing test file found for `room-board`/`inspect` under an exact-matching name — confirm via grep/read during planning rather than assuming coverage gaps; the ambiguous names (`RoomStatusList`, `InspectorQueue`) suggest they may already exist under different names than the screen files.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOOR-01 | My Rooms list+detail render via primitives, offline-sync unchanged | unit/component | `npx jest __tests__/screens/MyRoomsScreen.test.tsx __tests__/screens/RoomDetail.test.tsx` | ✅ |
| FLOOR-02 | Room Board renders via primitives, offline-sync unchanged | unit/component | `npx jest __tests__/screens/RoomStatusList.test.tsx` | ✅ (verify name match) |
| FLOOR-03 | Work Orders list+detail render via primitives, RBAC unchanged | unit/component | `npx jest __tests__/screens/WorkOrdersList.test.tsx __tests__/screens/WorkOrderDetail.test.tsx` | ✅ |
| FLOOR-04 | Tasks renders via primitives, data behavior unchanged | unit/component | `npx jest __tests__/screens/TasksVariationA.test.tsx` | ✅ |
| FLOOR-05 | Inspect renders via primitives, submission behavior unchanged | unit/component | `npx jest __tests__/screens/InspectorQueue.test.tsx` | ✅ (verify name match) |

### Sampling Rate
- **Per task commit:** the relevant screen's existing test file, plus `npm run type-check` (`tsc --noEmit`) and `npm run lint` (the i18n gate — hard-fails on any new raw string literal introduced in a gated file)
- **Per wave merge:** full `npm test` + `npm run type-check` + `npm run lint`
- **Phase gate:** full suite green, plus a manual device/simulator pass toggling nothing (Phase 8 is light-mode-only) but verifying: offline banner still renders above any new Toast, no visual regression on any of the 5 screens, EN and ES both render the (unchanged) existing strings without new truncation (primitives don't introduce new strings, but layout changes could still affect wrap — spot-check ES on My Rooms and Work Orders, the two busiest screens)

### Wave 0 Gaps
- [ ] No dedicated test needed for the `tokens.ts` gap-fix (Wave 0 prerequisite) — it's a pure data addition; existing `MobileVisualTokens.test.ts` (found via glob) may already assert on `tokens.ts` shape — read it during planning to confirm the new keys don't break an existing snapshot/shape assertion.

## Security Domain

This phase is presentation-only per its explicit boundary ("no change to underlying offline-sync, RBAC, data contracts, or inspection-submission logic"). No new ASVS category is newly *applicable* — RBAC (V4) and input validation (V5) are already covered by existing, untouched backend/API code and existing tests. The relevant risk is **regression**, not new attack surface:

| Pattern | STRIDE | Standard Mitigation (already in place, must not regress) |
|---------|--------|---------------------|
| A "styling-only" diff accidentally drops a role check or `hotel_id`-scoped fetch inside a handler being touched for its `Alert.alert`→`Toast` conversion | Elevation of Privilege / Information Disclosure | Diff review per task: only `Alert.alert`/`TouchableOpacity`/`StyleSheet` color lines should change in files like `[roomId].tsx`/`[woId].tsx`; any diff touching an `api.*` call's arguments, a `require_role`-equivalent guard, or a tenant-scoping filter is out of scope for this phase (see "New pitfall" above) |
| A modal's success-path side effect (navigate/close) silently dropped when converting its gating `Alert.alert` OK-button to a `Toast` | (UX regression, not a security issue per se, but could leave a screen in an inconsistent state) | Explicit pattern locked above: fire `toast.success()` and the side effect together, don't drop either |

No new secrets, auth flows, or data-boundary code is introduced by this phase.

## Sources

### Primary (HIGH confidence — direct repo reads/greps this session)
- `apps/mobile/components/shared/tokens.ts` — full read, source of the `C.*`→`theme.*` mapping table and the `ink4`/`brassSoft`/`brassLine` gap finding
- `apps/mobile/lib/theme/{ThemeProvider,useTheme,ToastProvider,useToast}.ts(x)` — full reads, confirmed exact hook/provider contracts
- `apps/mobile/components/ui/{Button,Card,EmptyState,StateBlock,StatusBadge}.tsx` — full reads, confirmed exact prop signatures and the `Card`-has-no-`onPress` gotcha
- `apps/mobile/app/(app)/my-rooms/index.tsx` — full read
- `apps/mobile/components/engineering/WorkOrderCard.tsx`, `apps/mobile/components/tasks/TaskCard.tsx`, `apps/mobile/components/shared/evening.tsx` — full reads, confirmed status-key coverage and rebuild patterns for D-08/D-09
- `apps/mobile/eslint.config.mjs` — full read, confirmed exact i18n-gate scope and the 4 exempt files
- `apps/mobile/package.json` — confirmed test framework (Jest/jest-expo/testing-library)
- Grep census across all 17 in-scope files: `C.` reference counts, `Alert.alert` call sites with surrounding context, `TouchableOpacity` counts, photo/fail-related terms in `inspect/index.tsx` and `ChecklistSection.tsx`, `shellTokens.` direct-import usage, `ink4`/`brassSoft`/`brassLine` usage sitewide

### Secondary (already-completed milestone research, read this session)
- `.planning/research/{SUMMARY,ARCHITECTURE,PITFALLS,FEATURES,STACK}.md`
- `.planning/phases/07-theme-foundation-primitives/{07-CONTEXT,07-PATTERNS}.md`
- `.planning/phases/08-floor-role-rollout/08-CONTEXT.md`
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all primitives verified by direct source read
- Architecture (Card gotcha, status-key coverage, wave breakdown): HIGH — grounded in direct reads of both the primitives and every rebuild-target component
- `C.*`→`theme.*` mapping and the ink4/brassSoft/brassLine gap: HIGH — derived directly from `tokens.ts` source, not inference
- Alert.alert classification: HIGH for the 24 CONTEXT-cited calls (each read with surrounding code) and the 8 additional modal calls found this session
- FLOOR-05 photo-on-fail open question: MEDIUM — confirmed absence via grep, but the *intent* behind the requirement wording is genuinely unclear and flagged as ASSUMED rather than resolved

**Research date:** 2026-07-29
**Valid until:** ~14 days (stable internal codebase, but if Phase 9 or an out-of-band fix touches any Phase 8 in-scope file before planning completes, re-verify the `C.` counts and Alert.alert line numbers cited above)
