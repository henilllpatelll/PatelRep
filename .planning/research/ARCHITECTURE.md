# Architecture Research

**Domain:** Platform/ops hardening on an existing production app (v1.4) — Expo major bump, RBAC normalization, doc-drift fixes, dev-DB cleanup, closing deferred human-verification items from v1.3
**Researched:** 2026-08-04
**Confidence:** HIGH (all findings verified directly against current source: `apps/api/routers/*.py` (30 files), `apps/api/middleware/auth.py`, `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/eas.json`, `.planning/phases/{15,16,17}-*/*-VERIFICATION.md`, `apps/api/core/scheduler.py` existence, `CLAUDE.md`)

## Executive Summary

All five v1.4 work items are maintenance/hardening passes on code that already exists — there is no new feature architecture to design. The interesting finding is **not** "how do these integrate" in the greenfield sense, but **where their file-level blast radii overlap**, because three of the five items touch overlapping router files:

- **RBAC normalization** and **closing v1.3's deferred human-verification items** collide directly on `apps/api/routers/staff.py`, `scheduling.py`, `housekeeping.py`, `work_orders.py`, and — most importantly — `guest_requests.py`, which has a **real, unguarded RBAC gap** (`DELETE /guest-requests/{id}` has no role check at all — any authenticated hotel user, including a housekeeper, can permanently delete a guest request). This isn't a style inconsistency; it's the actual bug RBAC normalization should be scoped to catch.
- **Doc-drift fixes** are two narrow, already-diagnosed one-paragraph edits to `CLAUDE.md` with zero code/router overlap with anything else.
- **Expo 54→57** and **dev-DB cleanup** are both isolated from the other three (different app, different concern) but Expo 54→57 is the highest-**risk** item because `newArchEnabled: true` is already set for iOS and Android — a major SDK bump on New Architecture is far more likely to break native module compatibility (`expo-speech-recognition`, `expo-sqlite`, `expo-camera`) than a bump with New Arch off.

