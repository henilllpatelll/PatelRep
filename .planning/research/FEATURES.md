# Feature Research

**Domain:** Operational practices (platform/ops hardening) for a multi-tenant FastAPI + Supabase SaaS, no ORM
**Researched:** 2026-08-04
**Confidence:** MEDIUM-HIGH (codebase findings HIGH; external practice recommendations MEDIUM — synthesized from multiple WebSearch sources, no single canonical spec exists for these three practices)

This milestone (v1.4) ships **no new user-facing features**. "Features" below are read as **operational practices/deliverables**: (1) RBAC normalization, (2) shared-DB test-data hygiene, (3) documentation-drift prevention.

## Current-State Findings (grounds the recommendations below)

- `require_role(*roles)` in `apps/api/middleware/auth.py:127-136` is a clean FastAPI `Depends`-based dependency — this is already the industry-standard shape (verify JWT → resolve claims → declarative per-route dependency). It does not need replacing.
- 214 occurrences of `current_user.role` / `require_role(` across 28 files in `apps/api/routers/`. Many are legitimate **object-level** checks (e.g. `rooms.py:55` — a housekeeper may only undo a room they're assigned to; `safety.py:84` — a user may only view their own training unless they're a manager). These structurally cannot be expressed by `require_role()`, which only sees role, not resource state.
- Role-set constants are **redefined per-file with no shared source of truth**, and they've already drifted:
  - `MANAGER_ROLES` = `("gm", "housekeeping_supervisor", "chief_engineer")` in `safety.py:34` vs. `("gm", "housekeeping_supervisor", "engineer", "chief_engineer")` in `programs.py:43` — same name, different membership.
  - `hotels.py:11` — `ALL_STAFF_ROLES` lists `"engineer"` twice and omits `"chief_engineer"` entirely — a likely bug.
  - At least 9 other one-off constants (`SESSION_ROLES`, `SHIFT_ROLES`, `SUPERVISOR_ROLES`, `UNDO_ALL_ROLES`, `MESSAGE_ROLES`, `SLA_POLICY_ROLES`, `EVIDENCE_CAPTURE_ROLES`, `COMPETENCY_MANAGER_ROLES`) exist, each hand-maintained.
  - A separate `custom_role_id` override system exists in `staff.py` (migrations 028/029) layered on top of the fixed 6-role enum — any normalization must account for effective-role resolution, not just the literal `role` claim.
- Automated tests (`apps/api/tests/`) already run against `fake_supabase.py` / mocked env vars (`tests/smoke/conftest.py`) — they do **not** touch the real Supabase project. The shared-DB risk is specifically **manual/Playwright QA** against the live `oacnwalhcpqdabivweki` project, not CI.
- `apps/api/.env` **exists locally** with real keys — confirms the CLAUDE.md claim "no live API credentials in the local environment" is stale, consistent with the milestone brief.
- No existing seed/teardown script scopes to a designated "test tenant" — `supabase/seed.sql` and `apps/api/scripts/seed_hotel_layout.py` seed general schema/layout data, not tagged QA fixtures.

## Feature Landscape

### Table Stakes (Any Competent Team Would Do These)

