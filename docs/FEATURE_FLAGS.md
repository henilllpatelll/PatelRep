# Feature flags

A tenant-scoped product feature-flag system so a feature can be deployed to production without being released to every hotel. **Deploy ≠ release**: code reaching production never changes a flag's value by itself.

This is release control, not LaunchDarkly. There is no dashboard, no percentage/random rollout, no realtime push to the browser. The rollout unit is always a hotel (tenant), never a user, session, or percentage — operational staff at the same property must see consistent behavior.

## What this is not

- Not a replacement for `tenants.web_redesign_sections` or `tenants.opera_pilot_enabled`. Those are left exactly as they are; nothing here migrates them.
- Not a GM-facing setting. Hotels cannot enable their own unreleased features — `PATCH /hotels/{id}` and `UpdateHotelRequest` deliberately never touch flags.
- Not a substitute for migration safety. A flagged feature's schema must still support old-code-OFF and new-code-ON simultaneously (EXPAND/CONTRACT, see [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md)). A flag controls *behavior*, not schema compatibility.

## Two categories of flag

| Category | Lifetime | Example | Notes |
|---|---|---|---|
| `release` | Temporary. Removed once fully rolled out. | `staging_flag_demo` | Default for anything new. |
| `entitlement` | Permanent access control. | `tenants.opera_pilot_enabled` | Not represented in `tenant_feature_flags` at all — it's its own column, by design. This category exists in the registry schema for future entitlement-style flags that *do* belong in the general table; it is documented here mainly to draw the distinction, not because an entitlement flag currently lives in `tenant_feature_flags`. |

A `release` flag that reaches 100% rollout and stays stable should eventually be deleted from the registry, the database rows, and the code branches that check it. A permanent capability (a contracted integration, a pilot entitlement) is the only case for leaving a flag in place indefinitely, and even then prefer the existing dedicated-column pattern (like `opera_pilot_enabled`) unless several such entitlements make a shared table clearly simpler.

## Schema

`supabase/migrations/203_feature_flags.sql` adds two tables:

- **`tenant_feature_flags`** — one row per `(tenant_id, feature_key)`. `enabled BOOLEAN NOT NULL DEFAULT FALSE`. **A missing row means the feature is OFF** — this is fail-closed by construction, never a special case in application code. Written only by the feature-rollout workflow's service-role client; the app API never writes to this table.
- **`feature_flag_events`** — append-only audit trail. `old_value` (nullable — `NULL` means there was no prior row, i.e. the prior state was fail-closed OFF), `new_value`, `changed_at`, `change_source` (e.g. `github-actions:feature-rollout:<run_id>:<actor>`, never a credential).

Neither table is part of `app_schema_readiness()`'s required-schema contract (`202_schema_readiness_contract.sql`) — a half-deployed state where the table doesn't exist yet is not a correctness risk, since every flag defaults OFF either way.

## Registry

Every valid feature key is declared in two hand-maintained files, kept in sync by `scripts/check-feature-flag-registry.mjs` (run in CI as the `Feature Flag Registry Gate` job):

- `apps/api/core/feature_registry.py`
- `apps/web/lib/featureRegistry.ts`

Keys are lowercase `snake_case` and describe a user-facing capability, not an implementation detail: `lost_found_guest_claims`, not `new_code_2`. The registry entry also carries `type` (`release`/`entitlement`), `backend_enforced`, and optional `owner`/`created` — informational metadata, not a dashboard.

Adding a flag means adding one entry to *both* files with the same key. The CI gate fails on a duplicate key, a malformed key, or a key present in only one file.

## Backend usage

`apps/api/core/feature_flags.py` is the only module that queries `tenant_feature_flags`. Never write `supabase.table("tenant_feature_flags")` anywhere else.

- `is_feature_enabled(tenant_id, feature_key) -> bool` — fail-closed boolean check (missing row, disabled row, and a database error are all indistinguishable: `False`). Backed by a 15-second in-process cache (no Redis) so the kill switch takes effect across API workers without a redeploy.
- `require_feature(feature_key)` — a `Depends()` factory, same shape as `require_role()`. Use for any route gated by a flag. Raises `403` when disabled.
- `require_feature_sync(tenant_id, feature_key)` — plain-function raising variant for call sites with no `Depends()` graph.
- A cron job iterating many tenants should call `is_feature_enabled()` directly and **soft-skip** disabled tenants rather than raise — see `_require_opera_pilot`/the Opera sync job for the precedent this mirrors. A webhook handler should do the same: ignore/no-op and return a protocol-safe response for a disabled tenant, never 403 a provider's callback.
- All three raise `KeyError` for an unregistered key — a typo surfaces immediately, not as a silently-always-off flag.

