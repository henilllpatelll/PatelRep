# Developer Harness V2 — Phase 4: Specialized Roles and Deterministic Routing

Scope: PatelRep's internal **developer** harness. It has no authority over the customer Agent Harness (H1–H7).
Status: implemented on PR #247 (draft). The OpenWolf M1 protected-path hardening was **approved by the human owner and applied in a separate remediation commit** (section 5).

## 1. What was added

| Item | Location |
|---|---|
| Seven Claude Code role definitions | `.claude/agents/{coordinator,planner,implementer,test-coordinator,independent-reviewer,security-reviewer,context-manager}.md` |
| Tool → contract-action capability map, agent-file parser, subset check | `scripts/developer-harness-v2/routing/role-capabilities.mjs` |
| Deterministic router, spawn guard, finding evaluator | `scripts/developer-harness-v2/routing/router.mjs` |
| Tests (49 routing + 10 M1) | `scripts/developer-harness-v2/routing/{roles,router}.test.mjs` |

The only Phase 1/2 files modified are the three the owner approved for M1 (`contract.json`, `policy-engine.mjs`, `path-policy.mjs`; section 5) plus their fixtures/tests; no workflow, migration, product code, `.wolf/hooks/*.js` or memory file was modified. Nothing here starts an agent: the router returns a **plan**.

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

* Unit: `roles.test.mjs` (19) and `router.test.mjs` (30, including regression fixtures for every input either independent review found routed as low risk) — roles/models/tool subset, router rules, 15 trigger classes by path and by text, ambiguity, forbidden intents, determinism, injection fixtures (untrusted observations and authority metadata leave the plan byte-identical), spawn guard.
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

### Final independent review (new Opus 5.5 context, on a07b4d3e)

Verdict **NO-GO** for readiness; M1 and the role files were sound. Four blockers, all fixed afterward and covered by tests:

| Finding | Disposition |
|---|---|
| `--diff-base` was parsed but never used (the documented second pass silently planned over zero files) | Implemented: `router.mjs --diff-base <ref>` plans over `git diff --name-only --no-renames <ref>...HEAD`; `--verify-plan <plan.json> --diff-base <ref>` is the mandatory pass (exit 1 if the plan was insufficient). Hostile refs are rejected; unknown CLI options now fail |
| H1 leftovers: "unauthenticated", anonymous, CORS, CSRF, webhook signature, all hotels | Text signals broadened |
| H2 leftovers: `(auth)` route groups, `[hotelId]`, `webhooks`, `signin`, `admin`, `accessControl`, `supabaseAdmin`, `encryption` | `()[]@` are word boundaries; words added |
| `coordinator.md` let the implementer run the router and called the plan "authoritative" | Only the human session runs it; the plan is advisory; the final-diff pass is required |

**Re-review of those fixes (second new Opus context, on a8b15146): NO-GO** — `--diff-base`, hash pins, coordinator wording, docs honesty and option-injection safety were confirmed, but plain phrasings (`disable 2FA`, `expose service key`, `API token`, `without logging in`, `make the endpoint public`, `allow any origin`, `every hotel`, `who can approve`) and real file shapes (`crypto.py`, `lib/supabase/server.ts`, `staff_invitations.py`, `routers/hotels.py`, `[userId].tsx`, `organization.py`) still routed as ordinary, and verify-plan accepted an empty or uncommitted diff. Fixed afterward: those signals added (ordinary files such as `Button.tsx`, `HotelCard.tsx`, `tasks.py` stay ordinary); `changedFilesSince` now measures from the merge base across committed, staged, unstaged and untracked work; an empty diff fails (`STOP.EMPTY_DIFF`); CLI arguments are validated strictly. verify-plan trusts the plan file's own trigger list, so it is only as trustworthy as the plan file the human holds.

Also fixed: further forbidden phrasings (squash/approve and merge, `merge pr123`, land on main, go live, roll back production, re-run CI), the router's label for M1 instruction files (now the engine's `modify_agent_instructions_or_hooks`), the doc's scope claim, and the byte-identity test: `policy-engine.mjs` and `path-policy.mjs` are now **pinned by hash** to the approved post-M1 content, because an ordered-subsequence check cannot see an inserted line.

