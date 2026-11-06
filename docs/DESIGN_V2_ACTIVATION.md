# Design System V2 — per-hotel activation and rollback

Design V2 is switched on **one hotel at a time** with the registered `design_v2` tenant feature flag, for the manager web app and all seven mobile roles. It is **off for every hotel by default**, and nothing in this change turns it on in production.

It reuses the existing system and adds no second one: the `tenant_feature_flags` table, `GET /auth/me` → `hotel.enabled_features`, and the **Feature Rollout** workflow. See [FEATURE_FLAGS.md](FEATURE_FLAGS.md) for the general mechanism.

| | |
|---|---|
| Flag key | `design_v2` (`release`, `backend_enforced: false`) |
| Registered in | `apps/api/core/feature_registry.py`, `apps/web/lib/featureRegistry.ts` (parity checked by `scripts/check-feature-flag-registry.mjs`) |
| Effect | Presentation only. It grants no permission, unlocks no capability, changes no route, guard, work order, inspection, task or offline behavior, makes **no AI call** and spends **no credit**. Nothing on the backend reads it (a test enforces that no router or service mentions it). |
| Default | OFF. A missing row, a disabled row, an unknown state and a database error all mean OFF. |

## Enable it for one hotel

1. Run **Feature Rollout** (Actions → *Feature Rollout* → *Run workflow*):
   `environment` = `staging` first, then `production`; `tenant_slug` = the hotel's exact slug; `feature_key` = `design_v2`; `enabled` = `true`.