| Practice | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Audit script enumerating every route-level auth check (which routes use `require_role`, which rely solely on an inline `if current_user.role ==` with no dependency) | You cannot normalize what you haven't inventoried; scattered checks are otherwise invisible to code review | LOW | Simple grep/AST script over `apps/api/routers/*.py`; output is a worklist, not a fix |
| Apply `require_role()` consistently to every route that only needs role-level gating (no resource ownership involved) | This is the one enforcement point FastAPI's own DI model is built for; leaving some routes to inline checks is the exact inconsistency this milestone targets | LOW–MEDIUM | Mechanical per-route change; risk is regressions if a role-set literal is copied wrong during migration (see the `MANAGER_ROLES` drift above — do this via one shared constant, not copy-paste) |
| Single shared module (e.g. `core/roles.py`) defining every role-group constant once, imported everywhere instead of redefined per-router | Directly fixes the `MANAGER_ROLES` mismatch and the `ALL_STAFF_ROLES` bug found above | LOW | Pure refactor; no behavior change if done correctly — write a smoke test asserting old vs. new constant sets are equal before deleting the old ones |
| Explicit, named helper for object/row-level checks (e.g. `assert_self_or_role(current_user, resource_owner_id, *bypass_roles)`) instead of ad hoc `if current_user.role == "housekeeper" and x.assigned_to == current_user.user_id` scattered inline | Keeps the legitimate second authorization layer (ownership) from being confused with — or accidentally deleted during — route-level RBAC normalization | LOW–MEDIUM | Do not try to force ownership checks into `require_role()`; it has no concept of resource state |
| Designate specific hotel tenant(s) as "QA test tenants" via an explicit flag/naming convention (leverages the existing `hotel_id` isolation boundary already enforced by every query + RLS) | The app is already multi-tenant-isolated by `hotel_id` — this is the cheapest possible test-data boundary, requiring no new isolation mechanism | LOW | E.g. a `is_test_tenant boolean` column on `tenants`/`hotels`, or a reserved name prefix (`"QA-*"`) checked in a script |
| Cleanup script that hard-scopes every `DELETE`/reset to `hotel_id IN (<tagged test tenants>)`, never touching un-tagged tenants, with a dry-run mode that prints row counts before deleting | Prevents a cleanup run from ever touching another engineer's in-flight manual QA data or real customer data in the same project | MEDIUM | Must respect FK cascade order (see migration 023 cascade FK deletes) or run inside a transaction; dry-run-first is the safety rail |
| Fix the two known-stale CLAUDE.md claims directly (cron mechanism: GitHub Actions → APScheduler in-process; credentials: "none locally" → Stripe/Supabase keys ARE present) | These are the two concrete instances of drift this milestone exists to prevent — fixing them is a precondition for any drift-detection tooling (a check can't defend a fact that's currently wrong) | LOW | Direct doc edit, already fully diagnosed by memory/`project_cron_scheduler.md` |
| One CI or pre-commit check per **known-fragile fact**, not a general-purpose doc linter — e.g. grep that fails if CLAUDE.md says "GitHub Actions" runs cron while `apscheduler` import exists in `main.py`, and a check that env-var docs match `.env.example` keys | Cheap, targeted, catches the exact class of drift already observed twice; a general prose-freshness linter is unreliable and expensive to maintain | LOW | Sources agree: targeted, high-signal checks beat broad "doc linting" for small teams — see anti-features below |

### Differentiators (Worth Doing, Not Required for v1.4 to Be Complete)

| Practice | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-generated route × role permission matrix (a script that walks FastAPI's route table and each route's `Depends(require_role(...))` args, emits a Markdown table) | Turns "what can a front_desk user do?" from an archaeology exercise into a build artifact; also doubles as a regression check — if the generated table changes unexpectedly, a PR reviewer notices | MEDIUM | Only works well **after** normalization — routes still using inline checks won't show up correctly, so this is naturally sequenced after the table-stakes items |
| Lint rule (custom AST check, e.g. via `ast`/`libcst` or a simple regex CI step) that flags new PRs introducing a bare `current_user.role ==`/`!=`/`in {...}` comparison for pure route gating, nudging the author toward `require_role()` or the shared object-check helper | Stops the pattern from re-fragmenting after the initial cleanup — normalization efforts that aren't enforced tend to decay within a few months | MEDIUM | Needs a documented exception list for legitimate object-level checks so the linter doesn't cry wolf |
| Soft-delete + scheduled hard-delete (pg_cron, batched) for tagged test data instead of a synchronous destructive `DELETE` | Gives a recovery window if the cleanup script's tenant-tag scoping has a bug, and batches the delete to avoid locking large tables during another engineer's active QA session | MEDIUM | Supabase's own guidance (see Sources) recommends this pattern specifically for live/shared databases over synchronous bulk delete |
| "Last-verified" date + owner note on the specific CLAUDE.md sections most prone to drift (cron jobs table, env-var/credentials section, infra URLs) | Cheap signal for a human reviewer ("this hasn't been checked in 3 months") without building tooling that verifies prose semantically | LOW | Convention, not automation — pairs well with the targeted CI checks above rather than replacing them |

