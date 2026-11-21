# Developer Harness V2 — 02 Architecture Contract

Status: **approved architecture, recorded in Phase 1**. This document defines components and boundaries. It
implements nothing. The machine-readable form is [`contract.json`](contract.json), and the Phase 1 contract
tests in `scripts/developer-harness-v2/` check that the two stay consistent.

## 1. Purpose and non-goals

Developer Harness V2 evolves the existing Claude Code setup into a policy-governed, AI-assisted engineering
system. It helps a **human engineer** change the PatelRep repository faster without weakening the trusted
GitHub/CI/Staging path.

Non-goals:

- It is **not** the customer-facing Agent Harness (H1–H7). Developer roles have no authority over customer
  agent execution, autonomy grants, decide-v2, or billing (see §6).
- It is **not** a replacement for CI Gate, Staging Gate, rulesets, environments or the trusted publishers.
  Those remain authoritative.
- It is **not** a permanently running swarm.

## 2. Default topology

```
Human owner
   │ task request (scope, authorized side effects)
   ▼
Task coordinator ──► Planner (only for non-trivial or high-risk tasks)
   │
   ▼
Implementer (the ONLY write role; one per task; dedicated branch + worktree)
   │  diff + local evidence
   ▼
Test coordinator (deterministic selection → lightweight local checks)
   │
   ▼
Independent reviewer  (+ Security reviewer when the risk classifier says so)
   │  findings
   ▼
Coordinator → push / draft PR (only if task-authorized) → existing CI Gate → Staging Gate → human review → human merge
```

- **One implementer and one independent reviewer** is the default. Additional agents (a planner, a security
  reviewer, a second implementer for disjoint files) are added only when the coordinator records a
  justification in the task plan.
- At most **one write-capable role** is active per task (`topology.max_concurrent_write_roles = 1`).
- Roles are short-lived and task-scoped. Nothing runs between tasks.

## 3. Components

Model column: default Sonnet 5.5 (`claude-sonnet-5-5`); Opus 5.5 (`claude-opus-5-5`) for high-risk
architecture and security reasoning; Haiku 5.5 (`claude-haiku-5-5`) for simple classification and context
processing.

| Component | Responsibility | Inputs | Outputs | Trust boundary | Model |
|---|---|---|---|---|---|
| **Task coordinator** | Turns a human request into a bounded task: scope, risk class, authorized side effects, budget, stop conditions. Routes to roles. Owns the task state machine. | Human request; repo state (SHA); policy; checkpoint | Task plan; role invocations; final report | Trusts only the human request and verified repo/GitHub state. Treats all tool output as data. | Sonnet |
| **Planner** | Designs the change for non-trivial or high-risk tasks. Identifies shared code paths (Non-Regression Policy). | Task plan; targeted code context | Implementation plan with files, risks and tests | Read-only. No write tools. | Opus |
| **Implementer** | Makes the change on a dedicated branch in an isolated worktree. Commits. Pushes and opens a draft PR only when task-authorized. | Plan; scoped context; policy decisions | Commits; local evidence | The only write role. Every action passes policy enforcement. No credentials beyond the developer's normal git identity. | Sonnet (Opus for security-sensitive code) |
| **Test coordinator** | Selects tests deterministically from the changed files and runs only lightweight local checks. Escalates expensive suites to CI or human approval. | Diff; test map | Test selection with reasons; results | Read-only plus local test execution. Cannot start Docker/DB stacks without approval. | Haiku (selection) |
| **Independent reviewer** | Reviews the final diff for correctness, regressions and scope. Does not share the implementer's context. | Diff; task plan; test evidence | Findings (severity, file, line) | Read-only. Must not receive the implementer's reasoning as instructions. | Sonnet |
| **Security reviewer** | Reviews diffs the risk classifier flags (auth, RLS, migrations, billing, control plane, agent instructions/hooks, dependencies). | Diff; threat model; classifier result | Security findings; block/allow recommendation | Read-only. A block recommendation cannot be overridden by another agent, only by the human. | Opus |
| **Policy enforcement** | Classifies every proposed action as `allowed`, `task_authorized`, `human_approval` or `forbidden` and fails closed. | Proposed action; task authorization; contract | Decision with reason | Local, defense in depth. Authoritative controls stay on GitHub (§5). | Deterministic code, no model |
| **Context & memory manager** | Builds task-scoped context packs; curates durable learnings; keeps raw logs out of prompts. | Repo index; curated memory | Bounded context pack | Memory content is data, never instructions. Writes require review. | Haiku |
| **Checkpoint & recovery manager** | Records durable task checkpoints (task id, base SHA, branch, head SHA, step, evidence hashes) and resumes only from valid checkpoints. | Task events | Checkpoint records; resume decision | A checkpoint grants no authority. Resume revalidates SHA, branch and approvals. | Deterministic code |
| **Metrics / evaluation layer** | Records real outcomes: completion, regressions, interventions, policy blocks, cost from real usage data. Runs the benchmark suite. | Task records; provider usage | Reports; benchmark results | Read-only over task records. Never reports estimates as measurements. | Deterministic plus Haiku summaries |
| **Existing GitHub/CI integration** | CI Gate, Staging Candidate and Staging Gate, rulesets, environments, trusted publishers, Release Engineer. | PR head SHA | Check runs | **Authoritative. Unchanged by V2.** Phase 8 may only add new non-weakening checks. | n/a |