**Recommended execution order:** doc-drift (trivial, unblocks nothing but costs nothing) → RBAC normalization (fixes real bugs, must land *before* re-verifying the deferred items it shares files with) → deferred-verification closure (re-check against the *post-RBAC-fix* code, not the current code, or it verifies a moving target) → dev-DB cleanup (independent, do whenever) → Expo 54→57 (isolated, highest single-item risk, budget the most time, do last so a rollback doesn't block the other four).

## Current State — What Exists Today

### RBAC: `require_role()` vs. inline role checks

`apps/api/middleware/auth.py` defines the canonical pattern:

```python
def require_role(*roles: str):
    async def check_role(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Role '{current_user.role}' is not authorized for this action")
        return current_user
    return check_role
```

Used as `Depends(require_role("gm", "engineer"))` at the route-decorator level — gates the *entire* endpoint before the handler body runs.

**Actual router inventory:** `apps/api/routers/` has **30 `.py` files**, not the 21 listed in `CLAUDE.md`'s Domain Map table. Nine routers exist but aren't documented there: `clean_sessions.py`, `cleaning_checklists.py`, `evidence.py`, `feedback.py`, `late_checkout.py`, `management_roi.py`, `programs.py`, `safety.py`, `shifts.py`. This is a separate, smaller doc-drift item from the two named below — worth a one-line fix alongside them but not conflated with them.

Classified by RBAC pattern (grepped `require_role` and `current_user.role` / `.role ==` / `.role in` / `.role not in` across all 30 files):

| Pattern | Routers | Count |
|---|---|---|
| **`require_role()` only** — clean, route-level gate | `housekeeping.py`, `sop.py`, `management_roi.py`, `integrations.py`, `hotels.py`, `billing.py`, `reports.py`, `notifications.py`, `onboarding.py`, `cleaning_checklists.py`, `shifts.py` | 11 |
| **Mixed** — `require_role()` at the route level for some endpoints, plus inline `current_user.role` checks *inside* handler bodies for finer-grained/conditional logic (e.g. "only a `gm` sees `approved_by`", multi-branch approval rules) | `rooms.py`, `work_orders.py`, `staff.py`, `scheduling.py`, `logbook.py`, `ai_copilot.py`, `programs.py`, `assets.py`, `evidence.py`, `safety.py`, `tasks.py`, `clean_sessions.py`, `late_checkout.py`, `feedback.py` | 14 |
| **Inline-only** — zero `require_role()` dependency anywhere in the file; every access-control decision (where one exists at all) is an ad hoc `current_user.role not in {...}` inside a handler body | `guest_requests.py`, `lost_found.py`, `auth.py` | 3 |
| **No role-based gating** (auth-only, correctly — cron/webhook secret-header pattern instead) | `webhooks.py`, `internal.py` | 2 |

The 14 "mixed" routers are **not** automatically a normalization target — most of their inline checks are genuine mid-handler conditional logic (e.g. `work_orders.py` deciding which fields to include in a response based on role), not a missed opportunity to use `require_role()`. The real normalization targets are the **3 inline-only routers**, because in those files entire endpoints have *no* role gate at all where one is clearly needed:

- **`guest_requests.py`** — 17 endpoints, only 5 have any inline role check (`send_guest_message`, `list_guest_messages` ×2 via `MESSAGE_ROLES`, `create_guest_request_sla_policy`, `delete_guest_request_sla_policy` via `SLA_POLICY_ROLES`, plus an approval-role check in `transition_guest_request`). **`DELETE /{request_id}` (`delete_guest_request`, line 586) has no role check whatsoever** — confirmed by reading the full handler body; it deletes the row and its `task_comments` for any authenticated user of the tenant. `create_guest_request`, `transition_guest_request` (partially gated), `list_guest_requests`, `update_guest_request`, the accessibility-features GET/PUT, and the SLA-policies GET are also ungated.
- **`lost_found.py`** — one inline check (`record_lost_found_custody_event`, line 170: `{"front_desk", "housekeeping_supervisor", "gm"}`). Other mutating endpoints in the same file were not individually audited here but follow the same "opt-in per-endpoint" pattern rather than a file-wide gate.
- **`auth.py`** — its single "inline role" match (line 33) is `user_data["role"] = current_user.role`, i.e. serializing the role into a response payload, not an authorization decision. This is a false positive for RBAC-gap purposes — `auth.py` has no privileged mutation endpoints and doesn't need `require_role()`.

**Concrete normalization scope, backed by evidence:** the RBAC work is really "audit and fix `guest_requests.py` and `lost_found.py` endpoint-by-endpoint against `require_role()`," not a sweep across all 30 files. The 14 mixed routers may warrant a lighter pass (e.g. extracting repeated role-set literals like `{"gm", "housekeeping_supervisor", "engineer"}` into named constants for consistency), but that's a style cleanup, not a security fix.

### Expo mobile — actual current state

`apps/mobile/package.json` / `app.json` (read directly, not from memory):

| Field | Current value |
|---|---|
| `expo` | `~54.0.0` |
| `react-native` | `0.81.5` |
| `react` | `19.1.0` |
| `expo-router` | `~6.0.24` |
| iOS `newArchEnabled` | `true` (app.json:19) |
| Android `newArchEnabled` | `true` (app.json:30) |
| `expo-dev-client` | `~6.0.21` |
| Native modules in use | `expo-camera`, `expo-sqlite`, `expo-speech-recognition` (^0.3.2, not `~`-pinned — third-party, not first-party Expo), `expo-image-manipulator`, `expo-image-picker`, `expo-document-picker`, `expo-notifications`, `expo-secure-store` |

`apps/mobile/eas.json`: `development`/`preview`/`production` build profiles configure only `android` (`buildType: apk`); there is no `ios` key under any build profile. An `ios` block *does* exist under `submit.production` but with placeholder values (`FILL_IN_FROM_APP_STORE_CONNECT`, `FILL_IN_FROM_APPLE_DEVELOPER`) — confirms "EAS builds Android only" is accurate today; iOS is scaffolded in `app.json` (bundle ID, Face ID/mic permission strings) but never actually built.

Because New Architecture is already on for both platforms, the 54→57 bump's risk is concentrated in **native module compatibility**, not in an Old→New Architecture migration (that transition already happened). `expo-speech-recognition` is the one dependency most likely to lag an SDK bump since it's third-party and not co-versioned by Expo — worth checking its release notes for SDK 57 support before starting, and treating it as the item most likely to force a fallback/workaround.

### Doc-drift — both items identified concretely, not generic

1. **Cron mechanism** (`CLAUDE.md` "Cron Jobs" section, ~line 149): documents GitHub Actions (`.github/workflows/cron-jobs.yml` + `X-Cron-Secret`) as the production cron driver. Per `.wolf` memory (`project_cron_scheduler.md`, superseded 2026-07-28) and confirmed by `apps/api/core/scheduler.py` existing on disk, production actually runs crons **in-process via APScheduler**. Fix: rewrite the "Cron Jobs" section to describe `apps/api/core/scheduler.py`'s schedule instead of the GitHub Actions workflow (the workflow file may still exist/work as a manual-trigger fallback — verify before deciding whether to delete or just re-describe it).
2. **"Current Scope" credentials note** (`CLAUDE.md`, "No live API credentials in the local environment" bullet): per `16-VERIFICATION.md`'s Method Note (2026-08-04), `apps/api/.env` and `apps/web/app/.env.local` **do** contain live, working `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` (test-mode) pointed at the real shared dev Supabase project. Only `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are genuinely absent (commented out). Fix: narrow the claim to the two AI keys specifically.

Both are one-paragraph edits to the same file with zero code dependencies — safe to do first, in one commit, independent of everything else.

### Deferred human-verification items from v1.3 (Phases 15-17) — actual count and file overlap

Only the three phase-level `*-VERIFICATION.md` files exist (no per-plan verification files carry additional open items). Actual list:

| # | Phase | Item | File(s) touched | Overlaps RBAC work? |
|---|---|---|---|---|
| 1 | 15 | Non-manager role (`housekeeper`/`front_desk`) sees no "Archive..." button on Engineering Work Orders toolbar | `apps/api/routers/work_orders.py` (backend already `require_role`-gated + tested), `apps/web/.../engineering/work-orders/page.tsx` (frontend `canManage` conditional) | Yes — `work_orders.py` is a "mixed" router |
| 2 | 17 | Staff/Scheduling/Housekeeping pages render "Unnamed Staff" fallback for NULL `full_name`, no console error | `apps/api/routers/staff.py`, `scheduling.py`; `apps/web/.../{staff,scheduling,housekeeping}/page.tsx` | Yes — `staff.py`, `scheduling.py` are "mixed" routers |
| 3 | 17 | Guest Request drawer status-advance buttons work end-to-end at every status | `apps/web/components/guest-requests/GuestRequestDrawer.tsx`, `GuestRequestsPage.tsx` (web only — routes through the existing, already-verified kanban mutation path) | **Yes, directly** — the underlying API is `guest_requests.py`, one of the 3 inline-only RBAC routers with the confirmed `DELETE` gap |
| 4 | 17 | Inspections re-assign picker: selecting a `housekeeping_supervisor` and submitting succeeds | `apps/web/.../housekeeping/inspections/page.tsx` (role filter widened), backend `_ensure_housekeeper()` (unspecified router — verify location before re-checking) | Possibly — depends on which router owns `_ensure_housekeeper()` |
| 5 | 17 | Migration `091_ai_interactions_widen_interaction_type.sql` applied to remote Supabase, live `general`-intent AI Copilot interaction no longer 400/500s | `supabase/migrations/091_*.sql` (file exists, not yet applied to remote); relates to `apps/api/routers/ai_copilot.py` | No — pure DB deploy step, no RBAC surface |

Note: the milestone brief estimated "~10" deferred items; the actual count found in the three `*-VERIFICATION.md` files is **5** (1 from Phase 15, 0 from Phase 16 — its one gap was already closed same-session — 4 from Phase 17). Roadmap planning should size this work item against 5 confirmed items, not 10, though it's worth a quick check with whoever produced the "~10" estimate in case items were tracked outside these three files.

**Why order matters here:** items #1–#3 share files with the RBAC normalization pass (`work_orders.py`, `staff.py`, `scheduling.py`, `guest_requests.py`). If RBAC normalization runs *after* these are marked "closed," a `guest_requests.py` fix (adding a role gate to `delete_guest_request`) could silently change behavior the verification step just signed off on (e.g. if a `front_desk` user was relying on unrestricted delete access as an undocumented workaround). Re-verify #1–#3 **after** RBAC normalization lands, not before, so verification reflects final code.

### Dev-DB cleanup

No file-level overlap with the other four items — this is data hygiene on the shared dev Supabase project (`oacnwalhcpqdabivweki`, referenced throughout `.env` files and `eas.json`), not a code change. Independent; sequence wherever convenient, but doing it *before* the deferred-verification re-checks (item set above) avoids test data contaminating a "confirm X renders correctly" browser check.

## Integration Points

### Internal Boundaries (file/router-level overlap across the 5 work items)

| Boundary | Shared file(s) | Risk if sequenced wrong |
|---|---|---|
| RBAC normalization ↔ deferred-verification closure | `work_orders.py`, `staff.py`, `scheduling.py`, `guest_requests.py` | Verification "passes" against pre-fix code, then RBAC fix changes behavior underneath it — re-verify after, not before |
| RBAC normalization ↔ `guest_requests.py` DELETE gap | `guest_requests.py` | This *is* the concrete bug the normalization pass should fix — don't scope it as "add require_role everywhere" without specifically closing this endpoint |
| Doc-drift fixes ↔ everything else | `CLAUDE.md` only | None — fully isolated, safe first |
| Expo 54→57 ↔ everything else | `apps/mobile/**` only | None — fully isolated from `apps/api`/`apps/web`, but internally highest-risk (New Arch + third-party native module `expo-speech-recognition`) |
| Dev-DB cleanup ↔ deferred-verification closure | Shared dev Supabase project, no shared files | Sequence cleanup before verification browser-checks to avoid stale/contaminated data confusing a manual check |

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| Expo/EAS | `eas.json` build profiles (Android-only today) | SDK 57 bump doesn't require touching `eas.json` build config unless new native modules need config-plugin changes |
| Supabase (shared dev project) | `apps/api/.env`, `apps/web/app/.env.local`, `eas.json` `EXPO_PUBLIC_SUPABASE_*` | Same project (`oacnwalhcpqdabivweki`) backs local dev, mobile dev builds, and the "shared dev Supabase" cleanup target — confirm which tables/rows are safe to purge don't collide with what other active work (e.g. concurrent phase execution) is using |

## Anti-Patterns to Avoid

### Anti-Pattern: Treating "RBAC normalization" as a mechanical `require_role()` sweep

**What people do:** Blanket-replace every inline `current_user.role` check with `Depends(require_role(...))` across all 30 routers.
**Why it's wrong:** 14 of the 30 routers use inline checks correctly for mid-handler conditional logic that isn't expressible as a single route-level gate (e.g. "include this field only for `gm`"). Sweeping those into `require_role()` either breaks legitimate conditional access or requires splitting endpoints unnecessarily.
**Do this instead:** Scope the pass to the 3 inline-only routers (`guest_requests.py`, `lost_found.py`, `auth.py`), starting with the confirmed `guest_requests.py` DELETE gap. For the 14 mixed routers, consider a lighter follow-up (shared role-set constants) rather than a rewrite.

### Anti-Pattern: Bumping Expo without checking third-party native module SDK support first

**What people do:** Run `npx expo install --fix` / bump `expo` in `package.json` and deal with breakage as it appears.
**Why it's wrong:** With New Architecture already enabled, a broken third-party module (most likely `expo-speech-recognition`, the one non-`expo-*`-namespaced native dependency) can fail in ways that don't surface until a real device test, costing a full rebuild cycle to diagnose.
**Do this instead:** Check `expo-speech-recognition`'s changelog/repo for SDK 57 + New Arch support before starting the bump; have a fallback plan (pin it back, or find an alternative) ready.

## Sources

- `apps/api/middleware/auth.py` (read in full)
- `apps/api/routers/*.py` (30 files; grepped for `require_role` and role-check patterns; `guest_requests.py` and `lost_found.py` read in relevant sections)
- `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/eas.json` (read in full)
- `apps/api/core/scheduler.py` (existence confirmed)
- `.planning/phases/15-work-order-bulk-archive/15-VERIFICATION.md`
- `.planning/phases/16-self-serve-billing-management/16-VERIFICATION.md`
- `.planning/phases/17-backlog-cleanup/17-VERIFICATION.md`, `deferred-items.md`
- `~/.claude/projects/.../memory/project_cron_scheduler.md` (auto-memory, cross-checked against `apps/api/core/scheduler.py` on disk rather than trusted alone)
- `CLAUDE.md` (root, current content)

---
*Architecture research for: PatelRep v1.4 (Platform and Ops Hardening)*
*Researched: 2026-08-04*