### Anti-Features (Would Look Like Progress, Actually Aren't — for This App's Scale)

| Practice | Why It's Tempting | Why Problematic Here | Alternative |
|---------|---------------|-----------------|-------------|
| Adopting an external policy engine (Casbin, Oso, Permit.io) to replace `require_role()` | "RBAC normalization" sounds like exactly what these tools are for | Overkill for 6 fixed roles + `hotel_id` tenant scoping + a small `custom_role_id` override table; adds a policy language, a new deployment/config surface, and a learning curve disproportionate to the app's actual authorization complexity. Sources are explicit that these tools earn their cost at higher role/policy complexity than PatelRep currently has | Keep `require_role()` as the canonical route-level gate; formalize the object-level layer with one small internal helper (see table stakes) — re-evaluate only if roles or `custom_role_id` combinations grow substantially |
| Fully automated CLAUDE.md generation from code/AST (regenerate the whole file every commit) | Sounds like it eliminates drift entirely | Brittle, strips human-curated "why" context (e.g. the rationale notes throughout CLAUDE.md), and is itself a new thing that needs maintenance — trades one drift problem for a fragile-generator problem | Targeted, fact-specific CI checks (table stakes) for the handful of claims that are actually prone to going stale; leave prose sections human-owned |
| Nightly full wipe/reset of the shared dev Supabase project | Simplest possible "clean test data" mental model | Directly breaks the stated constraint: real engineers use the same project for manual testing side-by-side; a blanket reset destroys another engineer's in-flight QA session and any persistent demo/staging data with no way to distinguish "test junk" from "someone's active work" | Scoped, tag-based cleanup limited to explicitly marked test tenants (table stakes), on demand or on a long TTL — never a blanket reset |
| Standing up a second, fully separate staging Supabase project as a v1.4 deliverable | Feels like the "proper" fix for shared-DB risk | High cost relative to this milestone's scope — dual migrations, dual env config, dual seed data, ongoing sync burden — and CLAUDE.md already documents "no dedicated staging DB" as a deliberate current-state constraint, not an oversight to silently reverse | Tenant-tagged isolation within the existing project (in scope now); revisit a project split only if tagged isolation proves insufficient |

## Feature Dependencies

```
[Role-set constant consolidation (core/roles.py)]
    └──requires──> [Audit script inventory of current checks]

[require_role() applied consistently to route-level gates]
    └──requires──> [Audit script inventory]
    └──requires──> [Role-set constant consolidation]

[Object-level check helper (assert_self_or_role)]
    └──requires──> [Audit script inventory]  (to separate "route gate" from "ownership check" cases)

[Auto-generated permission matrix]
    └──requires──> [require_role() applied consistently]   (inline checks won't show up in the matrix)

[Lint rule blocking new inline role checks]
    └──requires──> [Object-level check helper exists]        (needs an approved alternative to point authors to)

[Tagged test-tenant convention]
    (no dependency — can start immediately)

[Scoped cleanup script]
    └──requires──> [Tagged test-tenant convention]            (can't safely delete without a marker)

[Doc-drift CI checks (cron wording, credentials wording)]
    └──requires──> [CLAUDE.md stale claims corrected first]   (a check must defend a true fact, not encode the current wrong one)
```

### Dependency Notes

- **Auto-generated permission matrix requires consistent `require_role()` usage:** the generator can only read what's declared as a FastAPI dependency; routes still gating via inline `if` blocks are invisible to it, so this is a natural second-wave item, not a first-wave one.
- **Lint rule requires the object-level helper to exist first:** without an approved alternative pattern, the lint rule has nothing constructive to suggest and will just generate noise/exceptions.
- **Cleanup script requires the tagging convention:** deleting by `hotel_id` membership in an untagged, ad hoc list is exactly the kind of manual, error-prone process this milestone should eliminate.
- **Doc-drift CI checks require the underlying facts to be correct first:** encoding a check that asserts "CLAUDE.md says GitHub Actions runs cron" before fixing the text would just make the wrong claim harder to change later.

## MVP Definition