**Not re-reviewed after these fixes** (covered by deterministic tests only). The text signals remain heuristics; unusual wording can evade them, and Unicode full-width or 8.3 short names are not normalized (real `git diff` output never produces them).

### Known pre-existing Phase 2 gaps — NOT fixed (outside the M1 approval)

Reported by the final review; they predate M1 and affect other protected paths equally. Fixing them means editing `git-policy.mjs` / `file-command-policy.mjs`, which needs a separate human approval.

1. `git rm <path>` and `git mv <path> <dest>` skip their first path (`git-policy.mjs`, `positionals(args)` with `from=1`): `git rm CLAUDE.md`, `git rm .wolf/cerebrum.md` classify as `allowed`. `git rm -- <path>` is classified correctly. Proposed fix: `positionals(args, 0)`.
2. `cp`/`mv`/`Copy-Item` into a **directory** (`cp x/cerebrum.md .wolf/`, `cp -t .wolf x`, `cp -r src/. .wolf`) are not resolved to `dest/basename(src)` (`file-command-policy.mjs`), so they classify as `allowed` for any protected directory. Proposed fix: resolve the destination when it is a directory, uses `-t`, or ends in `/`, and apply `coversProtected` to recursive copies.

## 8. Remediation of the two Phase 2 gaps (owner GO 2026-11-22)

The two gaps listed in §7 were approved for a narrowly scoped fix limited to `git-policy.mjs`, `file-command-policy.mjs`, their fixtures/tests and this report. Nothing else changed: `.claude/settings.json`, the fail-closed hook, workflows, migrations, product code, `path-policy.mjs`, `policy-engine.mjs` and `contract.json` are byte-identical; no action class, role or capability was added or weakened (new reason codes map to existing actions).

**Fix A — `git rm` / `git mv`.** `positionals(args)` started at index 1 although `args` already excludes the subcommand, so the first target was never classified. `gitMoveRemove()` now classifies every operand (options and `--` handled), strips pathspec magic (`:(top)`, `:/`, `:(literal)`, `:(glob)`), resolves from both the cwd and the repository root, tests globs (git `*`/`?` also match `/`, so nested `CLAUDE.md`/`AGENTS.md` are reachable), treats directories that contain protected paths and attribute/exclude-only magic as the whole tree, and sends `--pathspec-from-file`, computed operands, no operands and oversized lists to approval. `git mv` destinations are classified as moves. The original per-operand pass is kept as a floor, so the handler is never weaker than before.

**Fix B — copy/move.** The destination argument alone was classified. `copyMove()` now classifies the effective destination: the argument as given plus `dest/<basename>` for every source, `-t`/`--target-directory` (getopt-style prefix resolution per tool), `-T`, `--parents`, backup suffixes, bulk contents (`src/.`, globs, pipelines, `-Include`/`-Filter`, robocopy `/S /E /MIR /PURGE`), directories that contain protected paths (`mv .wolf …`), `cp -l/-s` links, PowerShell parameter case/prefix/colon/Unicode-dash forms with comma arrays, `Rename-Item`, cmd delimiters/switches/`+`, robocopy (switch allowlist, `/IF`, `/NOSD`, `/JOB`). The original per-operand pass still runs afterwards, so copy/move can only become stricter. Unresolvable forms (computed or missing destination, splat, `POSIXLY_CORRECT`, over-long/over-numerous operands) go to approval.

**Evidence.** `fixtures-baseline-pre-copymove.json` records the classification of all 589 earlier fixtures under the pre-remediation head (19c17eb3): none became less restrictive and none changed at all. 292 new fixtures (`policy-fixtures-copymove.mjs`) record `before`/`expect`; 200 were `allowed` before and need approval now. A matrix test derives every path from `contract.json` `protected_paths` and drives it through ~30 destination/source forms. A 40,000-command differential fuzz (old vs new engine) found 0 less-restrictive results, 0 throws, 0 internal errors. The new tests fail against the old engine (194 of 287 at round 5). `openwolf-hooks.test.mjs` pins the two changed files by LF-normalized sha256 (replacing the byte-identity check for those two files only).

