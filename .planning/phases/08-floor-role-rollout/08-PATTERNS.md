# Phase 8: Floor-Role Rollout - Pattern Map

**Mapped:** 2026-07-29
**Files analyzed:** 17 (0 new, 17 modified — pure call-site migration, no new files this phase)
**Analogs found:** 17 / 17 (every file's analog is the Phase 7 primitive source + the `C.*`→`theme.*` mapping; 3 card-rebuild files additionally use each other as structural analogs; 6 modal files have no full-shell analog — see "No Analog Found")

All paths below are relative to `apps/mobile/` unless noted. Import alias `@/` = `apps/mobile/`.

**Framing note:** Unlike Phase 7 (net-new files), Phase 8 files are all *existing* files being edited in place. There is no already-migrated screen in this codebase to copy wholesale — Phase 7 shipped primitives with **zero screen adoption**. So "closest analog" here means: (1) the primitive's own source (`components/ui/*.tsx`, fully read this session, exact current prop signatures below), (2) the verified `C.*`→`theme.*` key mapping from `tokens.ts`, and (3) for the 3 card rebuilds, each card is a near-identical structural twin of the other two (same shell shape, same rail/tile/chip pattern) — read all three together below.

## File Classification

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `components/shared/tokens.ts` (Wave 0 prereq) | config | transform | itself — additive keys only | exact (data-only add) |
| `app/(app)/my-rooms/index.tsx` | screen/list | CRUD (fetch list + per-room actions) | `components/ui/StateBlock.tsx` + `components/ui/Card.tsx` (via `RoomQueueCard` reuse) | role-match |
| `app/(app)/my-rooms/[roomId].tsx` | screen/detail | request-response (fetch one + 11 mutation handlers) | `components/ui/Button.tsx` (11 `Alert.alert`→handler sites) + `useToast()` | role-match |
| `app/(app)/room-board/index.tsx` | screen/list | CRUD (fetch list, no detail pair) | `components/ui/StateBlock.tsx`, `components/ui/StatusBadge.tsx` | role-match |
| `app/(app)/work-orders/index.tsx` | screen/list | CRUD (fetch list + search/filter) | `components/ui/StateBlock.tsx`, `WorkOrderCard.tsx` (post-rebuild) | role-match |
| `app/(app)/work-orders/[woId].tsx` | screen/detail | request-response (fetch one + 11 mutation handlers, 1 confirm dialog) | `components/ui/Button.tsx` + `useToast()`; confirm dialog at line 250 stays `Alert.alert` | role-match |
| `app/(app)/tasks/index.tsx` | screen/list | CRUD (fetch list, i18n-gate-exempt) | `components/ui/StateBlock.tsx`, `TaskCard.tsx` (post-rebuild) | role-match |
| `app/(app)/inspect/index.tsx` | screen/detail-ish | request-response (checklist submit, 2 mutation handlers) | `components/ui/Button.tsx` + `useToast()` | role-match |
| `components/engineering/WorkOrderCard.tsx` | component/card (rebuild target, D-08) | presentational + request-response (`onClaim`) | `components/ui/Card.tsx` + `components/ui/StatusBadge.tsx` + `components/ui/Button.tsx` (claim action) | exact (Card extracted from this shell's twin in Phase 7) |
| `components/tasks/TaskCard.tsx` | component/card (rebuild target, D-08) | presentational + request-response (done/confirm/cancel) | `components/ui/Card.tsx` + `components/ui/StatusBadge.tsx` + `components/ui/Button.tsx` (confirm/cancel) | exact |
| `components/shared/evening.tsx` (`RoomQueueCard` only, D-09) | component/card (rebuild target) | presentational | `components/ui/Card.tsx` (literally extracted from this file's `styles.card` in Phase 7) + `components/ui/StatusBadge.tsx` | exact |
| `components/engineering/CreateWorkOrderModal.tsx` | component/modal | request-response (form submit) | `components/ui/Button.tsx` (submit/cancel) + `useToast()` (2 Alert.alert calls, both success/error → Toast) | role-match |
| `components/housekeeping/ReportIssueModal.tsx` | component/modal | request-response (form submit) | `components/ui/Button.tsx` — zero `Alert.alert` calls, pure color/component swap | role-match |
| `components/housekeeping/SupplyRequestModal.tsx` | component/modal | request-response (form submit) | `components/ui/Button.tsx` + `useToast()` (3 Alert.alert calls: 1 validation, 1 success, 1 error) | role-match |
| `components/housekeeping/KnockModal.tsx` | component/modal | request-response (small action) | `components/ui/Button.tsx` — zero `Alert.alert`, smallest file (121 lines) | role-match |
| `components/housekeeping/FoundItemModal.tsx` | component/modal | request-response (form submit + photo capture) | `components/ui/Button.tsx` + `useToast()`; **0 `C.*` refs found — verify actual styling mechanism before writing its task** | partial (unusual file, see Open Item below) |
| `components/housekeeping/ChecklistSection.tsx` | component/section (embedded in `[roomId].tsx`) | presentational + request-response | `components/ui/StatusBadge.tsx` (checklist pass/fail states) + `components/ui/Card.tsx` | role-match |

---

## Pattern Assignments

### `components/shared/tokens.ts` (Wave 0 prerequisite — config, transform)

**This file IS its own analog** — it's a targeted additive change, not a migration. Current relevant section (`tokens.ts:117-168`, the flat `C` compatibility object) already read in full this session:

```typescript
export const C = {
  // ...
  ink3: lightTheme.textMuted,
  ink4: "#B7AA99",              // <-- NO theme.* equivalent — literal only
  // ...
  brass: lightTheme.accentBrass,
  brassSoft: "#F4E7C6",         // <-- NO theme.* equivalent — literal only
  brassLine: "#E2C679",         // <-- NO theme.* equivalent — literal only
  // ...
} as const;
```

And the reactive theme objects that need the new keys (`tokens.ts:67-109`):
```typescript
export const lightTheme = {
  // ... textPrimary, textSecondary, textMuted already exist ...
  accentBrass: "#C29A4A",
  accentClay: "#E8B89A",
  // ADD: a 4th muted-text tier (textDisabled or similar) + brass soft/line pair
  shell: shellTokens,
  ai: aiTokens,
  status: statusTokens,
} as const;

export const darkTheme = {
  // ... same additions using dark-appropriate values ...
} as const;
```

**Pattern for the fix:** add `textDisabled: "#B7AA99"` (mirrors `C.ink4`'s exact hex) to both `lightTheme`/`darkTheme`, and either a flat `accentBrassSoft`/`accentBrassLine` pair or a nested `brass: { soft, line }` group (mirrors the existing `accentBrass` singular key naming) using `C.brassSoft`/`C.brassLine`'s exact hexes (`#F4E7C6`/`#E2C679`) for light; darkTheme needs its own dark-appropriate values following the alpha-fill pattern already used for `darkStatusTokens` (e.g. `rgba(...)` softened variants) since no dark brass values currently exist anywhere in `tokens.ts`. This is additive only — do not rename or remove any existing `C.*`, `lightTheme.*`, or `darkTheme.*` key (Pitfall 1, frozen-stylesheet-adjacent constraint carried from Phase 7).

**Check before editing:** `MobileVisualTokens.test.ts` (found via glob per RESEARCH.md Wave 0 Gaps) may assert on `tokens.ts` shape — read it first to confirm new keys don't break a snapshot/shape assertion.

---

### Screen files — shared conversion pattern (7 files: `my-rooms/index.tsx`, `my-rooms/[roomId].tsx`, `room-board/index.tsx`, `work-orders/index.tsx`, `work-orders/[woId].tsx`, `tasks/index.tsx`, `inspect/index.tsx`)

**Analog:** `components/ui/Button.tsx`, `components/ui/StateBlock.tsx`, `components/ui/StatusBadge.tsx` source (all read in full this session — exact signatures below), applied via the `C.*`→`theme.*` mapping table in Shared Patterns.

**`useTheme()` import + call pattern (every screen needs this, currently absent):**
```typescript
import { useTheme } from "@/lib/theme/useTheme";
// inside component body:
const theme = useTheme();
```

**Button conversion** (`components/ui/Button.tsx:38-47`, exact current signature):
```typescript
export interface ButtonProps {
  label: string;                 // no default, no ReactNode — plain string only
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";  // default "primary"
  size?: "sm" | "md" | "lg";     // default "md"; sm minHeight 44, md 48, lg 56
  loading?: boolean;             // spinner replaces label in place (styles.labelHidden opacity:0, absolute-positioned spinner) — no layout shift
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
}
```
`variant="destructive"` always resolves through `theme.status.dirty` internally (`Button.tsx:69-71`) — never pass an inline hex, never build a custom destructive button.

**StateBlock conversion** (`components/ui/StateBlock.tsx:17-32`, exact discriminated union):
```typescript
export type StateBlockProps =
  | { status: "loading" }
  | { status: "empty"; emptyIcon?: IconName; emptyTitle: string; emptyBody?: string }
  | { status: "error"; errorIcon?: IconName; errorMessage: string; onRetry?: () => void; retryLabel?: string }
  | { status: "ready"; children: React.ReactNode };
```
`retryLabel` is enforced at runtime (`StateBlock.tsx:60-62`, throws if `onRetry` set without it) — always pass both together. `my-rooms/index.tsx`'s 3 ad-hoc empty blocks (391-line file, per RESEARCH.md lines 232-237/292-295/310-314) convert directly to `<StateBlock status="empty" emptyIcon=... emptyTitle={t(...)} emptyBody={t(...)} />`.

**StatusBadge conversion** (`components/ui/StatusBadge.tsx:6-26`, exact `StatusKey` union — all 13 keys, full coverage confirmed against every status value in scope):
```typescript
export type StatusKey =
  | "ready" | "clean" | "dirty" | "occupied" | "pickup" | "outOfOrder"
  | "emergency" | "urgent" | "low" | "onHold" | "overdue" | "inProgress" | "completed";

interface StatusBadgeProps {
  statusKey: StatusKey;
  label: string;   // caller-provided, already-translated — no internal t() call
  style?: StyleProp<ViewStyle>;
}
```
Room-status screens (`room-board/index.tsx`, `my-rooms/index.tsx`) map `DIRTY→dirty`, `OCCUPIED→occupied`, `PICKUP→pickup`, `IN_PROGRESS→inProgress`, `CLEAN→clean`, `INSPECTED→ready`, `OOO/OUT_OF_ORDER/OUT_OF_SERVICE→outOfOrder` (per `evening.tsx`'s own `STATUS_META`, read in full this session, lines 22-32). Work-order/task screens use the `emergency`/`urgent`/`low`/`onHold`/`overdue`/`inProgress`/`completed` keys per the exact conditionals already in `WorkOrderCard.tsx`/`TaskCard.tsx` (see next section).

**`Alert.alert` → `useToast()` conversion** (`my-rooms/[roomId].tsx`, `work-orders/[woId].tsx`, `inspect/index.tsx`):
```typescript
import { useToast } from "@/lib/theme/useToast";
// inside component:
const toast = useToast();
// exact contract — all three take an already-translated string, caller owns t():
toast.success(message: string): void;   // 3s auto-dismiss
toast.error(message: string): void;     // 5s auto-dismiss
toast.info(message: string): void;      // 3s auto-dismiss
```
Apply the D-04 classification already resolved call-by-call in `08-RESEARCH.md` §"Alert.alert → Toast Classification" — 30 of 32 calls convert to Toast, 2 stay `Alert.alert` (the escalate-confirm at `work-orders/[woId].tsx:250` and the 3-way action sheet at `FoundItemModal.tsx:79`). **Only change the feedback call inside each handler** — do not alter the preceding `await api.*`/`enqueueAction` calls or early-return guards in the same function (RESEARCH.md's "New pitfall" section — these handlers mix real business logic with the alert). For the 3 "success → OK → side effect" cases (`work-orders/[woId].tsx:188`, `SupplyRequestModal.tsx:59`, `CreateWorkOrderModal.tsx:89`), fire the toast and the side effect together: `toast.success(msg); onClose();` / `router.back();` — do not gate the side effect behind toast dismissal.

---

### `components/engineering/WorkOrderCard.tsx` (card, D-08 rebuild) — full current source read

**Analog:** `components/ui/Card.tsx` + `components/ui/StatusBadge.tsx` + `components/ui/Button.tsx`.

**Current shell** (`WorkOrderCard.tsx:60-68`, the entire card is one `TouchableOpacity`):
```tsx
<TouchableOpacity
  style={[styles.card, (isEmergency || isUrgent || due?.kind === "overdue") && styles.cardAlert]}
  onPress={onPress}
  activeOpacity={0.85}
  accessibilityRole="button"
  accessibilityLabel={wo.title}
  testID={`wo-${wo.id}`}
>
```
**Current `styles.card`** (`WorkOrderCard.tsx:204-221`) — this is the exact shell `Card.tsx` was extracted from (asymmetric `paddingLeft:16/paddingRight:12`, `shadowOpacity:0.05`):
```typescript
card: {
  position: "relative", overflow: "hidden",
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg,
  paddingLeft: 16, paddingRight: 12, paddingVertical: 13, gap: 10,
  shadowColor: C.ink, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  elevation: 2,
},
cardAlert: { borderColor: C.alertLine },
```

**Rebuild pattern (Pressable wraps Card — Card has no `onPress` prop):**
```tsx
<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={wo.title} testID={`wo-${wo.id}`}>
  <Card style={[styles.cardLayoutOverrides, (isEmergency || isUrgent || due?.kind === "overdue") && styles.cardAlertOverride]}>
    {/* existing rail/tile/body/chips content, unchanged structurally */}
  </Card>
</Pressable>
```
`styles.cardLayoutOverrides` must re-apply `paddingLeft:16/paddingRight:12/paddingVertical:13/gap:10/position:relative/overflow:hidden` since `Card`'s own `styles.base` (`Card.tsx:38-44`) is a uniform `padding:16` box — these go in the caller's `style` prop, applied last per merge order (Card.tsx applies `style` after its own base+color object, confirmed at `Card.tsx:19-30`).

**Status/priority chips → StatusBadge** (`WorkOrderCard.tsx:95-134`, current hand-rolled chips to replace):
```tsx
{isEmergency ? (
  <View style={styles.urgentChip}>
    <Ionicons name="warning" size={9} color={C.alert} />
    <Text style={styles.urgentChipText}>{t("workOrders.chipEmergency")}</Text>
  </View>
) : isUrgent ? ( /* same shape, "flash" icon, chipUrgent */
) : wo.priority === "low" ? ( /* lowChip, arrow-down, C.ink4 */
) : null}
{onHold ? ( /* holdChip, chipOnHold, no icon */ ) : null}
```
Convert each branch to `<StatusBadge statusKey="emergency" label={t("workOrders.chipEmergency")} />` / `statusKey="urgent"` / `statusKey="low"` / `statusKey="onHold"`. The "done" badge (`WorkOrderCard.tsx:172-175`, currently a bare checkmark, no chip) should become a full `<StatusBadge statusKey="completed" label={t(...)} />` for consistency (RESEARCH.md explicitly flags this — D-11 forbids an icon-only escape hatch).

**Claim button → `Button`** (`WorkOrderCard.tsx:181-198`, current hand-rolled loading pattern):
```tsx
// BEFORE
<TouchableOpacity style={styles.claimBtn} onPress={onClaim} disabled={claiming} activeOpacity={0.85}
  accessibilityRole="button" accessibilityLabel={t("workOrders.claimA11y", { title: wo.title })}>
  {claiming ? <ActivityIndicator size="small" color={C.accent} /> : (
    <><Ionicons name="hand-right-outline" size={14} color={C.accent} />
      <Text style={styles.claimText}>{t("workOrders.claim")}</Text></>
  )}
</TouchableOpacity>
// AFTER
<Button label={t("workOrders.claim")} onPress={onClaim} loading={claiming} variant="secondary" size="sm" icon="hand-right-outline" />
```
Category tile (`CATEGORY_META`, `WorkOrderCard.tsx:23-32`) and location/guest chips stay as-is structurally — only their `C.*` color refs route through `theme.*` (they're not part of the `StatusKey` contract, no primitive covers them).

---

### `components/tasks/TaskCard.tsx` (card, D-08 rebuild) — full current source read

**Analog:** identical structural twin of `WorkOrderCard.tsx` (same author intent — "Mirrors the room-card language", `TaskCard.tsx:8-11` comment) — apply the exact same `Pressable`-wraps-`Card` pattern.

**Current shell** (`TaskCard.tsx:68`) is a plain `View`, not `TouchableOpacity` — the card itself isn't the tap target; only the inner `doneBtn` (lines 134-146) and `confirmBtn`/`cancelBtn` (lines 152-158) are pressable. So **this card does NOT need the `Pressable`-wraps-`Card` pattern for the outer shell** — `<Card style={[...]}>` can replace the outer `View` directly since there's no `onPress` on the card itself to preserve.

**Priority/status chips → StatusBadge** (`TaskCard.tsx:100-110`):
```tsx
{isUrgent ? (
  <View style={styles.urgentChip}>
    <Ionicons name="flash" size={9} color={C.alert} />
    <Text style={styles.urgentChipText}>{priority.toUpperCase()}</Text>
  </View>
) : null}
{inProgress ? ( /* progressChip, statusInProgress */ ) : null}
```
Convert to `<StatusBadge statusKey="urgent" label={priority.toUpperCase()} />` and `<StatusBadge statusKey="inProgress" label={t("tasks.statusInProgress")} />`. Overdue label (`overdueMinutes`, lines 60-65/123-124) → `statusKey="overdue"`.

**Done/confirm/cancel buttons → `Button`** (`TaskCard.tsx:134-158`):
```tsx
// done button — icon-only circular TouchableOpacity today (doneBtn, 38x38, borderRadius 19)
// confirmBtn/cancelBtn — inline row, confirmBtn solid C.accent bg, cancelBtn outlined
```
`doneBtn` is icon-only circular (not a standard label+icon `Button` shape) — RESEARCH.md doesn't explicitly resolve this; the planner should decide whether to keep it as a themed `IconButton` (Phase 7's modified primitive, `components/shared/mobileHandoff.tsx`) or force it into `Button`'s `icon`-only-no-label shape (not supported — `Button.tsx` always renders `label` as required). `confirmBtn`/`cancelBtn` convert cleanly: `<Button label={t("tasks.confirmYes")} onPress={onConfirm} variant="primary" size="sm" icon="checkmark" />` / `<Button label={t("common.cancel")} onPress={onCancel} variant="secondary" size="sm" />`.

---

### `components/shared/evening.tsx` — `RoomQueueCard` only (card, D-09 rebuild) — full file read, scope limited per D-09

**Analog:** `components/ui/Card.tsx` — this primitive was **literally extracted from this exact file's `styles.card`** in Phase 7 (confirmed: `evening.tsx:337-353`'s `card`/`cardDimmed` match `Card.tsx`'s current `base`/`dimmed` behavior almost verbatim, down to `shadowOpacity: dimmed ? 0 : 0.06` and the `0.7` dimmed opacity).

**Current shell** (`evening.tsx:196`, entire card is one `TouchableOpacity`):
```tsx
<TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, dimmed && styles.cardDimmed]} testID={`room-card-${room.room_number}`}>
```
Apply the same `Pressable`-wraps-`Card` pattern as `WorkOrderCard.tsx` — pass `dimmed` straight through to `Card`'s own `dimmed` prop (it already exists on the primitive, no override styles needed for the dimmed variant specifically, only for the asymmetric padding/row-layout base).

**Status pill/rail — DO NOT touch `StatusPill`/`StatusRail` themselves (D-09 explicitly excludes them)** — only `RoomQueueCard`'s own card-shell usage of them is in scope. `StatusPill` (lines 42-53) stays as its own component; `RoomQueueCard` continues calling `<StatusPill status={room.status} />` inside the new `Card` — do not replace `StatusPill` with `StatusBadge` (different prop shape: `StatusPill` takes `status` (raw DB enum) + optional `label` override, `StatusBadge` takes `statusKey` (closed enum) + required `label`). Only new call sites this phase (WorkOrderCard/TaskCard chips) use `StatusBadge`; `RoomQueueCard`'s existing `StatusPill` usage is left as-is per D-09's "other exports untouched" boundary — **verify with planner:** D-09 says "card-shell usage... replaced with Card + StatusBadge" but `RoomQueueCard`'s actual status indicator is `StatusPill`+`StatusRail`, not a bare chip like `WorkOrderCard`'s priority chips. Likely intent: replace the outer shell (`TouchableOpacity`→`Pressable`+`Card`) and any bare badge-shaped chips (`badge`/`badgeCritical`/`badgeBrass`, lines 371-376, the VIP/DND badges) with `StatusBadge`-equivalent treatment where a `StatusKey` exists (none of VIP/DND map to the 13-key enum, so these likely stay hand-rolled, themed via `theme.*` only) — flag this ambiguity in the plan rather than silently picking one reading.

**VIP/DND badges use `C.brassSoft`/`C.brassLine`** (`evening.tsx:373`, `badgeBrass: { backgroundColor: C.brassSoft, borderColor: C.brassLine }`) — this is one of the two files most directly blocked by the Wave 0 `tokens.ts` gap fix.

---

### Modals (6 files) — shared conversion pattern, no full-shell analog exists

**Analog:** `components/ui/Button.tsx` (submit/cancel actions) + `useToast()` (per D-04 classification) — same contracts as the screen section above. No existing modal in this codebase has been migrated to primitives yet (Phase 7 touched zero modals), so there is no "before" migrated-modal example to copy structurally — only the primitive source itself.

**`CreateWorkOrderModal.tsx`** (318 lines, 31 `C.` refs, i18n-gate-exempt): 2 `Alert.alert` calls at lines 89 (success, hardcoded `"Work Order Created"` string, OK→`onClose`) and 91 (error) — both → Toast; fire `toast.success(msg); onClose();` together per the locked pattern. Per D-06, pass the existing hardcoded English strings through to `Toast` as-is — no new `t()` wiring this phase.

**`ReportIssueModal.tsx`** (336 lines, 36 `C.` refs, i18n-gate-exempt): **zero `Alert.alert` calls** (confirmed via grep in RESEARCH.md) — pure color/component swap, no Toast work needed.

**`SupplyRequestModal.tsx`** (167 lines, 17 `C.` refs, i18n-gate-exempt): 3 `Alert.alert` calls — line 47 (validation, hardcoded `"Nothing selected"`) → `toast.error`; line 59 (success, hardcoded `"Requested"`, OK→`reset();onClose();`) → `toast.success(msg); reset(); onClose();`; line 63 (error) → `toast.error`.

**`KnockModal.tsx`** (121 lines, 5 `C.` refs): zero `Alert.alert` calls, smallest modal — likely bundled into the same task as another small file per RESEARCH.md's wave-sizing note.

**`FoundItemModal.tsx`** (286 lines, **0 `C.` refs** — anomaly, see Open Item below): 3 `Alert.alert` calls — line 63 (camera permission denied) → `toast.error`; **line 79 (`showPhotoOptions()`, 3-way action sheet Take Photo/Choose Gallery/Cancel) is a genuine choice and STAYS `Alert.alert`** — do not convert; line 98 (offline error) → `toast.error`. Already uses `t()` throughout, not i18n-gate-exempt.

**`ChecklistSection.tsx`** (326 lines, 23 `C.` refs, reachable from `my-rooms/[roomId].tsx`, embedded not a true modal): zero `Alert.alert` calls per RESEARCH.md's file survey — pure color/component swap. Pass/fail checklist states are candidates for `StatusBadge` (`statusKey="ready"` for pass, or a domain-appropriate key) — verify exact status vocabulary during planning since RESEARCH.md didn't fully enumerate this file's internal branching.

**Open Item — `FoundItemModal.tsx`'s 0 `C.*` hits:** every other in-scope file has 5-112 `C.` references; this file has none despite being 286 lines with 3 `Alert.alert` calls (implying real UI). Per RESEARCH.md's Open Questions #2, read this file in full during planning before writing its task action — it may use inline hex, a different token import path, or be mostly logic with minimal chrome.

---

## Shared Patterns

### `C.*` → `theme.*` migration map (applies to ALL 17 files)
**Source:** `components/shared/tokens.ts` (full read this session). Verified exhaustive table — every `C.*` key used anywhere in the 17 in-scope files maps to exactly one of: a direct `theme.*` key, `theme.shell.*`, `theme.status.*`, or (for `ink4`/`brassSoft`/`brassLine` only) the Wave 0 gap-fix keys. Full table lives in `08-RESEARCH.md` §"`C.*` → `theme.*` Migration Map" — cite it directly per-file rather than re-deriving. Highlights confirmed against actual `tokens.ts` source this session:
```
C.paper → theme.background        C.ink → theme.textPrimary       C.accent → theme.primaryAction
C.surface → theme.surface         C.ink2 → theme.textSecondary    C.accentSoft → theme.primarySoft
C.surface2 → theme.surfaceSubtle  C.ink3 → theme.textMuted        C.accentLine → theme.primaryLine
C.surface3 → theme.surfaceMuted   C.ink4 → NO EQUIVALENT (Wave 0) C.brass → theme.accentBrass
C.line → theme.border             C.alert → theme.status.dirty    C.brassSoft/brassLine → NO EQUIVALENT (Wave 0)
C.line2 → theme.borderSubtle      C.caution → theme.status.pickup C.ready → theme.status.ready
                                   C.info → theme.status.clean     C.ooo → theme.status.outOfOrder
```
Note the **name changes**, not just object-path changes: `caution`→`pickup`, `alert`→`dirty`, `info`→`clean`, `ooo`→`outOfOrder`. A naive rename-only find/replace will not work — each site needs its actual color role identified.

### Style merge order (applies to every primitive call site)
**Rule (carried from Phase 7 Pitfall 6, re-confirmed by reading `Card.tsx:19-30`/`Button.tsx:80-93` this session):** primitive's own `styles.base` + computed color object apply first, caller's `style` prop applies LAST in the array. When passing layout-override styles to `Card` (asymmetric padding, `flexDirection:"row"`, `position:"relative"`), always pass via `style`, never try to override `Card`'s internal `styles.base`.

### `Card` has no `onPress` — wrap in `Pressable`, never replace `TouchableOpacity` 1:1
**Source:** `Card.tsx:5-9` interface, confirmed no `onPress` prop exists. **Applies to:** `WorkOrderCard.tsx`, `evening.tsx`'s `RoomQueueCard` (both currently one outer `TouchableOpacity`). Does NOT apply to `TaskCard.tsx` (its outer shell is already a plain `View`, only inner buttons are pressable — see that file's pattern assignment above).
```tsx
<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={...}>
  <Card style={[styles.cardLayoutOverrides, isAlert && styles.cardAlertOverride]}>
    {/* existing internal content */}
  </Card>
</Pressable>
```

### `Alert.alert` → `useToast()` classification (D-04, applies to 6 files, 32 total calls)
**Rule:** confirm/choice dialogs (Yes/Cancel before a state-changing action) stay `Alert.alert`; outcome-reporting (success/error after the fact) converts to `Toast`. Only 2 of 32 calls stay `Alert.alert` — full call-by-call table already resolved in `08-RESEARCH.md` §"Alert.alert → Toast Classification" (cite directly, do not re-classify). The two survivors: `work-orders/[woId].tsx:250` (escalate confirm) and `FoundItemModal.tsx:79` (photo-source action sheet).

### i18n pass-through for gate-exempt files (D-06)
**Applies to:** `CreateWorkOrderModal.tsx`, `ReportIssueModal.tsx`, `SupplyRequestModal.tsx`, `tasks/index.tsx`. These stay excluded from `i18next/no-literal-string` this phase — pass existing hardcoded English strings straight into `Toast`/primitive `label` props as-is. Do not add new `t()` calls in these 4 files (Phase 9's job). Confirmed via `apps/mobile/eslint.config.mjs` (read during Phase 7's research) that the gate is `markupOnly: true` — string arguments to a `Toast` call are not flagged either way, so this introduces no new violations.

### `useTheme()` hook contract (applies to every one of the 17 files)
**Source:** `lib/theme/useTheme.ts` (per `08-RESEARCH.md`, verified against source):
```typescript
export function useTheme() {
  const mode = useThemeMode();          // ThemeProvider pins "light" this milestone (Phase 10 unlocks dark)
  return useMemo(() => getThemeTokens(mode), [mode]);
}
```
Returns the exact `lightTheme` shape (`tokens.ts:67-86`, full object read this session) — reactive, memoized on mode.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner guidance |
|---|---|---|---|---|
| `CreateWorkOrderModal.tsx`, `ReportIssueModal.tsx`, `SupplyRequestModal.tsx`, `KnockModal.tsx`, `FoundItemModal.tsx` (full-shell pattern only) | component/modal | request-response | No modal in this codebase has been migrated to Phase 7 primitives yet — Phase 7 touched zero modals. Sub-patterns (Button, Toast) have analogs; the overall modal-shell-on-primitives pattern does not. | Use `components/ui/Button.tsx` for actions and the `Alert.alert`→`Toast` classification above; there is no existing "migrated modal" to copy the outer container structure from — the modal's own existing `Modal`/overlay wrapper stays untouched (out of scope, presentation-layer-only per D-03/D-05), only its internal buttons/chips/colors migrate. |
| `ChecklistSection.tsx` (pass/fail status vocabulary) | component/section | presentational | RESEARCH.md didn't fully enumerate this file's internal status branching — unclear which `StatusKey`s (if any) its checklist pass/fail states should map to. | Read the file in full during planning before assigning `StatusBadge` keys; do not force-fit an ambiguous status onto an ill-matching `StatusKey`. |

---

## Metadata

**Analog search scope:** `apps/mobile/components/ui/` (all 5 primitives, full reads), `apps/mobile/lib/theme/` (per `08-RESEARCH.md`, already verified against source in that research pass), `apps/mobile/components/shared/tokens.ts` (full read), `apps/mobile/components/engineering/WorkOrderCard.tsx` (full read), `apps/mobile/components/tasks/TaskCard.tsx` (full read), `apps/mobile/components/shared/evening.tsx` (full read).
**Files scanned (full read this session):** `Button.tsx`, `Card.tsx`, `StatusBadge.tsx`, `StateBlock.tsx`, `EmptyState.tsx`, `tokens.ts`, `WorkOrderCard.tsx`, `TaskCard.tsx`, `evening.tsx`.
**Files scanned (verified via `08-CONTEXT.md`/`08-RESEARCH.md`, not re-read — already HIGH-confidence direct-repo reads from the research pass):** all 7 screen files, all 6 modal files, `ChecklistSection.tsx`, `useTheme.ts`, `useToast.ts`, `ThemeProvider.tsx`, `ToastProvider.tsx`.
**Pattern extraction date:** 2026-07-29