2. The run validates the key against the registry, resolves the slug to exactly one tenant, upserts `tenant_feature_flags`, appends an audit row to `feature_flag_events` and prints that tenant's status.
3. Confirm: `node apps/web/scripts/feature-flag-status.mjs --tenant <slug>` (needs that environment's `SUPABASE_URL` / service-role key).
4. Ask someone at the hotel to reload the web app or bring the mobile app to the foreground (see "How web and mobile observe changes"), and verify with the checklist below.

## Disable it (rollback)

Run **Feature Rollout** with the same inputs and `enabled` = `false`. No code change, no rebuild, no redeploy, no store build, no OTA update. The API serves the new answer within ~15 seconds (in-process cache); each open client then reverts the next time it reads its hotel context (below). It is **not instant** for an open session.

## How web and mobile observe flag changes

Both read the same field, `hotel.enabled_features` from `GET /auth/me`, for the **signed-in person's current hotel**. Neither persists the answer, and both treat anything they cannot prove as legacy.

V2 is shown only when **all** hold: a person is signed in · the hotel context was read **for that person and that hotel** · it contains `design_v2` · the read is **at most 30 minutes old**.

| | Web | Mobile |
|---|---|---|
| First read | After sign-in / page load (`Providers.tsx`) | On entering the signed-in layout (`useDesignV2Sync`) |
| Refresh | Tab becomes visible or the network returns (skipped if the last attempt was < 2 min ago), every 10 min while visible, and after every token refresh | App returns to the foreground or the network returns (same 2 min gap), every 10 min while foregrounded |
| Refresh scope | Hotel context only; it never touches the role, name or schedule | Hotel flag only |
| Flag turned **off** while open | Next refresh swaps back to the legacy shell; every page below remounts and re-reads | Next refresh re-themes the signed-in tree live (no restart) |
| Flag turned **on** while open | Next refresh swaps in V2 | Next refresh re-themes live |
| Offline / API failing | Keeps the last answer for at most 30 min from its last successful read, then reverts to legacy by itself | Same |
| Sign out | Cleared immediately | Cleared immediately |
| Different person or hotel | The previous answer is discarded before the next is read; legacy until proven | Same (cleared synchronously in the app store) |
| Cold start | Legacy until `/auth/me` returns (typically well under a second) | Legacy until `/auth/me` returns |

Worst-case time for an open, online session to notice a change: **~10 minutes** unattended, usually seconds (focus / foreground triggers it). An offline session reverts after at most 30 minutes. Reloading the page, restarting the app or signing out and in reads immediately. The `/auth/*` rate limit (10/min per user) is far above this cadence; a 429 or any failure is simply "no new information".

### Limitations (read before relying on it)

- **Not instant.** Do not promise a hotel an immediate switch; promise "within about ten minutes, or on next reload or app open".
- **Signed-out screens are never tenant-aware.** The web sign-in page and the mobile login stack cannot know the hotel yet, so they stay legacy for tenant activation. They are V2 only on a development preview build.
- **A brief legacy flash on cold start** for an enabled hotel (until the first read lands).
- **Mobile typography is live (no longer a limitation).** Sentence-case labels, no tracking, the 12 pt floor, and the system sans with tabular digits in place of IBM Plex Mono / Instrument Serif all follow the hotel's flag at render time; see "Mobile typography" below. Two things are intentionally not covered: print/QR labels (`assets/label/[assetId].tsx`, literal uppercase) and the signed-out screens (no hotel known yet).
- **Mobile first paint** on an enabled hotel is the legacy design until the first read lands; nothing is cached across launches on purpose (a cache would be a second source of truth and could show the last user's design).

## Mobile typography

Typography used to be decided when the JavaScript bundle loaded, before anyone signed in, so a tenant-activated phone kept the legacy label casing and mono/serif fonts. Nothing tenant-dependent is evaluated at module initialization any more.

- `lib/design/reactiveTypography.ts` — `createTypographyStyles((t) => ({ … }))` builds **both** variants of a static sheet once, from pure flag-free inputs (`t.labelCase`, `t.tracking()`, `t.labelSize()`, `t.mono`, `t.serif`), and returns a hook that picks one at render time from the enclosing `<DesignV2Scope>` (`useIsDesignV2`), the same source the colors, tokens and `useV2Text()` overlays use. `useTypography()` does the same for sheets built inside a component (`useMemo(() => makeStyles(theme, typo), [theme, typo])`).
- Legacy output is the previous static sheet, value for value. V2 output: `textTransform: none`, `letterSpacing: 0`, size never below 12, system sans (explicit platform family), and `fontVariant: ["tabular-nums"]` on every entry that used the mono face (system sans is proportional).
- `useDesignV2Active()` is now a shared live subscription (`useSyncExternalStore`): one module-level expiry timer for all subscribers, released when the last one unmounts, so offline expiry reverts a mounted tree without a timer per row.
- `monoFont` / `serifFont` in `components/shared/tokens.ts` are legacy constants that never read the flag; the few inline uses already layer `useV2Text().num`. `lib/design/microLabel.ts` is deleted.
- Toggling ON → OFF → ON re-styles mounted components in place: no remount, no restart, no `key` trick.
- Rule for new code: never call `isDesignV2Enabled()` or branch on the flag in a module-level constant or a static `StyleSheet.create`; use `createTypographyStyles` / `useTypography` / `useV2Text`. A contract test fails if a static `StyleSheet.create` references `monoFont`, `serifFont` or a micro-label helper, and if anything other than `designV2.ts` and `useDesignV2Active.ts` calls `isDesignV2Enabled()`.

Automated evidence is in `apps/mobile/__tests__/lib/design/reactiveTypography.test.tsx`: ON → OFF → ON on one mounted tree (legacy restored byte-for-byte, no remount) for all seven roles × light/dark, English and Spanish text untouched by the style layer, a real shared component (`SectionLabel` with its mono hint), account switching, hotel A/B switching, sign-out, offline expiry with fake timers, one shared timer for 40 subscribers, and the exemptions. It does **not** replace a device pass.

## Development preview (separate from production activation)

`NEXT_PUBLIC_DESIGN_V2_PREVIEW=true` (web) / `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true` (mobile) still exist for local and staging builds, and are the only way to see V2 on signed-out screens and on the `/design-v2-preview` reference routes. They **fail closed**: they need the flag **and** the dev server (`next dev` / Metro `__DEV__`) **or** an explicit `…_APP_ENV` of `development`, `staging` or `test`. An unset or unknown environment counts as production (the previous guard failed *open* when it was unset). The tenant flag ignores the environment variable entirely, so a production build can still serve a properly authorized hotel; and the tenant flag never turns on the preview-only routes.

## Existing mobile builds

No new binary and no OTA update is required for this to work *once a build that contains this code is installed*: the flag is read from the API at runtime. **Builds shipped before this change** contain no flag reader and the old bundle-time guard, so they stay legacy for every hotel regardless of the flag, which is safe. Rollout therefore reaches a phone only after that phone updates to a store build (or OTA) that includes this change.

**OTA safety.** `eas.json`'s build-profile `env` does not apply to a hand-run `eas update`. With the new rule an update exported with `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true` and no `EXPO_PUBLIC_APP_ENV` is **disabled** (a published bundle has `__DEV__ === false`), so an accidentally configured preview flag cannot enable V2 for installed apps. Tests pin this, that no EAS profile or workflow sets the preview flag, and that the production profile declares `EXPO_PUBLIC_APP_ENV=production`.

## Verify tenant isolation

Run the same check for at least two hotels with opposite states (for example staging fixtures A = on, B = off):

1. `node apps/web/scripts/feature-flag-status.mjs --feature design_v2` lists exactly the enabled tenants. Only the intended slug may appear.
2. Signed in as a user of hotel A: `GET /auth/me` → `hotel.enabled_features` contains `design_v2`. As a user of hotel B: it does not.
3. Web: A shows the V2 shell; B shows the legacy shell. Mobile: same, for each of the seven roles.
4. Sign out of A and into B on the **same** browser/device: B must be legacy from the first frame it renders (never A's design).
5. Disable A, refresh (or wait), confirm A reverts and B is unchanged.

## Recover from an incorrect rollout

- **Wrong hotel enabled:** run Feature Rollout `enabled=false` for that slug. Confirm with `feature-flag-status.mjs --tenant <slug>`. The audit trail is `feature_flag_events` (`change_source` includes the run id and actor).
- **Everyone must be reverted:** run `enabled=false` once per enabled slug from the `--feature design_v2` listing. There is deliberately no bulk or percentage mode.
- **A client still looks like V2:** it has not refreshed yet. Reload the web page / foreground the app; at most 30 minutes offline.
- **The flag is off but a hotel still sees V2:** check it is not a development-preview build (`…_DESIGN_V2_PREVIEW`), then check for a second flag row for the tenant with `feature-flag-status.mjs`.
- A flag cannot undo a code defect that is not behind it. The V2 work also contains accessibility fixes and bug fixes that ship ungated (see the audit); those need a normal code revert.

## Tests that must pass before any real production activation

Automated (all run in CI): API `tests/test_design_v2_flag.py`; web `lib/design/designV2Activation.test.ts` (plus the updated shell/remap/dialog contracts); mobile `__tests__/lib/design/designV2Activation.test.tsx`, `designV2Flag.test.ts` and `reactiveTypography.test.tsx`; the Feature Flag Registry Gate.

Still required by the owner and **not done by this change** (DEFERRED BY OWNER during implementation):

1. Physical iPhone **and** Android pass of the K.3 checklist in `PATELREP_DESIGN_V2_FINAL_AUDIT.md`, per role (7), light and dark, English and Spanish.
2. Screen-reader pass (VoiceOver, TalkBack, and a desktop screen reader for web).
3. A staging rehearsal with two fixture hotels in opposite states (the checks above), plus an enable → disable → confirm-legacy cycle through the real Feature Rollout workflow.
4. The open items B3 / G.3 / C.1 named in the audit.
5. Enable for **one** pilot hotel first; keep that hotel on it for a full shift cycle before widening.