**UI hiding is never sufficient on its own.** Any route with a mutation, privileged action, external integration, AI call, billing effect, or workflow state change must be backend-enforced with `require_feature`/`require_feature_sync`, in addition to being hidden on the frontend.

`/auth/me` includes `hotel.enabled_features: string[]` — enabled keys only, computed by iterating the registry, never a wildcard query. Disabled keys and audit metadata are never included.

## Frontend usage

- `apps/web/lib/utils/featureFlag.ts` — `isFeatureEnabled(featureKey, hotel)`, a pure function reading `hotel.enabled_features`. Use this directly for prop-style gating (matching the existing `redesigned={v2}` convention used for `web_redesign_sections`).
- `apps/web/components/shared/FeatureGate.tsx` — a `{feature, children, fallback}` boundary component for wrapping a whole UI section. A new, general-purpose component — not a rename of `RedesignGate` (which is specific to the completed web-redesign rollout and stays as-is).
- `enabled_features` arrives once per session via `/auth/me` into the (non-persisted) `hotelStore`. A flag change becomes visible to a logged-in user on the next natural context refresh (page reload, re-login, `SIGNED_IN` event) — not instantly, and not via a realtime subscription. That is an intentional, documented trade-off (see "Kill switch" below).

## Standard new-feature lifecycle

1. Build the feature behind a registered flag, defaulting OFF.
2. Backend-enforce it if it's privileged/mutating/billing/AI/integration-related.
3. Gate the frontend entry point with `isFeatureEnabled`/`FeatureGate`.
4. Write OFF-state and ON-state tests (backend and frontend).
5. On the PR, declare any flags the Staging Gate should enable before e2e (see below).
6. Pass CI Gate and Staging Gate.
7. Merge to `main` — production deploys with the flag still OFF.
8. Run **Feature Rollout** to enable it for one production pilot tenant. Verify.
9. Repeat Feature Rollout for a small cohort, then the remaining eligible tenants.
10. Once stable at full rollout, delete the flag: registry entries, `tenant_feature_flags` rows (optional — see below), and the `if is_feature_enabled(...)` branches in code.

Trivial, low-risk changes (typo fixes, isolated bug fixes, pure styling) do not need a flag — flags exist where controlled exposure materially reduces risk, not as ceremony.

## Rollout: staging, pilot, cohort

All rollout changes go through `.github/workflows/feature-rollout.yml` (`workflow_dispatch`, inputs: `environment`, `tenant_slug`, `feature_key`, `enabled`). It:

1. Validates the feature key against the registry.
2. Resolves `tenant_slug` to **exactly one** tenant (`tenants.slug` is unique). Zero or multiple matches is a hard failure — never a fuzzy pick.
3. Upserts `tenant_feature_flags` and inserts a `feature_flag_events` row via the Supabase service-role client (no raw SQL).
4. If turning a flag ON, runs a read-only post-enable verification (API health + web reachability).