### Launch With (v1.4 must-have)

- [ ] Correct the two known-stale CLAUDE.md claims (cron mechanism, local credentials) — direct edit, no tooling prerequisite
- [ ] Audit script inventorying every `current_user.role` / `require_role()` usage per router, classified as route-level-gate vs. object-level-check
- [ ] `core/roles.py` (or equivalent) consolidating all role-group constants into one source of truth, fixing the `MANAGER_ROLES` drift and `ALL_STAFF_ROLES` bug found above
- [ ] `require_role()` applied to every route classified as a pure route-level gate by the audit
- [ ] Named helper for object-level/ownership checks, applied to the routes classified as such (not forced into `require_role()`)
- [ ] Test-tenant tagging convention (flag or naming convention) introduced on `hotels`/`tenants`
- [ ] Cleanup script scoped strictly to tagged test tenants, with mandatory dry-run output before any delete

### Add After Validation (v1.4.x)

- [ ] Auto-generated route × role permission matrix doc — add once `require_role()` coverage is consistent enough to be worth generating from
- [ ] CI lint rule blocking new bare role comparisons for route gating — add once the object-level helper has been in use long enough to have a stable exception list
- [ ] Targeted CI/pre-commit checks defending the two corrected doc facts (cron mechanism, credentials) specifically
- [ ] "Last-verified" convention on the highest-drift-risk CLAUDE.md sections

### Future Consideration (v2+)

- [ ] Soft-delete + pg_cron scheduled hard-delete for tagged test data — defer until the synchronous scoped-delete script has proven the tagging boundary is safe
- [ ] Re-evaluate a policy engine (Casbin/Oso) only if role count or `custom_role_id` combinations grow enough that a shared-constants file stops being sufficient
- [ ] Dedicated separate staging Supabase project — explicitly out of scope per current CLAUDE.md constraint; revisit only if tagged in-project isolation proves insufficient at higher engineer/QA concurrency

## Feature Prioritization Matrix

| Practice | Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix two stale CLAUDE.md claims | HIGH | LOW | P1 |
| Audit script (inventory checks) | HIGH | LOW | P1 |
| Consolidate role constants (`core/roles.py`) | HIGH | LOW | P1 |
| Apply `require_role()` consistently | HIGH | MEDIUM | P1 |
| Object-level check helper | HIGH | LOW–MEDIUM | P1 |
| Test-tenant tagging convention | HIGH | LOW | P1 |
| Scoped cleanup script + dry-run | HIGH | MEDIUM | P1 |
| Auto-generated permission matrix | MEDIUM | MEDIUM | P2 |
| Lint rule for new inline role checks | MEDIUM | MEDIUM | P2 |
| Targeted doc-drift CI checks | MEDIUM | LOW | P2 |
| Soft-delete + pg_cron sweep | LOW–MEDIUM | MEDIUM | P3 |
| External policy engine (Casbin/Oso) | LOW (at current scale) | HIGH | P3 (reject unless triggers hit) |
| Separate staging Supabase project | LOW (out of scope) | HIGH | P3 (reject per current constraint) |

**Priority key:**
- P1: Must have for v1.4 to be considered done
- P2: Should have, natural second wave once P1 lands
- P3: Nice to have / explicitly deferred, only reconsider if stated triggers occur

## Explicit Answer: What Happens to `require_role()`

**Extend and apply consistently — do not replace.** `require_role()` at `apps/api/middleware/auth.py:127` already matches the industry-standard FastAPI pattern (verified JWT → resolved claims → declarative per-route `Depends`), confirmed across every FastAPI RBAC source reviewed. The actual gap isn't the mechanism, it's:
1. **Inconsistent application** — many routes gate role purely via inline `if` instead of the dependency that already exists for this.
2. **No single source of truth for role groups** — same-named constants (`MANAGER_ROLES`) already disagree across files.
3. **No distinct, named pattern for object-level/ownership checks** — these are legitimate and must stay separate from route-level RBAC (structurally, `require_role()` cannot see resource state), but right now they're indistinguishable in the code from checks that should have been `require_role()` calls.

