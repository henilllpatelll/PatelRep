# Developer Harness V2 — Phase 4: Specialized Roles and Deterministic Routing

Scope: PatelRep's internal **developer** harness. It has no authority over the customer Agent Harness (H1–H7).
Status: implemented on PR #247 (draft). The OpenWolf M1 protected-path hardening was **approved by the human owner and applied in a separate remediation commit** (section 5).

## 1. What was added

| Item | Location |
|---|---|
| Seven Claude Code role definitions | `.claude/agents/{coordinator,planner,implementer,test-coordinator,independent-reviewer,security-reviewer,context-manager}.md` |
| Tool → contract-action capability map, agent-file parser, subset check | `scripts/developer-harness-v2/routing/role-capabilities.mjs` |
| Deterministic router, spawn guard, finding evaluator | `scripts/developer-harness-v2/routing/router.mjs` |
| Tests (44 + 10 M1) | `scripts/developer-harness-v2/routing/{roles,router}.test.mjs` |

No Phase 1 or Phase 2 file, workflow, migration, product code or memory file was modified. Nothing here starts an agent: the router returns a **plan**.

## 2. Roles: models and actual tools

Role identity, model and permitted actions come from `contract.json → roles`. The definition files carry the model id verbatim; tests fail if they diverge.

| Role | Model | Effective tools | Contract `may_perform` it can reach |
|---|---|---|---|
| coordinator | claude-sonnet-5-5 | Read, Grep, Glob | read_repository |
| planner | claude-opus-5-5 | Read, Grep, Glob | read_repository |
| implementer | claude-sonnet-5-5 | Read, Grep, Glob, Edit, Write, Bash, PowerShell | all seven of its actions (hook-gated) |
| test_coordinator | claude-haiku-5-5 | Read, Grep, Glob | read_repository |
| independent_reviewer | claude-sonnet-5-5 | Read, Grep, Glob | read_repository |
| security_reviewer | claude-opus-5-5 | Read, Grep, Glob | read_repository |
| context_manager | claude-haiku-5-5 | Read, Grep, Glob | read_repository |

Design decisions, stated plainly:

* **Claude Code restricts a role only through `tools` / `disallowedTools`.** A prompt saying "read-only" restricts nothing, so every non-writer has no `Edit`, `Write`, `Bash`, `PowerShell`, `Agent`, network or MCP tool.
* **A shell is never mapped to a harmless subset.** `Bash`/`PowerShell` map to every unprompted action the hook can allow (reads, writes, commits, fast-forward pushes, draft PRs). Therefore only the implementer holds one.
* **Consequence (honest limitation):** the coordinator, test coordinator and reviewers cannot run the router, tests or `gh`. They receive the plan, diff and objective evidence as data from the human session or implementer. The contract grants them `read_github_state` / `run_lightweight_local_checks`, which they cannot exercise natively. The coordinator is therefore a read-only analysis role: it cannot launch anyone itself (it has no `Agent` tool). Launching is done by the human's primary session, and `checkSpawn` is an advisory/testable rule, not an in-process enforcement point; making it binding needs a hook (Phase 5). A restricted, tested adapter that exposes only those effects is a Phase 5 item; no unrestricted shell or MCP server was substituted.
* The Phase 2 hook is **not role-aware**: it classifies the effect of a call whichever role made it. It remains the enforcement layer for the implementer; it is not a reason to hand a shell to a read-only role.
* The `Agent` tool is classified harmless by Phase 2 (subagent calls pass through the hook). Delegation is therefore prevented by **omitting `Agent` from every role**; the tests assert it.
* Frontmatter is limited to `name, description, tools, disallowedTools, model`. Unsupported or behavior-changing keys (`permissionMode`, `hooks`, `mcpServers`, `background`) are rejected by a test.

## 3. Router

`planRouting({ task, files, surface, modification, authorize, labels, metadata, observations, availableModels })` → plan (`developer-harness-v2/routing-plan@1`):
`status` (`routed | needs_clarification | blocked`), `risk`, `context_pack`, `roles.required/optional` (with model, may_perform, justification, reason codes), `sequence`, `reviews`, `human_approvals`, `side_effects_authorized`, `topology`, `extra_role_justifications`, `handoffs`, `reason_codes`, `stop_conditions`, `ignored_inputs`.

Rules (no model call):