**Independent Opus 5.5 review (read-only), five rounds.** Every round confirmed the diff never made anything weaker and the original two bypasses closed, and every round still found new in-scope forms, which were fixed with fixtures: R1 `cp -T`, cmd `copy` of a directory, cmd delimiters, backup suffix, robocopy `/JOB`; R2 repeated glued switches, comma arrays, `/IF`, git-mv move mode; R3 `copy a+b`, switch-chain cap, robocopy `/S`, `-r`, glob backtracking; R4 option-prefix swallowing (`--strip`), PowerShell `ren`, late-segment globs, `cp -l`, robocopy operands, git floor; R5 colon-bound arrays, absolute `-NewName`, Unicode dashes, git `?` crossing `/`, latency, `POSIXLY_CORRECT`. **The review did not converge: the round-5 fixes were not independently re-reviewed.** A string-level shell classifier cannot be proven complete; treat this as defence in depth, not a guarantee.

**Not fixed (outside the approval or inherently unresolvable).**
1. `path-policy.mjs` `resolve()`: PowerShell provider paths (`FileSystem::…`), drive-relative `C:.wolf`, and bash `~+`/`~-`/`~N` are not understood — affects every writer (reviewers rated the tilde forms critical).
2. Plain `rm`/`Remove-Item` with a glob (`rm .wolf/c*`) is allowed; `New-Item -Path .wolf -Name cerebrum.md -Force` ignores `-Name`.
3. A recursive copy of a source tree cannot reveal a nested `CLAUDE.md`/`AGENTS.md` inside it; moving a directory that contains a nested tracked `CLAUDE.md` (e.g. `mv apps/web …`) is not flagged (`coversProtected` ignores `**/NAME` globs).
4. Symlinks/junctions are resolved only through the hook's injected canonicalizer (stubbed in tests); hard links via `cp -l`/`ln` are flagged, not resolved.
5. `SIMPLE_BACKUP_SUFFIX` set by an earlier command is invisible; rsync/tar/unzip/`node -e`/`python -c` are other tools.

## 9. Path-resolution remediation (owner GO 2026-11-22)

Scope: `path-policy.mjs`, `file-command-policy.mjs`, their fixtures/tests and this report, plus a minimal `cd`/`pushd`/`popd` tracking change in `command-policy.mjs` (needed for the same defect: the tracked cwd must match what the shell uses; flagged for the reviewer). **One new pure module, `writer-options.mjs`**, was added only to keep both files under the 500-line rule (mechanical option-table/parser extraction; it emits no action) — flagged for the reviewer's acknowledgement. The contract, action classes, roles, `.claude/settings.json`, hooks and workflows are untouched (their digests are asserted in `path-resolution.test.mjs`). The pinned-hash guard in `openwolf-hooks.test.mjs` gained a new layer for these files (it also pins `policy-engine.test.mjs`, whose only change adds the new module to its emitted-action scan, which proves no module emits an action outside the contract).

