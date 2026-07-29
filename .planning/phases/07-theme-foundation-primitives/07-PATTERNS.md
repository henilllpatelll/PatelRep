# Phase 7: Theme Foundation & Primitives - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 13 (9 new, 4 modified)
**Analogs found:** 11 / 13 (2 providers have no existing analog — new patterns)

All paths below are relative to `apps/mobile/` unless noted. Import alias `@/` = `apps/mobile/`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/theme/useTheme.ts` (NEW) | hook | transform | `components/shared/tokens.ts` `getThemeTokens` | exact (data already exists) |
| `lib/theme/ThemeProvider.tsx` (NEW) | provider | event-driven (system scheme) | none — see "No Analog" | none |
| `lib/theme/ToastProvider.tsx` (NEW) | provider | pub-sub (imperative queue) | `components/shared/OfflineBanner.tsx` (top-of-screen inline) | partial (placement only) |
| `lib/theme/useToast.ts` (NEW) | hook | pub-sub | none — see "No Analog" | none |
| `components/ui/Button.tsx` (NEW) | component/primitive | request-response (onPress) | `mobileHandoff.tsx` `HeroButton` + `WorkOrderCard` claimBtn | role-match |
| `components/ui/Card.tsx` (NEW) | component/primitive | presentational | `evening.tsx` `RoomQueueCard` `styles.card` | exact (extract) |
| `components/ui/EmptyState.tsx` (NEW) | component/primitive | presentational | `evening.tsx` `SectionHeader` + `Chip` | role-match |
| `components/ui/StateBlock.tsx` (NEW) | component/primitive | presentational (status branch) | `WorkOrderCard` `ActivityIndicator` claim path | role-match |
| `components/ui/StatusBadge.tsx` (NEW) | component/primitive | presentational | `WorkOrderCard` urgentChip + `evening.tsx` `STATUS_META`/`StatusPill` | exact |
| `components/shared/mobileHandoff.tsx` `IconButton` (MODIFIED) | primitive | presentational | itself (`mobileHandoff.tsx:105`) | in-place theme-wire |
| ESLint config (NEW, mobile) | config | n/a | `apps/web/eslint.config.mjs` | exact |
| `app/_layout.tsx` (MODIFIED) | layout | n/a | itself (`app/_layout.tsx:134`) | mount point |
| `app/(app)/_layout.tsx` (MODIFIED) | layout | n/a | itself (`app/(app)/_layout.tsx:80`) | mount point |

---

## Pattern Assignments

### `lib/theme/useTheme.ts` (hook, transform)

**Analog:** `components/shared/tokens.ts` — the token DATA and mode resolver already exist; the hook is a thin reactive wrapper. **Do not rebuild tokens.**

**Existing resolver to call** (`tokens.ts:111-115`):
```typescript
export type ThemeMode = "light" | "dark";

