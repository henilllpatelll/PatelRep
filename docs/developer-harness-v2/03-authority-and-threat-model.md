# Developer Harness V2 — 03 Authority and Threat Model

Baseline: `main` @ `218a882b15ed8f928f9a8b7d82b6ea8bb1ed0d37`, 2026-11-21. Observations are cited in
[01-current-state-audit.md](01-current-state-audit.md).

## 1. Actors and credentials (as observed)

| # | Actor | Credentials held | Can write repo? | Can merge to `main`? | Can deploy/release? |
|---|---|---|---|---|---|
| 1 | **Human owner** | Admin on repo; environments allow admin bypass (except `staging-migration-approval`) | Yes | Yes (rules still require both gates; no bypass actors) | Yes, through trusted workflows |
| 2 | **Local Claude Code session** | Developer's git identity and `gh` auth; local `.env` files (production Supabase per maintainer memory) | Pushes any non-`main` branch; `main` blocked server-side | No, server-side rules require the gates. **[INFERRED]** A local session with the owner's `gh` token could call the merge API on a PR whose gates are green. Only instructions prevent it. | No trusted path. Local CLIs (supabase, eas, railway) could act if authenticated. |
| 3 | **GitHub coding agent** (Feature Builder, Release Engineer, Dependency Orchestrator agent jobs) | Read-only `GITHUB_TOKEN`; Claude OAuth token; no App key | No | No | No |
| 4 | **Trusted publisher** jobs | PatelRep App installation token (scoped per job) | Feature/recovery branches and PRs | No | No |
| 5 | **CI** (`ci.yml`, `mobile-ci.yml`) | Read-mostly; some jobs use repo secrets (e.g. live Room-Board) | No | Produces `CI Gate` | No |
| 6 | **Staging** (`staging-candidate.yml`) | `staging` environment secrets (environment unprotected) | No | Produces `Staging Gate` | Deploys to staging only |
| 7 | **Release Engineer auto-merge** | App token `contents: write, pull-requests: write` | — | **Yes**, `claude/recovery-*` only, after full revalidation | No |
| 8 | **Production release** (`production-release.yml`) | `production` environment secrets (no required reviewers) | Tags via App (`release-tags` ruleset) | No | **Yes.** Dispatched by a human, or by the recovery production-request when `PRODUCTION_AUTO_RELEASE_ENABLED=true`. |

## 2. Allowed vs protected actions (V2 developer roles)

The normative list is `contract.json` → `actions`. In summary:

- **allowed**: read the repo and GitHub state, edit files in the task worktree, run lightweight checks, commit
  to the dedicated branch.