1. **Default**: coordinator (primary session) + one implementer + one independent reviewer.
2. **Planner** is required for migrations/RLS/customer-harness changes, ≥3 security triggers, or a high-risk change that is also complex; and for any complex change (≥8 files, ≥3 areas, architecture wording). It is optional (justification recorded) for a single security trigger on a small change.
3. **Security reviewer (Opus) is mandatory** when any of the 15 named triggers or the unknown-scope trigger fires, from **either** a path signal (camelCase/PascalCase names are split into words) or a task-text signal. The text signals are heuristics and can be evaded by unusual wording; they are a first line, backed by the path signals, the unknown-scope fallback and the mandatory diff re-route below. Stronger classification wins on mixed changes. Negated or suppressing wording ("skip the security review", "not auth related") is recorded as `INPUT.SUPPRESSION_ATTEMPT_IGNORED`, never obeyed, and raises risk.
4. **Unknown scope**: any path outside the ordinary product directories (`apps/{web,mobile,api}` source dirs, non-protected `docs/**.md`, `README.md`), or modification types `migration|config|dependency`, triggers security review.
4a. **Paths are normalized** (`path.posix.normalize`). Absolute, drive-qualified, `~` or repository-escaping paths are refused (`STOP.INVALID_PATH`); `modification` is lower-cased and must be a known value (`STOP.UNKNOWN_MODIFICATION`); a `rename` must list both old and new path (`STOP.INCOMPLETE_RENAME`).
4b. **A plan is advisory and built from predicted paths.** `verifyDiffAgainstPlan(plan, changedFiles)` re-routes the same human task over the files actually changed (`git diff --name-only --no-renames <base>...HEAD`, or `router.mjs --diff-base <ref>`). Any added trigger, role or approval invalidates the plan. This pass must be run from the human session, not by the implementer, before review proceeds.
5. **Human approvals** are derived from `contract.json` action classes (protected path → `modify_control_plane_files` / `modify_agent_instructions_or_hooks`; new migration → `author_new_forward_only_migration`; dependency change → `install_or_upgrade_dependencies`). Modifying an existing migration is a `forbidden` stop.
6. **Forbidden intents** (merge, auto-merge, force-push, production deploy/release/rollback, workflow dispatch, push to main, activate customer agents / billing, applying migrations to staging or production, reading production credentials) are refused: `status: blocked`, no roles.
7. **Ambiguous scope** (no files, no surface, no recognizable task) → `needs_clarification`; no role, no side effect.
8. **Task-authorized side effects** (`push`, `open_draft_pr`, `comment_on_pr`) are honored only when named in the human's `authorize` list.
9. **Models** come from the contract. If `availableModels` is given and a required model is missing the plan is `blocked` with `STOP.MODEL_UNAVAILABLE`; there is no silent substitution.
10. **Untrusted input**: `observations` (file text, tool output, PR bodies, agent messages) and authority-shaped `metadata` keys (`approved`, `roles`, `tools`, `skip_*`, `risk`, `model`…) can never change the plan; they are counted/recorded.

`checkSpawn(plan, request, state)` is the coordinator's launch guard: role must be in the plan; optional roles need a justification; one subagent at a time; at most one write-capable role; one launch per role; no nested, background, shell-launched (`claude -p`, other CLI, MCP) or tool/model/permission-overriding launches; only the coordinator may launch. Real prevention is the missing `Agent` tool plus the Phase 2 `launch_nested_agent_session` classification of shell launches; the guard makes the rule explicit and testable.

`planRouting` accepts a caller-supplied contract only if it is identical to the repository's on roles, actions, protected paths and topology.

`evaluateFinding` encodes that reviewer output is evidence (`authorizes: false`) and a critical/high finding is closed only by remediation plus re-review or an explicit human decision. The resolution object is plain data: only the human session may construct one; nothing here proves who built it (Phase 5 should bind it to a Phase 2 approval record).

Note: a `--agents` command-line flag can define agents that shadow these files; the project files are the reviewed definitions.

### Context packs
The plan names a Phase 3 pack (`CATEGORIES`) and passes only that pack's instruction/doc/memory-topic references per role. The independent reviewer's handoff lists the implementer's reasoning as **withheld**. The security reviewer additionally gets the threat-model, Phase 2 and contract references for high-risk work. Memory is data and never grants tools.

## 4. Economy and reliability

Default is two spawned agents. Extra roles require a recorded justification in the plan. No daemon, no persistent swarm, no recursive spawning, no background agents, no automatic paid background work. No billing logic was added; Phase 7 owns cost. Measured real usage of the runtime probe (7 one-turn calls, no tool use): ≈ US$0.19 total as reported by the CLI (`total_cost_usd`).

## 5. M1: OpenWolf protected-path hardening — APPROVED AND APPLIED

Residual finding M1 (Phase 3): OpenWolf files that influence developer-agent instructions or memory were not protected paths, so an agent edit was `allowed`; `CLAUDE.md` imports `@.wolf/OPENWOLF.md`.

**Human approval:** the owner approved M1 as proposed, **including `.wolf/identity.md`**, for exactly these nine paths and for changes limited to `contract.json`, `policy-engine.mjs`, `path-policy.mjs`, fixtures/tests and this document.