export function getThemeTokens(mode: ThemeMode = "light") {
  return mode === "dark" ? darkTheme : lightTheme;
}
```

**Theme object shape the hook returns** (keys screens/primitives read — `tokens.ts:67-109`). Note light/dark are NOT key-identical: `lightTheme` has `surfaceSubtle`; `darkTheme` has `surfaceElevated`/`glass`/`glassBorder`. Nested `status`, `ai`, `shell` sub-objects present on both:
```typescript
// lightTheme keys: background, surface, surfaceSubtle, surfaceMuted,
//   textPrimary, textSecondary, textMuted, border, borderSubtle,
//   primary, primaryAction, primarySoft, primaryLine, accentBrass, accentClay,
//   shell, ai, status
// status sub-object = statusTokens (light) / darkStatusTokens (dark)
```

**Hook pattern to write** (memoize on mode per Pitfall 5 / D-51; ARCHITECTURE.md:161-164):
```typescript
export function useTheme() {
  const mode = useThemeMode();               // from ThemeProvider context
  return useMemo(() => getThemeTokens(mode), [mode]);
}
```

**Phase-7 constraint:** ThemeProvider forces `mode = "light"` this phase (dark toggle is Phase 10). `useTheme()` still resolves reactively so no second touch is needed later.

---

### `lib/theme/ThemeProvider.tsx` (provider, event-driven)

**Analog:** none — no React Context provider exists anywhere in `apps/mobile/`. State today lives in Zustand `appStore`. Build fresh, but obey these grounded constraints:

- **Placement:** wrap the existing `<Stack>` in `app/_layout.tsx` as a sibling ABOVE it, NOT tangled into the auth/NetInfo effects (Pitfall 5). Current root render (`app/_layout.tsx:134-142`):
```tsx
return (
  <>
    <StatusBar style="auto" />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  </>
);
```
- **Memoize the context `value`** with `useMemo` — a fresh object each render re-renders the whole tree over the busy auth/NetInfo/notification effects (Pitfall 5, Performance Traps table).
- **`useColorScheme` is currently used in ZERO app files.** Read it inside the provider component only (never module scope). Phase 7 keeps active mode pinned to `"light"` regardless of system value (zero visual change).
- **Do NOT add theme to `appStore`** this phase. The three existing `useEffect`s in `app/_layout.tsx` use `[]` / minimal deps — do not add theme to them.

---

### `lib/theme/ToastProvider.tsx` (provider, pub-sub) + `lib/theme/useToast.ts` (hook)

**Analog for placement:** `components/shared/OfflineBanner.tsx` (full file — renders INLINE, top of screen, not absolutely positioned):
```tsx
export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  if (isOnline) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}
// styles.banner: paddingVertical 6, alignItems center, width "100%", bg #EF4444
```

**Mount point** — `app/(app)/_layout.tsx:80-82`, the `OfflineBanner` renders first inside `styles.root` (`flex:1`):
```tsx
return (
  <View style={styles.root}>
    <OfflineBanner />
    <Tabs ... >
```

**Toast viewport MUST render directly BELOW `<OfflineBanner />`** inside this same `View` (D-01) — both stay visible, never overlapping. `ToastProvider` wraps the `(app)` subtree; the viewport sits as a sibling after `OfflineBanner`.

**`useToast()` contract** (D-04, ARCHITECTURE.md:183-187): returns `{ success, error, info }`, each takes an **already-translated** string (caller owns `t()`). Behavior: one toast at a time, new replaces current (D-03); auto-dismiss 3s success / 5s error (D-02); swipe-to-dismiss; tap does nothing (D-04). Build the queue from core RN (`Animated`, `PanResponder`) — **zero new deps** (Pitfall 3, STACK.md).

---

### `components/ui/Button.tsx` (primitive, request-response)

**Analog:** `mobileHandoff.tsx` `HeroButton` (lines 222-252) for structure; `WorkOrderCard` claimBtn (lines 181-199) for the loading/disabled pattern. **`HeroButton` is left untouched (D-05)** — `Button` is separate and general-purpose.

**HeroButton structure to mirror** (`mobileHandoff.tsx:222-252`):
```tsx
export function HeroButton({ children, icon, primary, onDark = true, onPress }) {
  const backgroundColor = primary ? C.accent : onDark ? "rgba(255,253,252,0.11)" : C.surface;
  const color = primary ? "#fff" : onDark ? C.paper : C.ink;
  return (
    <TouchableOpacity activeOpacity={0.84} onPress={onPress}
      style={[styles.heroButton, { backgroundColor }]}>
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[styles.heroButtonText, { color }]}>{children}</Text>
    </TouchableOpacity>
  );
}
// styles.heroButton: minHeight 48, borderRadius 13, paddingHorizontal 16,
//   flexDirection row, alignItems/justifyContent center, gap 6
// heroButtonText: fontSize 15, fontWeight "600"
```

**Loading state (no layout shift, D-07)** — lift from `WorkOrderCard:190-197`, spinner replaces label in-place:
```tsx
{claiming ? (
  <ActivityIndicator size="small" color={C.accent} />
) : (
  <><Ionicons name="hand-right-outline" size={14} color={C.accent} />
    <Text style={styles.claimText}>{t("workOrders.claim")}</Text></>
)}
```

**Phase-7 build notes:**
- Variants `primary`/`secondary`/`ghost`/`destructive` (D-06); sizes `sm`/`md`/`lg` (D-07). Map colors from `useTheme()`: primary→`theme.primaryAction`, destructive→`theme.status.dirty`, ghost→transparent bg.
- **`destructive` MUST use `theme.status.dirty`, never an inline hex** (Pitfall 9).
- **Tap target ≥44pt** — `HeroButton` uses `minHeight:48`, claimBtn `minHeight:44`. Keep `sm` ≥44 (UX Pitfalls table).
- **Style merge order: `style={[styles.base, variantStyle, sizeStyle, props.style]}`** — base first, caller last (Pitfall 6, code_context "Style merge order").
- **No hardcoded label default** — label/children caller-provided only (Pitfall 4, D-04 floor contract).

---

### `components/ui/Card.tsx` (primitive, presentational)

**Analog:** `evening.tsx` `RoomQueueCard` `styles.card` (lines 337-353) — the ad-hoc shell to extract:
```typescript
card: {
  position: "relative",
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: C.surface,
  borderWidth: 1,
  borderColor: C.line,
  borderRadius: R.lg,          // 16
  paddingLeft: 16,
  paddingRight: 12,
  shadowColor: C.ink,
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
},
cardDimmed: {                  // muted/exception variant precedent
  backgroundColor: C.surface2,
  borderColor: C.line2,
  shadowOpacity: 0, elevation: 0, opacity: 0.7,
},
```
`WorkOrderCard` `styles.card` (lines 205-221) is the same shell (shadowOpacity 0.05, paddingVertical 13, gap 10) — confirms this is a repeated pattern worth extracting.

**Phase-7 build notes:** keep static layout `StyleSheet.create`; pull colors (`backgroundColor`, `borderColor`, `shadowColor`) from `useTheme()` inline at render (`theme.surface`/`theme.border`/`theme.textPrimary`) — code_context "Inline color props over makeStyles rewrite", ARCHITECTURE.md:151-156. Merge order base-first (Pitfall 6). Card is a pure surface wrapper — takes `children` + optional `dimmed`/`style`.

---

### `components/ui/StatusBadge.tsx` (primitive, presentational)

**Analog:** `WorkOrderCard` icon+color chips (lines 95-110) + `evening.tsx` `STATUS_META`/`getStatusMeta`/`StatusPill` (lines 22-53). Formalizes the existing icon+color+label triplet (D-09) — NOT a new design.

**Room-status contract (`evening.tsx:22-36`)** — the canonical bg/fg/border mapping:
```typescript
export const STATUS_META: Record<string, StatusMeta> = {
  DIRTY:     { label: "Vacant Dirty",  bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  OCCUPIED:  { label: "Occupied Dirty",bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  PICKUP:    { label: "Pickup",        bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS:{label: "In Progress",   bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  CLEAN:     { label: "Submitted",     bg: C.infoSoft,    fg: C.info,    border: C.infoLine },
  INSPECTED: { label: "Ready",         bg: C.readySoft,   fg: C.ready,   border: C.readyLine },
  OOO:       { label: "Out of Order",  bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
};
export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status.replace(/_/g," "), bg: C.surface3, fg: C.ink3, border: C.line };
}
```

**StatusPill render (icon-dot + label, `evening.tsx:42-53`):**
```tsx
<View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
  <View style={[styles.statusDot, { backgroundColor: meta.fg }]} />
  <Text style={[styles.statusPillText, { color: meta.fg }]}>{label ?? t(...)}</Text>
</View>
```

**WO priority/SLA icon set to reuse (`WorkOrderCard:95-108`)** — the canonical Ionicons (D-09/D-10):
```tsx
isEmergency ? <Ionicons name="warning" size={9} color={C.alert} />
: isUrgent  ? <Ionicons name="flash"   size={9} color={C.alert} />
: low       ? <Ionicons name="arrow-down" size={9} color={C.ink4} />
// done badge: <Ionicons name="checkmark" size={16} color={C.ready} />  (line 173)
```

**Phase-7 build notes:**
- Single component, one `status`-key prop, covers BOTH families (room-status + WO priority/SLA) since both already share `statusTokens`/`darkStatusTokens` (D-10).
- **Always renders icon + label + color together — no icon-only/compact escape hatch** (D-11, guards UI-04 "never color alone").
- **Reads status colors through `useTheme()` → `theme.status` (resolves `statusTokens`/`darkStatusTokens`) from day one** (D-12) — makes it dark-correct before Phase 10. Never inline a status hex (Pitfall 9). `theme.status` keys: `ready`/`clean`/`dirty`/`occupied`/`pickup`/`outOfOrder` + `*Soft`/`*Line`.
- `WorkOrderCard` itself is NOT migrated to use this yet (Phase 8, D-09).

---

### `components/ui/EmptyState.tsx` (primitive, presentational)

**Analog:** no dedicated component today (screens hardcode "No rooms…" strings). Closest structural precedents: `evening.tsx` `SectionHeader` (lines 72-82, title+hint+action layout) and `Chip` (lines 93-115, icon+text+tone). Icon usage everywhere via `@expo/vector-icons` `Ionicons`.

**Phase-7 build notes:** icon + title + optional body + optional action `ReactNode`. **No English default strings** — all copy caller-provided/`t()` (Pitfall 4, D-04). Colors from `useTheme()` (`theme.textSecondary`/`theme.textMuted`). Center-aligned block; allow text wrap (ES strings 15-30% longer — Pitfall 4). Merge order base-first (Pitfall 6).

---

### `components/ui/StateBlock.tsx` (primitive, presentational — status branch)

**Analog:** the hand-rolled `ActivityIndicator` pattern (38 files, per ARCHITECTURE.md:36). Reference render — `WorkOrderCard:190-192`:
```tsx
{claiming ? <ActivityIndicator size="small" color={C.accent} /> : ...}
```

**Phase-7 build notes:**
- Prop `status: "loading" | "empty" | "error"`; renders `children` when data present (ARCHITECTURE.md:104). No new loading-UI design — same `ActivityIndicator` centralized (D-13); **skeleton loader explicitly deferred** (Deferred Ideas).
- Error state: icon + message + optional `onRetry`. If provided, render the new `Button` primitive for retry; if omitted, message only — no caller forced to wire retry (D-14).
- Empty state delegates to `EmptyState`. Spinner color from `useTheme()` (`theme.primaryAction`). All copy caller-provided (Pitfall 4).

---

### `components/shared/mobileHandoff.tsx` `IconButton` (MODIFIED — theme-wire only)

**Analog:** itself (`mobileHandoff.tsx:105-132`). Current implementation reads static `C` via `toneColors` (lines 30-44):
```tsx
export function IconButton({ icon, tone = "neutral", size = 36 }) {
  const colors = toneColors[tone];   // toneColors built from static C.*
  return (
    <View style={[styles.iconButton, { width: size, height: size, borderRadius: R.md,
        backgroundColor: colors.bg, borderColor: colors.line }]}>
      <Ionicons name={icon} size={size > 40 ? 18 : 16} color={colors.fg} />
    </View>
  );
}
```

**Phase-7 scope (D-08):** keep structure identical — ONLY swap the color source so tones resolve via `useTheme()` instead of the static `C` snapshot (build a theme-derived equivalent of `toneColors`). **No new variant/size surface.** IconButton uses a `View` (not pressable) today — do NOT change that here. `toneColors` maps to `C.*Soft`/`C.*`/`C.*Line`; the themed equivalent maps to `theme.status.*Soft` etc. (Pitfall 2: retire `C` on contact; Pitfall 9: status via theme). Tap target: callers size it — keep default reachable.

---

### Mobile ESLint `i18next/no-literal-string` gate (NEW config)

**Analog:** `apps/web/eslint.config.mjs` (lines 29-59) — the exact reference implementation to mirror (D-15/D-16, hard CI failure):
```js
{
  files: [ /* floor-facing dirs */ ],
  ignores: [ '**/*.test.*', '**/*.spec.*', /* English-only admin dirs */ ],
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': ['error', {
      markupOnly: true,
      'jsx-attributes': { include: ['aria-label', 'placeholder', 'title'] },
    }],
  },
}
```

**Phase-7 build notes:**
- Mobile currently has **NO ESLint config at all** — no `.eslintrc`/`eslint.config.*` exists in `apps/mobile/`, and no `lint` script in `package.json` (scripts: start/android/ios/web/type-check/test only). This phase adds both the config and a `lint` script.
- Plugin `eslint-plugin-i18next` is a **dev dependency** (web has it). Adding it is a devDep only — not a runtime dep, so it does NOT touch the Hermes/babel/EAS runtime fault line (Pitfall 3 concerns runtime deps). Still verify `npm install` emits no new peer errors beyond the known React 19 `legacy-peer-deps` ones.
- **Scope (D-15):** `components/ui/**` (the 4 new primitives) PLUS floor screens/components: `app/(app)/{my-rooms,room-board,room-status,work-orders,tasks,inspect}/**` and `components/{housekeeping,engineering,tasks}/**`. Non-floor screens deferred to Phase 9.
- `['error', …]` — hard fail, mirroring web exactly (D-16).

---

### `app/_layout.tsx` (MODIFIED — mount ThemeProvider) & `app/(app)/_layout.tsx` (MODIFIED — mount ToastProvider)

Mount points quoted above under ThemeProvider and ToastProvider. Both are **surgical wrapper insertions** — do not alter the existing auth/NetInfo/notification effects (Pitfall 5) or the `Tabs`/`roleTabs` registration (Pitfall 8 — `roleTabs.ts` frozen this milestone).

---

## Shared Patterns

### Theme color access (applies to ALL 5 new primitives + IconButton)
**Source:** `components/shared/tokens.ts` `getThemeTokens` (line 113) via new `useTheme()`.
**Rule:** keep static layout in `StyleSheet.create`; pull ONLY colors inline from `useTheme()` at render — `style={[styles.base, { backgroundColor: theme.surface }]}`. Never reference `C.*` or a hex inside a new primitive's `StyleSheet.create` (Pitfall 1 frozen-stylesheet, Pitfall 2 dual-source). Precedent: `evening.tsx`/`mobileHandoff.tsx` already pass `{ backgroundColor: meta.bg }` inline.

### Style merge order (applies to ALL 5 new primitives)
**Rule (Pitfall 6):** `style={[styles.base, variantStyle, sizeStyle, props.style]}` — base first, caller `style` LAST. Prefer explicit variant props over ad-hoc overrides.

### Status color contract (applies to StatusBadge, Button destructive, IconButton status tones)
**Source:** `statusTokens`/`darkStatusTokens` (`tokens.ts:9-35`), resolved via `theme.status`.
**Rule (Pitfall 9):** all status coloring routes through `theme.status.*`; core hues identical to web; never inline a status hex. Dark uses the `*Soft` alpha fills already in `darkStatusTokens`.

### i18n floor contract (applies to ALL primitives with user-facing text)
**Source:** `react-i18next` `useTranslation`/`t()` — used pervasively (`evening.tsx:5`, `WorkOrderCard:5`).
**Rule (Pitfall 4, D-04):** primitives take ONLY caller-provided strings / `ReactNode` — no English defaults. Translation stays in the caller. Allow wrapping; no fixed single-line heights that clip longer ES strings.

### Icon system (applies to Button, StatusBadge, EmptyState, StateBlock)
**Source:** `@expo/vector-icons` `Ionicons` — the only icon lib, already installed. Type icon props as `React.ComponentProps<typeof Ionicons>["name"]` (`mobileHandoff.tsx:110`). Zero new deps (Pitfall 3, STACK.md).

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner guidance |
|------|------|-----------|--------|------------------|
| `lib/theme/ThemeProvider.tsx` | provider | event-driven | No React Context provider exists in `apps/mobile/`; state lives in Zustand. `useColorScheme` used in zero files. | Build fresh from ARCHITECTURE.md Pattern 3 + Pitfall 5 constraints (memoized value, sibling wrapper, mode pinned light in P7). |
| `lib/theme/useToast.ts` / imperative queue in `ToastProvider.tsx` | hook/provider | pub-sub | No toast/snackbar system anywhere; app uses `Alert.alert` + `OfflineBanner`. | Build queue from core RN `Animated`/`PanResponder` (zero deps). Contract per D-01..D-04; placement per `OfflineBanner`. |

---

## Metadata

**Analog search scope:** `apps/mobile/components/shared/`, `apps/mobile/components/engineering/`, `apps/mobile/app/`, `apps/mobile/lib/`, `apps/web/eslint.config.mjs`.
**Files scanned (full read):** `tokens.ts`, `mobileHandoff.tsx`, `evening.tsx`, `WorkOrderCard.tsx`, `OfflineBanner.tsx`, `app/_layout.tsx`, `app/(app)/_layout.tsx`, `apps/web/eslint.config.mjs`, `apps/mobile/package.json`.
**Zero-new-dependency constraint confirmed:** all primitives + providers buildable from `react-native` core + already-installed `@expo/vector-icons`, `react-native-safe-area-context`, `react-i18next` (Pitfall 3, STACK.md).
**Pattern extraction date:** 2026-07-28
</content>
</invoke>