**Design: small central invariants instead of per-command patterns.**
1. `unresolvableForm()` — one check on every path word: `~+ ~- ~N ~user`, `~` with no known home, drive-relative `C:foo`, PowerShell provider paths (`FileSystem::`, `Registry::`, `HKLM:`, `Env:`, any multi-character `name:` followed by a separator …) and `\?\`/`\.\` device paths are never resolved lexically. Writes → `edit_outside_task_worktree`, reads → `run_unrecognized_command` (existing human_approval classes; migrations stay forbidden); `cd` to such a path makes the cwd unknown.
2. `link/..` is read BOTH ways (the link's real target for POSIX tools, as text for PowerShell/cmd/Node and the Write/Edit tools) and the stricter classification wins; The tracked cwd after a `cd` is trusted only when the `cd` certainly took effect in this shell (`cwdFlowIsCertain`: POSIX/cmd pure `&&` chains; PowerShell linear `;` flows with an existing target; single operand; the `cd` is the command itself or under `builtin`/`command`/`time`, not under another wrapper; an existing *directory* for PowerShell, given as a RELATIVE plain path (`isPlainPathText`: no absolute spelling such as a drive path, `/c/x` or `~`, and nothing the resolver would rewrite — `%XX`, trailing dot/space, `:stream`, wildcard — because PowerShell does not normalise these and the `Set-Location` fails); no pipe, subshell, block, background, `||`, `!`, `coproc`, `if`/loop/`try`); otherwise it is unknown. Link-crossing `cd`, `popd`, bare `pushd`, `pushd +N`, `cd -`, stack options (`pushd -n`, `-StackName`) and `CDPATH` also leave it unknown. Cost: `cd x; cmd` in POSIX shells, or `cd` inside a pipeline/conditional, now makes later relative writes approval-gated (use `cd x && cmd`). Canonicalization is validated: a throwing, non-string or non-absolute canonicalizer result, or a result whose nearest existing component is still a link (dangling link/loop), is a failure (`path.canonicalize_failed`), never a path. `..` after a link is computed both ways (prefix canonicalized before each `..` = real target; plain text collapse) and the stricter wins, in the classifiers, the subtree check, glob folders, copy sources and bulk destinations (`readings()`). The repository root is also canonicalized, so a root reached through a link/short name is still the repository.
3. `treeHasInstructionFiles()` — a bounded (5000 entries, depth 24), read-only, link-skipping scan of the real subtree for CLAUDE.md/AGENTS.md; a scan that errors, hits its bound or returns garbage counts as "contains one". `coversProtected()` uses it, so moving/renaming/deleting/recursively writing a directory that holds a nested instruction file is gated; copying such a tree *into* the repository (`cp -r`, `Copy-Item -Recurse`, `xcopy`, `robocopy`) is gated; a glob that matches such a directory (`mv apps/w* x`) is judged by listing the directories it can match.
4. Deletes (`rm`, `del`, `Remove-Item` …) now go through the same glob/subtree classification as copy/move. Option parsing is tool-aware (`rm -f a CLAUDE.md` used to swallow an operand because `-f` was treated as value-taking everywhere).
5. `New-Item`/`mkdir -Path P -Name N` classifies `P/N` and `N`; PowerShell comma lists and parameter abbreviations are resolved.

**Evidence.** `fixtures-baseline-pre-pathres.json` = classification of all 589 earlier fixtures at 5362f44f; `path-resolution.test.mjs` asserts none is less restrictive and each still meets its own expectation. 33 new tests run the real hook against a throwaway repo on disk with real junctions, a dangling junction, a root reached via junction, nested CLAUDE.md/AGENTS.md; each reported bypass was reproduced as `allowed` before the fix.

**Limitations (accurate, not exhaustive).** This is a Claude Code PreToolUse hook doing static classification — **not operating-system filesystem isolation**: a command that is not recognized, or computes paths at runtime, is only as safe as the classes it falls into. (a) The hook's own `canonicalize()` (not changed here) returns the lexical path when no ancestor can be resolved and swallows realpath errors; policy can only reject nonsense results and still-links. (b) Scans skip `node_modules`, `.git`, `.venv`, `__pycache__`, `.next` *inside* a larger operand (a CLAUDE.md there stays protected by `**/CLAUDE.md`, but a move/copy/delete of a parent directory does not see it), do not follow links (in a copy-source scan a link counts as unprovable), and are subject to a time-of-check/time-of-use gap. (c) Non-recursive glob deletes of `*` in a directory (`rm build/*`) are gated because `*` can match CLAUDE.md (friction, deliberate). (d) Plain readers (`cat path`) still check credentials by name, not by canonical location. (e) Windows 8.3 short names are caught lexically; cmd `%VAR%` expansion, rsync/tar/unzip/`node -e`/`python -c` are covered only by their own classes. (g) Exotic residuals the final reviewer listed (GO after 7 rounds): a `cd`/`Set-Location` alias or function, or a `CDPATH`, defined by the user's shell profile or the Claude Code shell snapshot is invisible to a per-command check; cmd `cd D:\x` without `/d` does not change the current drive; a relative PowerShell target that exists but cannot be entered (permissions, length limit); a PowerShell write to a Git-Bash-style `/c/...` path is classified as the drive path although PowerShell would target `C:\c\...` (it lands outside the worktree, never on a protected path). (h) The cwd rule is deliberately conservative: `cd x; cmd` in a POSIX shell and any `cd` in a pipeline/conditional make later relative writes approval-gated (use `cd x && cmd`). (f) Link creation (`ln`, `mklink`, `New-Item -ItemType` anything but File/Directory, `cp -l/-s`) is gated; an EXISTING hard link to a protected file is not resolved (a hard link is a second name for the same data).