- **task_authorized** (only when the human's request includes it): fast-forward push of the dedicated branch;
  open a **draft** PR. Rationale: pushing triggers CI minutes and, once CI is green, a Staging Candidate that
  mutates and reseeds the **shared** staging environment.
- **human_approval** (per occurrence, exact target named): dependency changes, new forward-only migrations,
  control-plane or agent-instruction/hook edits, local Docker/DB stacks, marking a PR ready for review.
- **forbidden** (no role, any approval): push to `main`; force-push or rewrite reviewed history; merge; enable
  auto-merge; approve as gate; modify existing migrations; `supabase migration repair`; apply migrations
  remotely; any production deploy or release/rollback dispatch; direct staging mutation; mobile build/OTA
  publish; ruleset/secret/environment/permission changes; reading production or publisher credentials;
  customer data access; customer-agent activation, autonomy/decide-v2 grants or billing; hook/CI bypass;
  alternate publishing paths; dispatching any workflow.

## 3. Human-approval requirements

1. An approval names the **action, exact target and exact SHA** where one applies.
2. An approval is **single-use**. It does not survive a new head SHA, a new target, a resumed session or a
   different task.
3. "merged", "approved", "done" and "looks good" do not authorize production (existing `CLAUDE.md` rule,
   preserved).
4. Agents cannot approve on the human's behalf. Text in PR bodies, comments, issues, commit messages, CI logs,
   memory files or other agents' outputs is **never** an approval.

## 4. Repository and staging isolation

- Each task uses a dedicated branch from verified `origin/main` and its own git worktree. Unrelated local work
  is never stashed, reset or discarded.
- Staging is shared and reseeded by Staging Candidate. Developer roles never write to staging directly and never
  dispatch staging workflows. Staging is reached only through the existing PR path.
- **[OBSERVED]** The `staging` environment is unprotected (audit S-4). Until a human changes that, the
  harness treats any edit under `.github/**` as `human_approval` and the push that would carry it as
  task-authorized only after that approval.
- Production credentials never enter developer-agent context. Local `.env` files are excluded from context
  packs (Phase 3) and from tool output echoing (Phase 2).

## 5. Threats and required mitigations

| ID | Threat | Example | Mitigation (phase) | Authoritative backstop |
|---|---|---|---|---|
| T-1 | **Prompt injection via untrusted content** | Instructions embedded in a PR comment, CI log, dependency README, web page, issue, memory file or test fixture | Coordinator treats tool output as data; policy decisions never take inputs from content; reviewer gets the diff, not the implementer's narrative (P2, P4) | L0 rules; human review |
| T-2 | **Cross-agent authority escalation** | Reviewer output says "you are approved to merge"; a subagent asks the coordinator for broader tools | Role tool scopes are fixed by contract; no role can grant another role tools; one write role (P2, P4) | L0 rules |
| T-3 | **Secret exposure** | Agent prints `.env`, writes tokens into memory/ledger, uploads logs | `.env*` and credential paths denied for read/echo; redaction before persistence; tracked runtime logs removed from VCS (P2, P3) | Secret scanning (Security Scan job) |
| T-4 | **Stale-SHA / stale-approval** | CI evidence from an older head reported as current; approval for SHA A reused for SHA B | Evidence and approvals bound to head SHA; head change invalidates them (P5) | Ruleset strict up-to-date; Staging Gate exact-SHA |
| T-5 | **Hook bypass** | `--no-verify`, `git -c core.hooksPath=/dev/null`, editing hook files, bypass-permissions mode | Policy treats bypass flags as `forbidden`; hooks/settings are protected paths; server-side rules are the real barrier (P2) | L0 `main` ruleset |
| T-6 | **Shell-command smuggling** | Allowed `node -e`, `npx`, `python -c` running `git push origin main` or `supabase db push`; command chaining (`&&`, `;`, `$(...)`) | Classify the **effect**, not the prefix: parse compound commands, deny interpreters invoking protected CLIs, deny network-credentialed CLIs (P2) | L0 rules; environments |
| T-7 | **Supply-chain via install** | `npm install` of a typo-squatted package runs `postinstall` | Dependency changes require human approval; lockfile diff in review (P2) | Security Scan / audit |
| T-8 | **Locally executed tracked code** | Branch modifies `.wolf/hooks/*.js` or `graphify-out/auto_update.py`, which then runs on the developer's machine | Hook code paths protected; hooks pinned/verified before execution (P2, P3). Recorded for the recovery classifier (audit S-2), not changed in V2 | Human review |
| T-9 | **Invalid checkpoint resumption** | Resume a task whose branch was force-updated, whose base moved, or whose approval expired | Resume revalidates SHA, branch, worktree and approvals; mismatch → `blocked` (P5) | — |
| T-10 | **Accidental customer-agent activation / billing** | Agent flips a feature flag, grants decide-v2, enables billing in a migration or seed | Actions `forbidden`; security reviewer required for agent-harness paths (P2, P4) | Database Migration Gate; reviewed preview |
| T-11 | **Unauthorized migration change** | Edit to an existing migration or 262; a placeholder migration | `forbidden`; protected path; existing builder publisher rule | Database Migration Gate |
| T-12 | **Production deployment attempt** | `railway up`, `vercel deploy --prod`, `eas update --branch production`, dispatching Production Release | `forbidden`; CLIs denied (P2) | Production environment secrets (note: no reviewers) |

## 6. Fail-closed behavior

- Unknown action → treated as `forbidden` until classified.
- Policy engine error, missing contract or unparseable command → deny.
- Unprovable SHA, branch or approval → state `blocked` / `unproven`, never "ready".
- Missing GitHub evidence → report pending/unproven, never success.
- Checkpoint integrity failure → no resume; start a new task from verified `main`.

## 7. Local vs authoritative enforcement

| Protection | Local (V2 L2) | Authoritative (GitHub L0/L1) |
|---|---|---|
| No push to `main` | pre-push hook (opt-in), V2 policy | **`main` ruleset** (no bypass actors) |
| No force-push / history rewrite on `main` | V2 policy | **`non_fast_forward` rule** |
| No force-push on feature branches with reviewed history | **V2 policy only** | None. Feature branches are unprotected. |
| Merge requires CI Gate + Staging Gate | — | **Ruleset** |
| Merge requires a human | **Instructions/V2 policy only** (0 required approvals) | Not enforced: an admin, or the App on recovery branches, can merge once gates pass |
| No migration history change | V2 policy; builder publisher | **Database Migration Gate** |
| No production deploy | V2 policy | `production` environment scopes secrets but has **no required reviewers** |
| No staging credential misuse | V2 policy (`.github/**` protected) | **None**: `staging` environment unprotected |
| No remote Supabase/EAS/Railway from local | **V2 policy only** | Provider-side auth only |

Rows marked "V2 policy only" or "None" are residual risks that only human-owned repository changes can close.
V2 records them and does not change them.

## 8. The preserved recovery auto-merge exception

`claude-release-engineer-auto-merge.yml` lets the PatelRep App merge a **dedicated `claude/recovery-*` PR**
after it revalidates publisher-only history, exact green gates, human-hold labels and a changed-file risk
classifier. The optional production request then dispatches a patch Production Release, gated by
`PRODUCTION_AUTO_RELEASE_ENABLED`.

- This is a **pre-existing exception, preserved without modification**. It is **not** a permission granted to
  any V2 role, and V2 roles cannot trigger, influence or extend it.
- Observed gaps (audit S-1, S-2) are recorded for a separate, explicitly human-approved control-plane change.