**Environment isolation**: the job declares `environment: ${{ inputs.environment }}`, selecting between the `staging` and `production` GitHub Environments. Each Environment has its own `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`EXPECTED_SUPABASE_HOST`/`OTHER_ENV_SUPABASE_HOST`/`API_URL`/`WEB_URL`. A run targeting `staging` cannot see `production`'s secrets — that's GitHub's own Environment secret scoping. `apps/web/scripts/apply-feature-flag.mjs` additionally checks the resolved Supabase host against the expected/other-environment allowlist as defense in depth, mirroring `scripts/staging-target-guard.mjs`.

**Admin-only**: dispatching the workflow requires repo write access; the `production` Environment scopes production secrets and no longer requires a reviewer approval. Rollout remains a deliberate operator action (repo write access to dispatch), not self-service.

**Cohort rollout** is just running this workflow once per tenant slug in an explicit list — deliberately not a percentage or a batch UI. Each run is its own audited `feature_flag_events` row. A future `--batch` mode could accept a comma-separated slug list without changing the architecture, but isn't built now; the spec this system implements explicitly bans percentage/random rollout.

### Staging Gate integration

A PR that needs a flag enabled on the staging fixture tenant before its e2e suite runs can declare it two ways:

- `workflow_dispatch` input `required_flags` (comma-separated), or
- a marker in the PR body: `<!-- staging-flags: key1,key2 -->`

`staging-candidate.yml`'s `prepare-staging-database` job enables those flags for the staging fixture tenant (`patelrep-staging-fixture`) right after seeding it, before deploy/e2e. This is simple, explicit PR configuration — never automatic diff inference.

### Status inspection (read-only)

```
node apps/web/scripts/feature-flag-status.mjs --feature <key>
node apps/web/scripts/feature-flag-status.mjs --tenant <slug>
```

Requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for whichever project you're inspecting. This script has no write path at all.

## Kill switch / rollback

1. Run **Feature Rollout** with `enabled: false` for the affected tenant(s). No code change, no redeploy, no Railway build.
2. Confirm via `feature-flag-status.mjs` that the row now reads `enabled: false`, and confirm with the affected hotel (or staging fixture) that the prior behavior is restored after a normal page refresh/re-login.
3. Investigate on a branch. Fix through the normal PR → CI Gate → Staging Gate flow.
4. Re-enable via Feature Rollout once the fix has gone through the same pilot → cohort path again.

**This does not work if the underlying change made an incompatible shared-schema change** (violated EXPAND/CONTRACT — e.g. a column old code can't tolerate). In that case, disabling the flag cannot restore safe behavior; it needs a real code rollback (git revert) and/or a corrective migration, not a flag flip. A flag is a behavior switch, not a schema undo button.

## Cron and webhook enforcement

Background jobs and externally-triggered endpoints must honor the same tenant flag at the correct boundary:

- A cron job iterating all tenants calls `is_feature_enabled(tenant_id, key)` per tenant and **skips** (logs, continues) a disabled tenant — it cannot usefully raise an HTTP exception mid-loop. This mirrors `services/opera/sync.py`'s existing `opera_pilot_enabled` check.
- A webhook handler for a disabled tenant should **not** return an error status that might cause the external provider to retry destructively — follow the same safely-ignore-and-acknowledge precedent already used for Opera.

## Caching and freshness

`is_feature_enabled` caches each `(tenant_id, feature_key)` result in-process for 15 seconds (no Redis). This keeps per-request overhead low without a stale kill switch — a disabled flag takes effect across every API worker within roughly 15 seconds, with no deploy. The frontend has no equivalent cache: `enabled_features` is as fresh as the last `/auth/me` fetch (login, app reload, or a `SIGNED_IN` event) — there is no realtime push, by design.

## Security invariants

- A hotel GM cannot enable a flag for their own tenant (no API surface exists for it).
- Tenant A cannot read or alter tenant B's flags (service-role writes only happen from the rollout workflow, scoped by the resolved `tenant_id`; RLS on both tables is defense in depth).
- A feature-off backend route always fails closed (`403`), regardless of what the frontend shows.
- Service-role credentials never reach the browser, and no flag secret exists in a `NEXT_PUBLIC_*` variable. Feature keys themselves are not secrets.

## One-time GitHub setup (manual)

This system depends on a `production` GitHub Environment that does not exist yet (only `staging` does today). A repository admin must:

1. Create the `production` Environment (Settings → Environments).
2. Ensure only trusted admins have repo write access (the `production` Environment has no Required Reviewer, so dispatch permission is the rollout gate).
3. Add `SUPABASE_URL`, `EXPECTED_SUPABASE_HOST`, `OTHER_ENV_SUPABASE_HOST`, `API_URL`, `WEB_URL` (variables) and `SUPABASE_SERVICE_ROLE_KEY` (secret) to **both** the `staging` and `production` Environments, each pointed at its own Supabase project and app URLs (staging's `OTHER_ENV_SUPABASE_HOST` is production's host, and vice versa).

## Deferred / explicitly out of scope

- No percentage/random rollout — banned by design; the rollout unit is always a tenant.
- No batch-cohort UI — cohort rollout is repeated single-tenant workflow runs.
- No codegen between the two registries — two hand-maintained files plus a parity script.
- No Redis or other shared cache — a short in-process TTL is sufficient for a release-control kill switch.
- No per-tenant JWT-based impersonation in the rollout workflow's post-enable verification — it checks platform health and reachability only, not the gated endpoint's exact tenant-scoped response. Confirm that manually (or via the affected hotel) for anything higher-stakes.
