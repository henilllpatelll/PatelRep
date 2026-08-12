# Phase 7: Theme Foundation & Primitives - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 7-Theme Foundation & Primitives
**Areas discussed:** Toast behavior & placement, Button/IconButton scope, StatusBadge convention, EmptyState/StateBlock + i18n gate scope

---

## Toast behavior & placement

| Option | Description | Selected |
|--------|-------------|----------|
| Top, below OfflineBanner | Overlays as a floating banner just below the inline OfflineBanner; both visible together, never overlap | ✓ |
| Bottom of screen | Android Snackbar-style; away from header but under one-handed thumb reach | |
| Top, overlay above everything | Toast wins the top slot; OfflineBanner pushed down/hidden | |

**User's choice:** Top, below OfflineBanner (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| 3s success / 5s error | Success confirms quickly, errors get more read time; swipe-to-dismiss early | ✓ |
| Fixed 4s for all types | Simpler timing constant; risks cutting off longer ES error text | |
| No auto-dismiss | Safest for readability; needs explicit close, risks toast pile-up | |

**User's choice:** 3s success / 5s error (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Replace — one visible at a time | New toast replaces current; matches old Alert.alert behavior | ✓ |
| Stack up to 2-3, queue rest | More visible history; more complexity and screen real estate | |

**User's choice:** Replace — only one visible at a time (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Purely informational, tap does nothing | Matches useToast() success/error/info string-only contract | ✓ |
| Tap dismisses immediately | Faster manual clear, small added interaction surface | |

**User's choice:** Purely informational, tap does nothing (recommended)
**Notes:** OfflineBanner renders inline (no absolute positioning today), confirmed via grep before asking — informed the position question's framing.

---

## Button/IconButton scope

| Option | Description | Selected |
|--------|-------------|----------|
| Leave HeroButton alone, Button is new/separate | Zero visual change scope; HeroButton callers untouched this phase | ✓ |
| Make Button a superset, deprecate HeroButton now | Hero variant matches HeroButton look, mark deprecated-on-contact | |

**User's choice:** Leave it alone, Button is new/separate (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| primary / secondary / ghost / destructive | Mirrors web's Button variant set | ✓ |
| primary / secondary only | Smaller surface now, risk of stopgap destructive-action need | |

**User's choice:** primary / secondary / ghost / destructive (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| sm/md/lg, spinner replaces label | Covers inline/standard/CTA sizes; no layout shift on loading | ✓ |
| Single size, spinner replaces label | Simpler, less primitive surface | |
| sm/md/lg, spinner + label both shown | Keeps label context, risks crowding on longer ES text | |

**User's choice:** sm/md/lg, spinner replaces label text (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep IconButton as-is, just theme-wire it | Already works; only needs useTheme() instead of static C | ✓ |
| Extend to Button's variant/size system | More consistency later, more work now | |

**User's choice:** Keep as-is, just theme-wire it (recommended)

---

## StatusBadge convention

| Option | Description | Selected |
|--------|-------------|----------|
| Formalize WorkOrderCard's existing pairing | Reuses the one place icon+color is already done well | ✓ |
| Design a fresh icon set | More design work, risks mismatch with WorkOrderCard until Phase 8 | |

**User's choice:** Yes, formalize WorkOrderCard's existing pairing (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Both room status and work-order states | Matches UI-04's "every room/work-order status" wording | ✓ |
| Room status only | Narrower scope, work-order badges added in Phase 8 | |

**User's choice:** Both room status and work-order states (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Always full (icon + label + color) | Guarantees "never color alone" can't be silently bypassed | ✓ |
| Allow icon-only compact variant | Useful for dense lists, risks violating color-never-alone intent | |

**User's choice:** Always full (icon + label + color) (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Wire via useTheme() now | Zero visual change today, already dark-mode-correct for Phase 10 | ✓ |
| Hardcode statusTokens, wire dark later | Simpler now, re-opens this file during highest-risk dark QA phase | |

**User's choice:** Wire it via useTheme() now (recommended)

---

## EmptyState/StateBlock + i18n gate scope

| Option | Description | Selected |
|--------|-------------|----------|
| Same ActivityIndicator, centralized | Zero new loading-UI design; matches what 38 files already do | ✓ |
| Upgrade to skeleton loader | Nicer perceived perf, beyond zero-visual-change scope for Phase 7 | |

**User's choice:** Same ActivityIndicator, just centralized (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Icon + message + optional onRetry prop | Covers both retry and pure-informational error screens | ✓ |
| Icon + message only, no built-in retry | Simpler now, likely re-invented per screen in Phase 8/9 | |

**User's choice:** Icon + message + optional retry callback prop (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| New components/ui/ + floor-facing screens | Matches web's D-03 scope and this phase's floor-first priority | ✓ |
| Whole apps/mobile/ app/ and components/ tree | Risks failing CI on pre-existing strings in untouched screens | |
| New components/ui/ only | Narrowest, slowest to reach full floor coverage | |

**User's choice:** New components/ui/ + all floor-facing screens (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Hard failure, mirrors web exactly | Matches I18N-01's success criteria explicitly | ✓ |
| Warning first, promote to hard failure in Phase 8 | Softer rollout, risks shipping English strings unnoticed | |

**User's choice:** Hard failure, mirrors web exactly (recommended)

---

## Claude's Discretion

- Exact file/folder layout inside `components/ui/` and `lib/theme/` — follow `.planning/research/ARCHITECTURE.md`'s recommended structure unless research/planning finds a reason not to.
- Additional memoization needs for the provider `value` beyond the standard `useMemo` pattern (Pitfall 5).
- Exact ESLint rule configuration/plugin choice for the mobile `no-literal-string` gate (web's config is the reference).

## Deferred Ideas

- Skeleton-loader `StateBlock` variant — deferred, not required for Phase 7's zero-visual-change scope.
- Extending `IconButton` to a full variant/size system — deferred until a screen genuinely needs it.
- `roleTabs.ts` duplicate `case "engineer"` cleanup — pre-existing lint smell, explicitly out of scope, opportunistic only.
- Non-floor-screen i18n lint gate coverage — deferred to Phase 9 as those screens migrate.
