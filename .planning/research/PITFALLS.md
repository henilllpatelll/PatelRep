# Pitfalls Research

**Domain:** Full UI/UX redesign (visual identity + IA/navigation + interaction patterns) of a live, production, multi-role B2B ops SaaS — Next.js 14 App Router, RBAC across 6 roles, CI-enforced i18n gate, WCAG AA dark mode, with one major surface (Housekeeping Room Status Board + Room Detail Drawer + Engineering Room Board) explicitly EXCLUDED but transitively dependent on in-scope shared primitives.
**Researched:** 2026-08-13
**Confidence:** HIGH (grounded in the actual repo: excluded surfaces' imports, the CSS-variable token layer, the i18n eslint rule, and role-gated Sidebar were all inspected directly)

---

## The single most important finding (read first)

The Room-Board exclusion is **not** clean. The three "untouched" surfaces are built ON TOP of components that ARE in scope. Verified imports:

| Excluded surface | Imports (all IN SCOPE for redesign) |
|---|---|
| `components/housekeeping/RoomStatusBoard.tsx` | `ui/Button` (Button, IconButton), `ui/primitives` (StatusDot), `housekeeping/RoomCard` |
| `components/housekeeping/RoomDetailDrawer.tsx` | `ui/Button`, `shared/LogFoundItemModal` |
| `components/engineering/EngineeringRoomBoard.tsx` | `ui/Button`, `ui/primitives` (StatusDot), `housekeeping/RoomCard` |

On top of that, **every** surface renders through the CSS-variable token layer in `app/globals.css` (`--paper`, `--surface`, `--ink`, and the status ramps `--ready`/`--caution`/`--alert`/`--info`/`--progress`/`--blocked`/`--ai`, each with `-soft`/`-line` variants) split across `:root` and `.dark`. Redesigning tokens or any of those four shared components (`Button`, `primitives`, `RoomCard`, `LogFoundItemModal`) changes the excluded surfaces **underneath them, invisibly**, without anyone editing an "excluded" file.

`RoomCard` is the sharpest trap: it lives in `components/housekeeping/` (looks like fair game for a housekeeping redesign) but is the shared visual unit for BOTH excluded boards. It must be treated as a frozen, excluded primitive despite its folder.

**Roadmap consequence:** tokens/foundation MUST be its own first phase, and that phase (plus every phase that touches `Button`, `primitives`, `RoomCard`, or `LogFoundItemModal`) MUST carry a dedicated Room-Board regression-check gate. This is stated explicitly again in the phase mapping at the bottom.

---

## Critical Pitfalls

### Pitfall 1: Partial-exclusion breakage via shared primitives ("the excluded surface breaks and no one edited it")

**What goes wrong:**
A phase redesigns `Button`, `StatusDot`/`primitives`, `RoomCard`, `LogFoundItemModal`, or the token layer. The diff touches zero files inside the excluded surfaces, so it reads as "safe." But the Room Status Board, Room Detail Drawer, and Engineering Room Board render through those exact primitives — so their buttons resize, their status dots recolor, their room tiles reflow, or their spacing shifts. The one surface that was contractually supposed to stay pixel-identical is now visibly (and possibly functionally — e.g., a changed `IconButton` hit-target on the realtime board) altered.

**Why it happens:**
"Excluded" is enforced at the file/route level ("don't edit `housekeeping/page.tsx`"), but dependency risk is transitive, not file-local. Reviewers check the changed files, not the render output of unchanged consumers. `RoomCard` living under `housekeeping/` actively misleads — it looks like an in-scope housekeeping component.

**How to avoid:**
- Produce an explicit **frozen-primitive list** in the foundation phase: `ui/Button`, `ui/primitives`, `housekeeping/RoomCard`, `shared/LogFoundItemModal`, and the token names the boards consume. Any change to these is a Room-Board-impacting change by definition and triggers the regression gate — no exceptions.
- For primitives that MUST evolve for the new design (Button will), use a **dual-verification rule**: the change is only "done" after a live Playwright/manual pass on `/housekeeping` (both board + drawer) AND the Engineering room board, screenshot-compared against a pre-redesign baseline.
- Prefer **additive variants over mutation**: add a new Button variant/prop for redesigned surfaces and leave the default that the boards use unchanged, rather than restyling the default. This lets the token/foundation phase move without touching the excluded render path at all.
- Capture **baseline screenshots of all three excluded surfaces (light + dark, at least 2 roles)** BEFORE any foundation work begins. Without a baseline you cannot prove "unchanged."

**Warning signs:**
- A PR/phase diff touches only shared components but its own Non-Regression checklist doesn't list the Room Boards as dependents.
- Someone says "RoomCard is just a housekeeping component, it's fine to restyle."
- Foundation phase completes with no baseline screenshots of the excluded surfaces captured.

**Phase to address:** **Foundation/tokens phase owns the freeze list + baseline capture.** Every per-section phase that imports a frozen primitive re-runs the Room-Board check. Final QA does a last pixel-diff of the three excluded surfaces against the original baseline.

---

### Pitfall 2: i18n gate regressions from new nav labels, empty states, and restructured copy

**What goes wrong:**
The redesign introduces new user-visible strings everywhere: restructured nav/IA labels, new section headers, new empty states, new tooltips, new drawer/modal copy. Each raw string trips `i18next/no-literal-string` and either (a) redlines CI so the phase can't merge, or (b) worse, gets "fixed" by wrapping in `t('some.key')` where the key doesn't exist in the ES locale — so CI passes but Spanish users see raw `missingKey` fallbacks or English bleed-through. IA restructuring also **orphans** old keys (nav sections that no longer exist) and **splits/renames** keys, so ES and EN drift out of parity.

**Why it happens:**
The i18n gate only proves "no raw literal in JSX" — it does not prove "the key exists in every locale" or "the translation is correct." Redesign copy is written in English in the component first; translation is treated as a cleanup afterthought, so there's a window where keys exist in EN only. IA changes delete/rename keys without a matching locale-file edit.

**How to avoid:**
- **Keys before components, both locales together.** In each per-section phase, add the new/renamed keys to BOTH `en` and `es` locale files as the first step, then build the component against them. Never let a component merge with an EN-only key.
- Add (or confirm) a **locale-parity check** to the phase-verify gate: EN and ES key sets must be identical (no missing, no orphaned). The existing `no-literal-string` rule does NOT do this — it's a separate check and should be run per section phase, not deferred to milestone audit.
- Treat **IA/nav label changes as a copy task with a translation deliverable**, not a styling task. When a nav group is renamed or merged, the old keys are deleted and new keys added to both locales in the same phase.
- Watch **dynamic/interpolated strings** (counts, room numbers, names in empty states like "No rooms for {{floor}}") — pluralization differs EN vs ES and is the most common silent bug.

**Warning signs:**
- CI green but a manual pass in ES shows English text or a raw key string.
- Locale files edited in only one language within a phase diff.
- New empty-state or nav copy added directly as JSX text and later "wrapped."

**Phase to address:** **Every per-section phase owns its own strings (keys added to both locales first).** Foundation phase owns adding the locale-parity check to the verify gate. Final QA does a full ES walkthrough of all 16 sections.

---

### Pitfall 3: Dark-mode WCAG AA contrast silently regresses under the new token system

**What goes wrong:**
The old token set passed WCAG AA in dark mode. The redesign introduces new tokens or new `-soft`/`-line`/`-ink` pairings (e.g., a new accent, a restyled Badge that puts `--ink-3` text on `--surface-2`, or a status pill using `--caution` text on `--caution-soft`). Individually each token looks fine in light mode, but a specific text-on-surface pairing in `.dark` drops below 4.5:1 (or 3:1 for large text/UI). Because the app has ~8 semantic status ramps each with 3 variants across `:root` AND `.dark`, the combinatorial surface is large and no one checks every pairing. It ships looking "designed" but fails accessibility for exactly the low-light night-shift housekeeper/engineer usage this app targets.

**Why it happens:**
Contrast is a property of a **foreground/background pair**, not a single color, and dark mode inverts the relationships so a pairing that's safe in light can fail in dark. Designers pick colors for aesthetics in light mode first; dark values are derived, not independently verified. QA "looks at it" rather than measuring, and the human eye tolerates 3:1 as "readable."

**How to avoid:**
- Build a **contrast matrix as a foundation deliverable**: every text token (`--ink`, `--ink-2/3/4`, `--accent-ink`) against every surface it's allowed to sit on (`--paper`, `--surface`, `--surface-2/3`, each status `-soft`), computed for BOTH `:root` and `.dark`. Any pair below AA is either fixed or explicitly banned (documented "never put ink-4 on surface-3").
- Automate it: a small script or axe/Lighthouse CI run in dark mode as part of the foundation phase-verify gate, so contrast is proven by tooling, not eyeballs. Contrast is deterministic — it should never reach manual QA as an open question.
- **Design dark tokens independently, don't auto-derive.** Verify status pills (the highest-density colored text in this app) in dark mode specifically.
- Re-run the contrast check in any per-section phase that introduces a NEW pairing (new component variant putting an existing text token on a new surface).

**Warning signs:**
- New tokens added to `:root` without a matching, independently-chosen `.dark` value.
- Contrast checked "by looking at it" instead of a measured ratio.
- A restyled Badge/pill/StatusDot with no dark-mode contrast note in its phase.

**Phase to address:** **Foundation/tokens phase owns the contrast matrix + automated dark-mode check in the verify gate.** Per-section phases re-run it whenever they add a new fg/bg pairing. Final QA does a dark-mode axe sweep across all sections.

---

### Pitfall 4: RBAC/role-nav regression from IA restructuring (wrong role sees/loses a nav item)

**What goes wrong:**
IA restructuring merges, splits, renames, or reorders nav groups. The `Sidebar` currently role-gates items (verified: ~22 role/guard references). When nav items are moved into new groups or a new "hub"/landing structure, the role condition attached to an item gets dropped, loosened, or attached to the wrong new container — so a `housekeeper` suddenly sees a `gm`-only Management ROI or Billing link, or a `front_desk` loses a link they need. Because the redesign's visible goal is "looks different," the reviewer's eye is on layout/color, not on "does each of 6 roles see exactly the right set." The route guard may still block the page server-side, but a visible-then-403 nav item is a real UX/trust regression, and if the guard was ALSO relying on nav-level hiding, it's a genuine exposure.

**Why it happens:**
Role conditions are per-item logic that's easy to lose when items are physically relocated in JSX during a restructure. Redesign QA is usually done as a single logged-in user (often GM/admin, who sees everything), so under-exposure and over-exposure to OTHER roles is invisible in the test session. "It's just navigation" hides that nav IS the access-surface for 6 distinct roles.

**How to avoid:**
- **Never rely on nav hiding for security** — confirm every route still has its server-side `require_role` guard independent of what the sidebar shows. IA restructuring must not become the access-control layer.
- Produce a **role × nav-item visibility matrix** (6 roles × every nav item) as an artifact, captured from the OLD app first (baseline), then re-verified against the redesigned nav. This is the acceptance test for any IA phase.
- **Test the IA redesign logged in as each of the 6 roles**, not just GM. Use the existing test-account approach per role; a GM-only walkthrough structurally cannot catch this class of bug.
- When moving an item, move its role condition WITH it in the same commit; treat an un-gated nav item as a build-breaking omission during review.

**Warning signs:**
- IA/nav phase verified only as one role (especially an admin/GM superset role).
- A nav item's role guard appears in the "before" diff but not the "after."
- New nav container/group added with no role condition on it.

**Phase to address:** **The IA/navigation-restructure phase owns the role×nav matrix and per-role walkthrough.** Foundation phase should establish the baseline matrix from the current app before any nav changes. Final QA re-verifies all 6 roles.

---

### Pitfall 5: Scope creep — "redesign" silently becomes behavior/workflow change

**What goes wrong:**
Mid-redesign of a section, someone notices the workflow is clunky and "while we're in here" changes what a button does, reorders a multi-step flow, changes a default, alters what data a page fetches, or "improves" an interaction into a genuinely different behavior. Across 16 feature sections this compounds: the milestone was scoped as visual+IA-only (no data/routing/RBAC behavior change), but ships as a partial, inconsistent feature-change milestone. Regressions appear in places no one thought to test because the change was framed as "just redesign." It also blows phase estimates and makes the "did we break anything?" question unanswerable, because you can no longer diff behavior against the old app — behavior itself moved.

**Why it happens:**
Redesign and re-thinking-the-workflow feel like the same activity when you're staring at a page. IA restructuring is legitimately in scope, and "IA" shades imperceptibly into "workflow," so there's no bright line. The temptation is strongest in operational screens where the old workflow has visible friction.

**How to avoid:**
- Write a **bright-line scope rule into every per-section phase**: allowed = layout, visual styling, component swap, nav placement, copy, empty/loading states. NOT allowed = changing what an action does, what's fetched, mutation payloads, route behavior, role behavior, or step order that changes outcomes. Anything in the second list is a separate follow-up ticket, not this milestone.
- Adopt a **"same inputs, same outputs" invariant per section**: after redesign, the same user action produces the same API call and same result as before. Make that an explicit phase-verify check (watch the network tab: the redesigned page should fire the same requests as the old one).
- Keep IA changes to **placement/grouping/labeling only** — moving where a thing lives in the nav or on the page, not changing what it does when used.
- Park every "while we're here" idea in a backlog list, don't action it in the redesign phase.

**Warning signs:**
- A "redesign" phase diff touches `lib/api/` clients, mutation payloads, route handlers, or store logic.
- Network requests on a redesigned page differ from the old page for the same action.
- Phase discussion includes "let's also fix how X works."

**Phase to address:** **Every per-section phase owns the scope bright-line and the same-inputs/same-outputs check.** Roadmap/foundation phase owns writing the bright-line rule once and referencing it in all section phases. Milestone audit confirms no behavior drift.

---

### Pitfall 6: Long-running half-old/half-new state confuses live production users

**What goes wrong:**
Because this ships incrementally across many phases (not big-bang), production spends weeks in a mixed state: some sections redesigned, some old. Users hit an app where the sidebar/shell is new but a section is old (or vice versa), spacing/typography/component styles differ section-to-section, and — worst — a shared primitive got its new look in the foundation phase, so EVERY old-but-not-yet-redesigned section suddenly looks subtly broken (mismatched buttons/cards) even though those sections weren't touched. On a tool that hotel staff use every shift, "the app looks half-broken" reads as an outage and generates support noise.

**Why it happens:**
Incremental rollout of a token/foundation change is globally visible the moment it merges, but per-section polish lands over weeks — so the foundation change "gets ahead" of the sections. Teams underestimate how jarring intra-app inconsistency is for daily power users (vs. first-time visitors who don't have an old mental model).

**How to avoid:**
- **Sequence foundation to be visually backward-compatible, or gate it.** Two viable strategies: (a) the token/primitive redesign is built so old sections still look coherent (evolve tokens conservatively, add new variants rather than restyling defaults every section uses), OR (b) put the full redesign behind a **per-tenant/per-user feature flag** so production users don't see the mixed state until a section is fully done — internal QA sees it, users flip when a coherent slice is ready.
- **Batch sections into coherent shippable slices** (e.g., all housekeeping-adjacent sections together) rather than shipping one arbitrary section at a time, so any given user's primary workflow is either all-old or all-new, not split mid-flow.
- **Communicate** a visible "new look rolling out" note if a mixed state is unavoidable, so staff read it as intentional, not as breakage.
- Order the roadmap so the **shell/nav (always-visible) changes land near the end** or behind the flag — changing the global chrome first maximizes the half-broken window.

**Warning signs:**
- Foundation/token phase merges to production and old sections immediately look "off."
- No feature flag and no batching strategy in the roadmap — sections listed as 16 independent ship-it phases.
- Support tickets about the app "looking broken" after a foundation deploy.

**Phase to address:** **Roadmap/foundation phase owns the rollout strategy (flag vs. backward-compatible tokens, and section batching).** Each per-section phase respects the batching. Final QA verifies cross-section visual consistency once all slices are in.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Restyle the DEFAULT `Button`/`RoomCard`/`primitives` in place instead of adding new variants | Less code, one component to maintain | Silently mutates the excluded Room Boards; every old section shifts mid-rollout | Never — these are the frozen shared primitives; use additive variants |
| Wrap redesign copy in `t()` keys now, translate ES "later" | Unblocks CI immediately | ES users get raw keys/English in production; keys drift out of parity | Never — add both locales in the same phase |
| Verify dark-mode contrast "by eye" | Fast, no tooling setup | AA failures ship; night-shift users can't read status pills | Only for a throwaway prototype, never for a phase that ships |
| Test IA/nav changes as GM/admin only | One login, fast | Under/over-exposure to the other 5 roles ships invisibly | Never for nav/RBAC-adjacent changes |
| Ship sections one-at-a-time with no batching/flag | Simple phase list | Weeks of half-old/half-new confusion for daily users | Only with backward-compatible tokens so old sections stay coherent |
| Skip pre-redesign baseline screenshots of excluded surfaces | Saves an hour up front | Can't prove the Room Boards are unchanged; regressions undetectable | Never — baseline is the whole enforcement mechanism for the exclusion |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Realtime surfaces (the 3 excluded boards) | Assuming "no realtime code changed = board unaffected" | Realtime data is fine; the RISK is the shared visual primitives/tokens the board renders through — verify the rendered board, not the subscription |
| `eslint-plugin-i18next` gate | Treating green CI as "i18n done" | Gate only proves no raw literals; add a separate EN/ES key-parity check per phase |
| CSS-variable token layer (`:root`/`.dark`) | Editing `:root` tokens without the matching `.dark` value | Every token change is a paired light+dark change with a contrast re-check |
| Route guards (`require_role`) vs. sidebar nav | Letting nav visibility act as access control during IA restructure | Keep server-side `require_role` authoritative; nav hiding is UX only, never the security boundary |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Heavier redesigned components on the realtime Room Boards | Board jank/re-render lag during live updates | Keep frozen primitives lightweight; profile the board if a shared primitive gains animation/shadow/layout cost | High-churn hotels with frequent room-status updates |
| New global CSS/animations (PageTransition, shadows, blur) applied app-wide | Sluggish nav on low-end staff phones/tablets | Scope expensive effects; test on a representative low-end device, not a dev laptop | Field devices, not the dev machine |
| Large icon/font/token bundle added in foundation | Slower first paint across every section at once | Audit bundle delta in the foundation phase; subset fonts/icons | Immediately on foundation deploy (global) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| IA restructure drops a nav item's role gate | Wrong role sees a link to a restricted section (trust/exposure) | Role×nav matrix verified per role; server `require_role` remains authoritative |
| Redesign relies on nav-level hiding to "protect" a route | If server guard was ever loosened, restructure exposes the route | Confirm every route's server-side guard independent of nav during the IA phase |
| New copy/empty-states leak tenant or role-specific data into shared components | Cross-tenant/role info bleed via a "generic" redesigned component | Keep tenant/role scoping in the data layer; redesigned components stay presentational |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Redesigning the always-visible shell/nav first | Every user's mental model breaks before any section is polished | Land shell/nav late or behind a flag; redesign leaf sections first |
| Half-old/half-new sections in the same workflow | Daily staff perceive an outage | Batch sections into coherent slices; flag until a slice is complete |
| New empty/loading/error states missed on redesigned sections | Blank or ugly screens exactly when things go wrong | Every section phase explicitly redesigns empty/loading/error, not just the happy path |
| Muscle-memory breakage from moved actions | Power users (housekeepers/engineers doing this every shift) slow down | Preserve action placement where possible; if IA moves it, that's a deliberate, communicated change |

## "Looks Done But Isn't" Checklist

- [ ] **Excluded Room Boards:** Often missing a post-change render check — verify all 3 (Housekeeping board + drawer, Engineering board) look/behave pixel-identical to baseline in light AND dark, after ANY frozen-primitive or token change.
- [ ] **New copy:** Often missing the ES translation — verify every new key exists in BOTH `en` and `es`, and walk the section in Spanish.
- [ ] **Dark mode:** Often missing measured contrast — verify every new fg/bg pairing hits AA (4.5:1 text / 3:1 UI) in `.dark`, by tool not by eye.
- [ ] **RBAC nav:** Often missing per-role verification — verify all 6 roles see exactly the right nav set after IA changes, not just GM.
- [ ] **Behavior invariant:** Often missing a network-diff — verify the redesigned page fires the same API calls / same outcomes as the old page for the same action.
- [ ] **Empty/loading/error:** Often only the happy path is redesigned — verify empty, loading, and error states got the new treatment too.
- [ ] **Orphaned i18n keys:** Often missing cleanup after IA rename — verify no dangling keys and EN/ES parity holds.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Excluded Room Board broken by a shared-primitive change | MEDIUM | Revert the primitive to additive-variant approach; restore default the board uses; re-verify against baseline |
| ES i18n regression shipped | LOW | Add missing keys to `es`, redeploy; add key-parity check to gate so it can't recur |
| Dark-mode AA failure shipped | LOW-MEDIUM | Fix the failing token pairing (paired light+dark), re-run contrast tool; add automated check to foundation gate |
| Wrong role sees/loses nav item | MEDIUM | Restore the role condition on the moved item; confirm server guard; re-run role×nav matrix for all 6 roles |
| Scope crept into behavior change | HIGH | Hard to unwind once merged — split the behavior change into its own ticket, revert behavior to old app, keep only the visual/IA delta |
| Half-old/half-new confusion in prod | MEDIUM | Introduce a feature flag retroactively or fast-track the remaining sections in a batch; post a "new look rolling out" notice |

## Pitfall-to-Phase Mapping

**Recommended phase ordering this research implies:**
1. **Foundation/tokens phase FIRST and standalone** — owns: freeze list (`Button`, `primitives`, `RoomCard`, `LogFoundItemModal` + board tokens), baseline screenshots of all 3 excluded surfaces (light+dark, ≥2 roles), the dark-mode contrast matrix + automated check, the EN/ES key-parity check added to the gate, the role×nav baseline matrix, and the rollout strategy (flag vs. backward-compatible tokens + section batching). It must exit with a **Room-Board regression gate** proving the excluded surfaces are unchanged.
2. **IA/navigation-restructure phase** — owns the role×nav re-verification across all 6 roles; keep it separate from cosmetic section work so RBAC risk is isolated and reviewable.
3. **Per-section phases (the 16 sections, batched into coherent slices)** — each owns its own strings-in-both-locales-first, its same-inputs/same-outputs behavior check, its dark-mode contrast re-check for new pairings, and a Room-Board regression re-check IF it touches a frozen primitive.
4. **Final QA phase** — owns full 6-role walkthrough, full ES walkthrough, dark-mode axe sweep, cross-section visual-consistency check, and final pixel-diff of the 3 excluded surfaces vs. the original baseline.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Partial-exclusion breakage | Foundation (freeze list + baseline) + every phase touching a frozen primitive | Pixel-diff all 3 excluded surfaces (light+dark) vs. pre-redesign baseline |
| 2. i18n gate regression | Every per-section phase (keys first, both locales); Foundation adds parity check | EN/ES key parity + manual ES walkthrough of the section |
| 3. Dark-mode AA regression | Foundation (contrast matrix + automated check); per-section for new pairings | Automated dark-mode contrast/axe run, ratios recorded |
| 4. RBAC/role-nav regression | IA/navigation-restructure phase; Foundation captures baseline matrix | Per-role (all 6) nav walkthrough vs. role×nav matrix; server guards confirmed |
| 5. Scope creep into behavior | Every per-section phase (bright-line rule); Roadmap writes it once | Network-diff: redesigned page fires same API calls / outcomes as old |
| 6. Half-old/half-new rollout | Roadmap/Foundation (flag + batching strategy) | Sections shipped in coherent slices; cross-section consistency check in Final QA |

## Sources

- Direct repository inspection (HIGH): imports of `RoomStatusBoard.tsx`, `RoomDetailDrawer.tsx`, `EngineeringRoomBoard.tsx`; the `:root`/`.dark` CSS-variable token layer in `app/globals.css`; `i18next/no-literal-string` rule in `eslint.config.mjs`; role-gating in `components/shared/Sidebar.tsx`; `darkMode: ['class']` in `tailwind.config.ts`.
- Project policy documents (HIGH): CLAUDE.md Non-Regression Policy, Self-Verification Policy, Current Scope (web-only, no web unit suite by convention), Realtime-scope note identifying the 3 realtime surfaces.
- Established practice for design-system/token migrations and WCAG AA contrast being a fg/bg-pair property that inverts under dark mode (MEDIUM — well-understood domain knowledge, not a single citable source).

---
*Pitfalls research for: full UI/UX redesign of a live, RBAC'd, i18n-gated, dark-mode-verified multi-role ops SaaS with a hard partial-exclusion*
*Researched: 2026-08-13*
