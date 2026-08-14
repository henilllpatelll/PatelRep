# FROZEN — Phase 30 Frozen-Primitive List (FOUND-02)

This is the human-readable companion to `apps/web/frozen-files.json` (the machine-readable manifest the CI guard built in Plan 30-05 consumes). It is the contract Phases 31-36 must read before touching shared UI: what is frozen, why, and how to legitimately extend it.

## Why this exists

Three surfaces — the Housekeeping `RoomStatusBoard`, `RoomDetailDrawer`, and the Engineering `EngineeringRoomBoard` — must render byte-identically throughout the v2.0 redesign (the phase exit gate). They're excluded from the redesign, but they aren't isolated: they consume shared primitives and read the global CSS token layer directly. Anything those primitives or tokens do gets inherited by the excluded boards for free — including an unintended visual change. So the freeze isn't just "don't edit these 3 files"; it's "don't edit anything they transitively depend on."

## Frozen files — NAME-frozen (component APIs)

Extend with new variants/props/names only. Never rename, remove, or mutate the behavior of an existing variant/prop/export. A legitimate change requires bumping the file's sha256 in `frozen-files.json` AND adding a reasoned entry to `frozen-files-allowlist.json` (mechanism built in Plan 30-05) — the reviewer sees the intent in the same PR.

| File | What the boards consume | Freeze rule |
|------|--------------------------|-------------|
| `apps/web/components/ui/Button.tsx` | `Button` variants `primary\|dark\|outline\|secondary\|ghost\|destructive\|ai`, sizes `sm\|md\|lg`; `IconButton` | Existing variant class strings + defaults frozen. Add `v2` variants/new sizes only. |
| `apps/web/components/ui/primitives.tsx` | `StatusDot` (`DOT_COLORS` map), `Pill` (`PILL_CLASSES` tones) | `StatusDot`/`Pill` tone→color maps frozen. Other exports (`Stat`, `Bar`, `AILabel`, `SectionLabel`, `Mono`) are additive-safe but touching them re-runs the board pixel-diff gate. |
| `apps/web/components/housekeeping/RoomCard.tsx` | Rendered by BOTH the housekeeping and engineering boards; owns 4 status→color maps | Entire component frozen. Lives in `housekeeping/` but is an exclusion-boundary primitive — engineering's board depends on it too. |
| `apps/web/components/shared/LogFoundItemModal.tsx` | Imported by `RoomDetailDrawer` | Frozen (transitive dependency of an excluded surface). |
| `apps/web/components/housekeeping/RoomStatusBoard.tsx` | Excluded surface itself | Never edit. |
| `apps/web/components/housekeeping/RoomDetailDrawer.tsx` | Excluded surface itself | Never edit. Mostly hardcoded Tailwind palette (`stone-*` etc.), so token changes are insulated except through `Button`. |
| `apps/web/components/engineering/EngineeringRoomBoard.tsx` | Excluded surface itself | Never edit. |

## Frozen tokens — NAME-frozen (all existing token names + every Tailwind alias)

The boards + `RoomCard` read these CSS custom properties and Tailwind aliases inline. The redesign adds new names alongside them; it never renames or removes any of these:

```
--paper --surface --surface-2 --surface-3 --line --line-2
--ink --ink-2 --ink-3 --ink-4
--accent --accent-soft --accent-line --accent-ink
--ai --ai-soft --ai-line
--alert --alert-soft --alert-line
--ready --ready-soft --ready-line
--caution --caution-soft --caution-line
--info --info-soft --info-line
--progress --progress-soft --progress-line
--blocked --blocked-soft --blocked-line
--r-sm --r-md --r-lg --r-xl
--shadow-sm --shadow-md --shadow-lg --shadow-pop
```

Plus every Tailwind color/shadow/radius alias in `tailwind.config.ts` as of Phase 30 (paper, surface/surface-2/surface-3, line/line-2, ink family, accent family, ready/caution/alert/info/progress/ai families, the `status.*`/`risk.*` objects, `boxShadow.sm/card/card-hover/pop/sidebar`, `borderRadius.sm/md/lg/xl`). The "Legacy compat" aliases (`--color-bg`, `--color-surface`, `--color-surface-2`, and the `bg`/`surface2Old` Tailwind aliases) must also be preserved — some older components still read them.

New tokens added this phase (`--motion-*`, `--ease-*`, `--z-*`, `--surface-raised`, `--surface-overlay`, `--shadow-xs`, `--brand*`, `--focus-ring`, and their matching Tailwind aliases) are additive and carry no freeze themselves — they can evolve freely in later phases, they're just new.