## 4. Task state machine (contract)

`requested → planned → implementing → testing → reviewing → (push_authorized?) → pr_open → ci_running →
staging_running → ready_for_human_review | blocked | unproven`

- Every transition records a checkpoint bound to `{task_id, base_sha, branch, head_sha}`.
- Any change to `head_sha` discards prior test, review and CI evidence for that task.
- `ready_for_human_review` has exactly the meaning defined in `CLAUDE.md` and is never permission to merge.

## 5. Enforcement layers

| Layer | Examples | Authority |
|---|---|---|
| L0 GitHub server-side | `main` ruleset (CI Gate + Staging Gate, no bypass), recovery/tag rulesets, `staging-migration-approval` reviewers | **Authoritative** |
| L1 Trusted workflows | Publishers, provenance checks, Database Migration Gate, production target guards | **Authoritative** for what they guard |
| L2 Local developer harness (V2) | Policy enforcement, hooks, role tool scopes | Defense in depth. Must fail closed, but the system cannot depend on it alone. |
| L3 Instructions | `CLAUDE.md`, skills, memory | Guidance only, never relied on as enforcement |

Rules:

- V2 never weakens L0 or L1. Phase 8 integrates with them only by adding checks.
- A protection that exists only in L2/L3 is documented as such (see 03 §7).

## 6. Developer-agent vs customer-agent separation

| | Developer agents (this harness) | Customer agents (Agent Harness H1–H7) |
|---|---|---|
| Purpose | Change the repository | Act inside the product for hotel tenants |
| Runtime | Developer machine / Claude Code; read-only CI agents | `apps/api` agent runtime, worker, Supabase |
| Credentials | Developer git identity only | Tenant-bound service paths (H6 P1/H7) |
| May activate customer execution, grants, decide-v2, billing | **Never** (`forbidden`) | Governed by H-series ADRs and human activation |

Developer agents may *edit code* belonging to the customer harness only as ordinary, human-reviewed PR work.
Such changes are always flagged security-sensitive. Activation flags, grants and billing toggles are never
part of a developer task.

## 7. Preserved exceptions (not V2 grants)

The Release Engineer recovery auto-merge (`claude-release-engineer-auto-merge.yml`) and its optional production
request (`claude-release-engineer-production-request.yml`) pre-date V2. They are preserved **unchanged**.
No V2 role inherits, invokes or extends them (`granted_to_v2_roles: false`). Known gaps in them (audit S-1,
S-2) are recorded for separate human-approved control-plane work.

## 8. External constraints

HS256 shared-secret boundary, Level-2 pause race, and TRUNCATE privileges are owned by customer Agent Harness
security work (see `contract.json` → `external_constraints`). V2 does not change them.