Normalization = (a) one shared constants module, (b) `require_role()` on every pure route-gate, (c) one named helper for ownership checks, (d) an audit/lint step to keep it that way. No new framework is warranted at this app's current role/policy complexity.

## Sources

- [require_role() FastAPI centralization — DeepWiki RBAC Implementation](https://deepwiki.com/fastapi-practices/fastapi_best_architecture/3.2-rbac-system) — MEDIUM confidence, community reference architecture
- [RBAC/ABAC Authorization in FastAPI — practical guide](https://blog.greeden.me/en/2026/03/24/introduction-to-rbac-abac-authorization-management-in-fastapi-a-practical-guide-to-designing-secure-authorization-with-roles-attributes-and-policies/) — MEDIUM confidence
- [FastAPI Auth with Dependency Injection — PropelAuth](https://www.propelauth.com/post/fastapi-auth-with-dependency-injection) — MEDIUM confidence
- [FastAPI dependency injection masterclass](https://medium.com/the-pythonworld/fastapi-dependency-injection-masterclass-cleaner-code-better-architecture-f29b906bfaf9) — MEDIUM confidence
- [Deleting data and dropping objects safely — Supabase Docs](https://supabase.com/docs/guides/database/postgres/data-deletion) — HIGH confidence, official docs; source for soft-delete + pg_cron batching guidance
- [Testing Overview — Supabase Docs](https://supabase.com/docs/guides/local-development/testing/overview) — HIGH confidence, official docs
- [Testing for Vibe Coders: From Zero to Production Confidence — Supabase Blog](https://supabase.com/blog/testing-for-vibe-coders-from-zero-to-production-confidence) — MEDIUM confidence
- [Best Practices for Supabase — Security, Scaling & Maintainability](https://leanware.co/insights/supabase-best-practices) — MEDIUM confidence
- [Multi-Tenant Test Data: Definition, Examples & Best Practices — GoMask](https://gomask.ai/glossary/multi-tenant-test-data) — MEDIUM confidence
- [Multi-Tenant SaaS Testing for Stable Performance — QATestLab](https://blog.qatestlab.com/2026/04/02/multi-tenant-saas-testing-guide-ensuring-performance-and-scalability/) — LOW-MEDIUM confidence, single vendor blog
- [Continuous Documentation as an Agent-Driven Practice — AgentPatterns.ai](https://www.agentpatterns.ai/workflows/continuous-documentation/) — MEDIUM confidence; source for "scheduled comparison, PR-based correction, human review" pattern
- [Doc Drift Detection in CI: Catching Stale Docs on Every Merge](https://understandingdata.com/posts/doc-drift-detection-ci/) — MEDIUM confidence
- [How to Catch Documentation Drift with Claude Code and GitHub Actions — Dosu](https://dosu.dev/blog/how-to-catch-documentation-drift-claude-code-github-actions) — MEDIUM confidence
- [Claude Code for documentation drift — Koder.ai](https://koder.ai/blog/claude-code-docs-drift) — MEDIUM confidence; source for "source of truth per doc type, drift checks per PR" recommendation
- [CLAUDE.md Best Practices, 2026 — AgentLint Blog](https://www.agentlint.app/blog/claude-md-best-practices-2026/) — LOW-MEDIUM confidence, single vendor blog
- [Best Permit.io Alternatives & Competitors — OsoHQ](https://www.osohq.com/learn/permitio-alternatives) — MEDIUM confidence; source for "overkill for small teams" framing (vendor-authored, cross-checked against Permify's independent comparison)
- [Top Alternatives to AWS Cedar — OsoHQ](https://www.osohq.com/learn/aws-cedar-alternatives-authorization-tools) — MEDIUM confidence
- Codebase inspection: `apps/api/middleware/auth.py`, `apps/api/routers/*.py` (grep for `current_user.role`, `require_role(`, `_ROLES\s*=`), `apps/api/tests/smoke/conftest.py`, `apps/api/.env` presence — HIGH confidence, direct read

---
*Feature research for: PatelRep v1.4 — Platform and Ops Hardening (RBAC normalization, test-data hygiene, doc-drift prevention)*
*Researched: 2026-08-04*