## Room-status HARD CONSTRAINT — VALUE-frozen (tag: `room-status`)

These specific token **values** (not just names) encode room cleanliness state. Staff are trained on these exact colors. They can never change, in `:root` or `.theme-dark`, anywhere they render — not only inside the 3 excluded board files, but in any redesigned chrome that later shows a room-status color (legend, filter chip, a "my rooms" list in Phase 36, etc). **This has no allowlist escape.** A value change here is always a hard CI failure once Plan 30-05's guard lands.

| Room status | Tokens (frozen at value) | Light hex | Dark hex |
|---|---|---|---|
| DIRTY, OCCUPIED | `--alert` / `--alert-soft` / `--alert-line` | `#a6263c` / `#f5d8de` / `#e8a8b3` | `#d96479` / `#2e1620` / `#5a2a38` |
| CLEAN | `--info` / `--info-soft` / `--info-line` | `#265d8a` / `#d8e6f0` / `#a8c2d8` | `#5b9bd5` / `#182a3d` / `#34557a` |
| INSPECTED | `--ready` / `--ready-soft` / `--ready-line` | `#0c6e63` / `#d6eae5` / `#a4cfc7` | `#4ab8a8` / `#14302d` / `#2d5550` |
| IN_PROGRESS | `--progress` / `--progress-soft` / `--progress-line` | `#7c3aed` / `#ede9fe` / `#c4b5fd` | `#a78bfa` / `#2e2348` / `#5b4a86` |
| PICKUP | `--caution` / `--caution-soft` / `--caution-line` | `#a16207` / `#f5e9cf` / `#e0c890` | `#d4a64a` / `#322811` / `#5a4920` |
| OOO / OUT_OF_ORDER / OUT_OF_SERVICE | `--blocked` / `--blocked-soft` / `--blocked-line` | `#57534e` / `#f5f5f4` / `#d6d3d1` | `#d6d3d1` / `#292524` / `#57534e` |

Also frozen at value (hardcoded hex duplicates, `tailwind.config.ts` `colors.status.*`): `inspected #0c6e63`, `clean #265d8a`, `in-progress #7c3aed`, `dirty #a6263c`, `oos #b8431c`, `vip #a16207`. `colors.risk.*` (`high`/`medium`/`low`) is **not** room-status and is explicitly un-frozen — task/work-order/risk-level colors are free to evolve in later section phases.

## Double-duty-token WARNING (Pitfall 2)

`--alert`, `--info`, `--caution`, `--ready`, `--progress`, and `--blocked` are **both** generic UI chrome tokens (used for alert banners, info callouts, etc. elsewhere in the app) **and** the room-status tokens above. Because the *value* is frozen, a later phase that wants a different generic "alert" or "info" color for redesigned non-room chrome **must introduce a brand-new token** (e.g. `--danger-v2`, `--info-v2`) — it must never re-tint `--alert`/`--info`/etc. in place, even for a context that has nothing to do with room status. Retinting any of these six tokens, for any reason, moves the DIRTY/CLEAN/etc. room colors too.

## How to legitimately change a frozen FILE later

1. Make the change.
2. Recompute the file's sha256 and update the value in `apps/web/frozen-files.json`.
3. Add a reasoned entry to `apps/web/frozen-files-allowlist.json` (built in Plan 30-05) naming the file, old/new hash, reason, and the phase that approved it.
4. Re-run the pixel-diff baseline (`playwright.regression.config.ts`) — if the change is visually inert for the 3 excluded boards (e.g. adding a new unused export), it should still pass zero-drift; if it changes rendering, the baseline screenshots themselves need a deliberate, reviewed re-capture, not a silent `--update-snapshots`.

There is no such path for the room-status VALUE-freeze — those six tokens' hex values do not change in this milestone.

## Deferred: primitive v2 variants

Adding new variants to a frozen file (e.g. `Button variant="v2"`) is explicitly **deferred to the phase that first needs it** — introduced then via the allowlist flow above, not speculatively now. This keeps all 7 frozen files byte-unchanged through the end of Phase 30 (confirmed: their `frozen-files.json` hashes were computed after Plan 30-04's token work and match the pre-redesign tree).

## Machine-readable source of truth

`apps/web/frozen-files.json` — sha256 per frozen file + the room-status value map (light+dark), consumed by the CI guard in Plan 30-05.
