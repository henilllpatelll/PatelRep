# Developer Harness V2 — 06 Baseline Fixtures and Invariants

Baseline: `main` @ `218a882b15ed8f928f9a8b7d82b6ea8bb1ed0d37`, 2026-11-21.

## 1. Architectural contract vs runtime enforcement

- **Architectural contract** = `contract.json` plus documents 02–04. It states intent and is checked for
  internal consistency by the Phase 1 tests. It enforces **nothing** at runtime.
- **Runtime enforcement** arrives in Phase 2 (local policy engine and hooks) and is always subordinate to the
  authoritative GitHub controls (rulesets, environments, gates, trusted publishers).
- The Phase 1 tests must never assert that today's weak configuration (broad allow-lists, OpenWolf sizes, hook
  set) stays unchanged. Later phases are expected to change it.

## 2. Protected behaviors V2 must preserve

| # | Invariant | Current enforcement | Evidence |
|---|---|---|---|
| P-1 | `main` changes only through a PR with green `CI Gate` and `Staging Gate` (strict) | `main` ruleset, no bypass actors | live ruleset 17358515 |
| P-2 | No force-push or deletion of `main` | ruleset `non_fast_forward`, `deletion` | live ruleset |
| P-3 | CI agents hold no write credentials; only trusted publisher/merge jobs hold the App token | workflow structure | builder/RE workflows; existing workflow tests |
| P-4 | Existing migrations are immutable; new migrations are forward-only | builder publisher L43; Database Migration Gate | `publish-feature-builder-change.mjs`; `ci.yml` |
| P-5 | Security-sensitive pending migrations reach staging only via reviewed preview with required reviewers | `staging-migration-approval` env | live environments; `staging-reviewed-migration-preview.yml` |
| P-6 | Production release requires exact provenance (CI Gate on main, Staging Gate tree identity) | `production-release.yml` | workflow + contract tests |
| P-7 | Recovery auto-merge limited to `claude/recovery-*`, publisher-only history, risk classifier | auto-merge policy + recovery ruleset | `release-engineer-auto-merge-policy.mjs` |
| P-8 | Hooks are inert in CI | `isCI()` | `.claude/hooks/local-hook.mjs` L12, L55 |
| P-9 | Migration 262 and historical approval records are unchanged | review discipline; Database Migration Gate | `supabase/migrations/262_*`, `docs/staging-previews/**`, `supabase/staging-reviewed-migrations.json` |
| P-10 | Customer-agent execution, grants, decide-v2 and billing stay inactive unless a human activates them through H-series procedures | H-series design | `docs/agent-harness/` |

## 3. Current test coverage of these invariants

| Area | Existing coverage | Gap |
|---|---|---|
| Workflow structure (builder, RE, auto-merge, production request, staging, mobile CI, security scan) | ≈70 Node contract files, run in CI Gate (`ci.yml` L388) | None for developer-harness local policy (none exists yet) |
| Migration safety | `check-migrations`, `destructive-db-guard`, `migration-security-classifier`, `database-safety-contract` tests | — |
| Local Claude settings/hooks | **None** | Phase 2 |
| Developer role tool scopes | **None** (no roles exist) | Phase 4 |
| Checkpoint/resume | **None** | Phase 5 |
| V2 contract consistency | Phase 1 tests (`scripts/developer-harness-v2/`) — local only, not in CI until Phase 8 | Phase 8 |

## 4. Required negative test cases (specifications for later phases)

These are **specifications only**. They must run against the local policy engine with fixtures, mocks or
throwaway local repositories. None may be executed against GitHub, staging, Supabase, Railway, Vercel, Expo or
production.

| ID | Case | Input fixture (examples) | Expected | Test location | Phase |
|---|---|---|---|---|---|
| N-1 | Direct push to protected `main` | `git push origin main`, `git push origin HEAD:main`, `git push -u origin feature:main`, `node -e "...git push origin main"` | `forbidden` | local (policy engine) | 2 |
| N-2 | Force-push / rebase of reviewed history | `git push --force`, `-f`, `--force-with-lease`, `+refs/...`, `git rebase` on a branch with an open PR | `forbidden` | local (policy + throwaway repo) | 2 |
| N-3 | Unauthorized migration modification | Edit/rename/delete of `supabase/migrations/262_agent_verified_human_identity.sql` or any existing migration; `supabase migration repair` | `forbidden` | local | 2 |
| N-4 | Protected workflow modification | Write to `.github/workflows/ci.yml`, `staging-candidate.yml`, any `.github/**` | `human_approval` (never autonomous) | local | 2 |
| N-5 | Production deployment attempt | `railway up`, `vercel deploy --prod`, `eas update --branch production`, `gh workflow run production-release.yml` | `forbidden` | local | 2 |
| N-6 | Staging credential misuse | Read of staging/production `.env*`; `gh workflow run staging-*`; new workflow with `environment: staging` | `forbidden` / `human_approval` | local | 2 |
| N-7 | Stale PR-head approval | Approval recorded for SHA A, action requested at SHA B | rejected; state `blocked` | local (checkpoint fixtures) | 5 |
| N-8 | Untrusted instructions in tool output | Fixture PR comment / CI log / README containing directives | no action derived; content flagged | local (coordinator fixtures) | 2, 4 |
| N-9 | Resumption from invalid checkpoint | Checkpoint whose branch was rewritten, base moved, hash tampered, or approval expired | resume refused | local | 5 |
| N-10 | Unauthorized subagent tool escalation | Reviewer definition requesting `Write`/`Bash(git push*)`; role asks another to widen scope | rejected by role-scope test | local (static) | 4 |
| N-11 | Accidental customer-agent activation or billing | Diff setting agent activation flags, inserting decide-v2 grants, enabling billing; command calling activation endpoints | `forbidden`; security reviewer required | local | 2, 4 |
| N-12 | Hook / CI bypass | `--no-verify`, `-c core.hooksPath=`, edits to `.claude/settings.json` / `.wolf/hooks/**` | `forbidden` / `human_approval` | local | 2 |

## 5. Where each invariant can be verified

| Invariant / case | Local (no credentials) | Needs CI | Needs live GitHub evidence | Needs separate human review |
|---|---|---|---|---|
| V2 contract consistency (Phase 1 tests) | ✔ | Phase 8 | — | — |
| N-1…N-12 policy decisions | ✔ | Phase 8 | — | — |
| P-1, P-2 ruleset state | — | — | ✔ (`gh api` read-only) | Ruleset changes |
| P-3, P-6, P-7 workflow structure | ✔ (existing contract tests) | ✔ (already in CI Gate) | — | Control-plane PRs |
| P-4 migration immutability | ✔ (partial) | ✔ (Database Migration Gate) | — | New migrations |
| P-5 reviewed preview | — | — | ✔ (environment config) | ✔ (required reviewers) |
| P-9 frozen artifacts | ✔ (git diff vs baseline) | ✔ | — | — |
| P-10 customer-agent inactive | ✔ (diff scan) | partial | — | ✔ (H-series activation) |
| Staging isolation (audit S-4) | — | — | ✔ | ✔ (environment protection is human-owned) |