```
.wolf/OPENWOLF.md   .wolf/config.json   .wolf/cron-manifest.json   .wolf/cerebrum.md   .wolf/knowledge/**
.wolf/anatomy.md    .wolf/buglog.json   .wolf/reframe-frameworks.md                      .wolf/identity.md
```

**What changed (all additive):**
1. `contract.json` — nine entries appended to `protected_paths` (previous 19 kept, in order) and a `m1_hardening` audit block (approval, paths, the transient files deliberately not protected, the additive rule).
2. `policy-engine.mjs` — the same nine appended to `REQUIRED_PROTECTED_PATHS`, so a contract that omits any one is rejected (`contract.paths_weakened`) and every call is denied.
3. `path-policy.mjs` — `.wolf/OPENWOLF.md`, `.wolf/cerebrum.md`, `.wolf/knowledge/**`, `.wolf/reframe-frameworks.md` and `.wolf/identity.md` join `AGENT_INSTRUCTION_GLOBS`, so they report `modify_agent_instructions_or_hooks`; `config.json`, `cron-manifest.json`, `anatomy.md` and `buglog.json` report `modify_control_plane_files`. Both labels are `human_approval`; the class never differs.
4. Tests: `policy-fixtures-m1.mjs` (61 fixtures), `m1-hardening.test.mjs` (10 tests), `fixtures-baseline-pre-m1.json` (the classification of all 528 earlier fixtures under the Phase 3 engine).

**Before → after (agent Write/Edit/shell/GitHub file write):** the nine paths `allowed` → `human_approval`. Nothing else moved: all 528 earlier fixtures classify identically (asserted per id, and no rank decreases), and `actions`, `protected_infrastructure`, `roles` and `topology` have unchanged digests.

**Deliberately not protected (transient, rewritten by hooks):** `.wolf/memory.md`, `token-ledger.json`, `cron-state.json`, `suggestions.json`. `.wolf/hooks/**` — including `_session.json` — was already protected. `.wolf/hooks/*.js` were not modified.

**Compatibility:** an agent edit to `cerebrum.md`, `anatomy.md`, `buglog.json`, `identity.md` or `knowledge/**` now prompts for approval, and in `bypassPermissions`/`dontAsk`/`auto` modes it is denied. Phase 3 made OpenWolf bookkeeping optional and OpenWolf's own hooks write through Node, not a tool call, so routine sessions are unaffected. Reads are unchanged.

## 6. Verification evidence

* Unit: `roles.test.mjs` (19) and `router.test.mjs` (25, including regression fixtures for every input the independent review found routed as low risk) — roles/models/tool subset, router rules, 15 trigger classes by path and by text, ambiguity, forbidden intents, determinism, injection fixtures (untrusted observations and authority metadata leave the plan byte-identical), spawn guard.
* Regression: Phase 1 (12), Phase 2 engine (543) and hook (16), sandbox env (6), Phase 3 context (48); ten workflow/recovery contract suites (213). All pass.
* Runtime (sanitized scratch project containing only the role files, `--setting-sources project`, empty `--strict-mcp-config`, `--max-turns 1`, no tool use): every role loaded; `modelUsage` showed the contract model for each; the model reported exactly the expected tool list; `subagent_stats.spawned = 0`.
* **NOT VERIFIED at runtime for the roles:** hook enforcement during a role's own write attempt, reviewer behavior under an adversarial prompt, and the `Agent`-tool absence under a delegation request. Hook enforcement itself is covered by the Phase 2 manual runtime harness and the unit tests above. A model's refusal is not counted as proof.

## 7. Independent Opus 5.5 review (read-only context)

First pass: **NO-GO on the router, role files sound.** Findings and disposition:

| ID | Finding | Disposition |
|---|---|---|
| H1 | `auth(?!or)` skipped "authorization/authorize" | Fixed; tests |
| H2 | camelCase file names (`LoginForm.tsx`, `useAuth.ts`) dodged path triggers | Fixed (words split); tests |
| H3 | `../` and absolute paths bypassed every check | Fixed (normalize + `STOP.INVALID_PATH`); tests |
| H4 | Routing only before the work | Fixed: `verifyDiffAgainstPlan` + `--diff-base`; must be run by the human session |
| M1 | Text signals missed common wording | Broadened; still heuristic (stated above) |
| M2 | Forbidden-intent regexes evadable | Broadened, labels checked; Phase 2 hook remains the real block |
| M3 | Renames hid the old path | Rename must list both paths |
| M4 | Coordinator cannot orchestrate; guard advisory | Documented; binding guard deferred to Phase 5 |
| M5 | "reliably" overstated | Reworded; plan declared advisory |
| L1–L4 | modification case/validation; resolution object is data; caller-supplied contract; `--agents` shadowing | Fixed / documented |

A re-review of the fixes was not performed; the fixes are covered by deterministic tests only.
