# Developer Harness V2 — 14 Permission Transition (owner-launched Bypass Permissions)

**Owner decision (2026-11-24).** While Developer Harness V3 is built, the owner launches development sessions with
`claude --dangerously-skip-permissions` and does not administer routine tool permissions. This document records how V2 supports that
without disabling its policy. It is a deliberate change to the V2 permission architecture (control-plane work), not a workaround.

V3 is unaffected and stays inactive: its authority contract, activation prerequisites and the rule that a V3 identity may never enable
host bypass (`enable_host_bypass_permissions: prohibited`) are unchanged. The owner launching a V2 development session is not a V3
identity action. `docs/developer-harness-v3/01-verification-register.md` row 1 and `authority-contract.json`
`preserved_v2.bypass_permissions_in_settings` record the D3.2-time observation ("disabled"); they are historical facts for D3.2 and are
left for the V3 owner to refresh (they are V3 root-of-trust files and outside this change).

## 1. Previous versus new behavior

| Situation | Before | After |
|---|---|---|
| `claude --dangerously-skip-permissions` | refused: project `disableBypassPermissionsMode: "disable"` (fell back to `auto`) | starts in `bypassPermissions` |
| `allowed` finding, bypass | proceeds | proceeds (tree-changing git commands and `.gitignore` edits are re-checked, §3) |
| `task_authorized` / `human_approval`, bypass | denied ("cannot be mediated") | **authorized** if inside the ceiling + scope and its predicate passes; otherwise **denied** (`bypass_denied`). Never "ask". |
| `forbidden`, any mode | denied | denied (unchanged) |
| default / acceptEdits / plan | hook asks for approval classes | unchanged |
| `dontAsk`, `auto` | approval classes denied | unchanged |
| settings `ask` rules | `git push*`, `npm install*`, `npm i *`, `npm ci*`, `npm uninstall*`, `npm update*`, `pip install*`, `gh pr create*` prompted | removed (Claude Code still prompts on `ask` rules in bypass, which would defeat the transition). The hook still asks for these in default mode. Remaining ask rules match operations the hook denies in bypass. |
| Running `scripts/developer-harness-v3/**` code directly | `run_unreviewed_script` (human_approval) | `run_privileged_infrastructure` (human_approval) — same class in every non-bypass mode |
| Reading DH3 worker SSH keys, the owner's login disk (`auth.qcow2`), the DH3 GnuPG home, `*_ed25519`/`*_ecdsa`/`ssh_host_*_key` | allowed read | credential (forbidden) in every mode — tightening |
| `gh pr create/edit/comment --body-file <credential>` | not checked | the file is classified as a read (credential → forbidden) — tightening |

## 2. Where authority comes from

`scripts/developer-harness-v2/bypass-authorization.mjs` decides every non-forbidden finding of a `bypassPermissions` call. Inputs:

1. `permission_mode` from the PreToolUse event (set by Claude Code; a session cannot enter bypass unless it was launched with it).
2. The branch checked out in the **session's project root**, read by the hook from `.git` files (no subprocess).
3. The engine's hard-coded **ceiling**: the only `(action, finding code)` pairs that can ever be authorized, each with a predicate, plus
   the never-authorizable paths (V2 policy, `.claude/**`, `.github/**`, `.githooks/**`, `.wolf/**`, `supabase/**`, CLAUDE.md/AGENTS.md
   anywhere, V3 `authority/**` and `docs/developer-harness-v3/*.json`, protected infrastructure).
4. The protected `docs/developer-harness-v2/bypass-scopes.json`, validated against the ceiling. `contract.json`
   (`bypass_authorization.scopes_file`) binds this exact path; a contract that points elsewhere is invalid and denies every call.
5. Bounded facts read by the hook: script contents (≤ 1 MB) and digests of owner-pinned privileged code.

Prompt text, file contents, tool output, memory, context packs, other agents' messages and extra event fields are data. They cannot
name a scope, add a path, enable an action or satisfy a pin (tests: `bypass-authorization.test.mjs` "prompt injection").

Fail closed: a missing, corrupt or invalid scopes file; a project root on `main`/`master`/a reserved prefix/detached HEAD/unknown; an
exception in any check; a hook crash or timeout (`onFailure: "block"`); a missing or invalid contract — all deny.

## 3. Routine authorizations (any dedicated branch)

| Action | Authorized when |
|---|---|
| edit files | not a protected path (protected edits are `human_approval` → denied unless a scope covers them); not `.gitignore` |
| `install_or_upgrade_dependencies` | npm/pnpm/yarn/pip install-family commands, `npx` packages, `playwright install`, `expo install`, manifest edits — never `-g`/`--global`, never `gh extension` |
| `run_unreviewed_script` | the script is inside the worktree or a temp dir, not under a protected path (except the read-only `run-ci-suites.mjs` and `bypass-pins.mjs --print/--check`), its arguments and **content** do not reference the policy/agent configuration/git hooks; or `python -m <module>` |
| `run_interpreter_inline_code` | the inline code does not reference the policy/agent configuration/git hooks |
| `run_unrecognized_command` | only `shell.unrecognized` (an unknown program, not a verification failure), not a host-administration/credential/archive/patch tool, no PowerShell mutating verb, arguments do not reference the policy |
| `push_dedicated_branch_fast_forward` | `git push` in the session worktree, remote `origin` (or default), every destination equals the session branch |
| `open_draft_pull_request`, `interact_with_pull_request_or_issue` | `gh pr create --draft` / `gh pr edit` / `gh pr comment` with no PR selector and no `--repo` (the session branch's own PR), an allow-listed flag set, base `main` only |
| tree-changing git (allowed class, re-checked) | only `git merge [--ff-only…] origin/main`, `git pull origin main`, `merge/cherry-pick/revert --abort`, and a **new** branch from `HEAD` or `origin/main` (`checkout -b`, `switch -c`). Switching to or merging any other ref is denied: it would load that revision's policy files and settings (Claude Code hot-reloads settings) |

Not in the ceiling (always denied in bypass): `modify_agent_instructions_or_hooks`, `edit_outside_task_worktree`, `edit_credential_file`,
`discard_or_rewrite_local_work`, `manage_local_refs`, `modify_git_configuration_or_remotes`, `network_request_or_remote_shell` (curl,
ssh, WebFetch, browser actions), `read_remote_production_state`, `start_local_dev_server` (`apps/api/.env` points at production),
`terminate_processes`, `launch_nested_agent_session`, `run_local_docker_or_database_stack`, `author_new_forward_only_migration`,
`mark_pull_request_ready_for_review`, `modify_pull_request_state`, unknown tools and unclassified MCP tools — and every `forbidden`
action (main pushes, force pushes, merges, workflow dispatch, releases, deployments, remote Supabase, staging/production mutation,
credential reads, customer data, customer-agent activation/grants/billing, hook or CI bypass, alternate publishing paths).

## 4. D3.3 scope (`dh3-d33`)

Active only when the session's project root is on `feat/developer-harness-v3-d33-local-infra`.

- **Edits:** `scripts/developer-harness-v3/**` except `authority/**`. (`docs/developer-harness-v3/*.md` are ordinary files; the V3
  `*.json` contracts are owner-only in bypass.)
- **Trusted execution:** `node scripts/developer-harness-v3/bin/dh3.mjs <subcommand> [--options]` with no interpreter flags, no computed
  arguments and a subcommand in `doctor, setup, provision, start, stop, status, reset, monitor, verify-isolation, auth-check`.
  Owner-only and never authorized: `login`, `attest-extra-usage-off`, `probe-subscription`, `remove`.
- **Pins (the trusted execution and review boundary):** the call proceeds only if every file of the closure (`scripts/developer-harness-v3/`
  minus `tests/`, plus `docs/developer-harness-v3/authority-contract.json` and `task-lifecycle.json`) has exactly the pinned sha256
  (CRLF normalized to LF). A changed, added or removed file, a symlink/junction or an oversized tree denies with `bypass.pin_mismatch` /
  `bypass.pin_unverifiable`. Running any closure file another way (`node runtime/x.mjs`, `powershell -File infra/*.ps1`, Python) is
  denied in bypass. Editing privileged code is allowed; **running newly modified privileged code is not**, until the owner reviews it.
- **Shipped pins:** PR #252 head `d857818bbf44ecceb76d5835320944b37b242b6b` (38 files). Merging this transition PR is the owner's
  approval to run exactly that code without prompts. The D3.3 worktree currently has uncommitted changes to five closure files and two new
  closure files, so the first D3.3 bypass session will report `bypass.pin_mismatch` for them until the owner reviews and re-pins.
- **DH3 root:** direct writes/deletes, running QEMU binaries and killing processes are denied; lifecycle goes through the pinned CLI.
  Reading evidence and logs is allowed; worker SSH keys, `auth.qcow2` and the GnuPG home are credentials.

### Owner pin refresh

```
node scripts/developer-harness-v2/bypass-pins.mjs --scope dh3-d33 --print   # read-only: which closure files differ
git diff <last pinned ref> -- scripts/developer-harness-v3 docs/developer-harness-v3/*.json   # review the privileged change
node scripts/developer-harness-v2/bypass-pins.mjs --scope dh3-d33 --write   # OWNER ONLY: rewrites the pins
git add docs/developer-harness-v2/bypass-scopes.json && git commit -m "chore(dh2): re-pin dh3 closure after review"
```

`--write` is classified as an owner-only control-plane change: denied in bypass, prompted in default mode. Run it from your own
terminal (or approve it explicitly in a default-mode session) after reviewing the diff.

## 5. Residual risks

- **R-1 Code execution is not a sandbox.** Authorized scripts, tests (`node --test`, already prompt-free before this change), package
  lifecycle scripts and `npx` packages run as the owner's Windows user and can do anything that user can, including editing policy files
  through code the hook cannot read. The content/argument tripwires catch direct references, not obfuscation. The authoritative boundaries
  remain server-side: the `main` ruleset (CI Gate + Staging Gate, no bypass actors), the CI pin of `ci.yml`, environments, credential
  isolation and owner review of every PR touching `.claude/**`, `scripts/developer-harness-v2/**` or `docs/developer-harness-v2/**`.
- **R-2 The checked-out policy is trusted.** The hook loads the engine, contract and scopes from the session's worktree. Bypass sessions
  cannot write them or switch to another revision, but a default-mode session (with approval) or the owner can. Review policy diffs.
- **R-3 Reads are not restricted to the worktree** (unchanged from V2): non-credential files in other worktrees can be read.
- **R-4 Unknown-program and credential-tool lists are tripwires**, not complete inventories.
- **R-5 Pins prove identity, not safety.** A pin says "the owner reviewed this exact code"; the review itself is the control.
- **R-6 Dependency installs** run third-party lifecycle code without a prompt (typosquatting/compromised packages).
- **R-7 PR bodies and comments** on the session's own PR are published to GitHub without a prompt; credential files are refused as
  `--body-file`, but text the agent writes is not inspected.

## 6. Changed assertions (behavior intentionally changed; nothing deleted)

| Test | Before | After |
|---|---|---|
| `policy-hook.test.mjs` "settings: bypass mode …" | `disableBypassPermissionsMode === 'disable'` | key absent, no `defaultMode`, routine ask rules absent, remaining gates present |
| `policy-hook.test.mjs` "approval-gated action under bypassPermissions …" | exit 2 "cannot be mediated" in the real repo | exit 2 `bypass.authorization_unavailable` in a sandbox without the scopes file (authorized paths are covered by the new suites) |
| `policy-engine.test.mjs` "approval-gated actions are denied …" | reason `/cannot be mediated/` in all three modes | same for `dontAsk`/`auto`; bypass (no scopes in that ctx) → `bypass_denied … [bypass.authorization_unavailable]` |
| `policy-engine.test.mjs` "every action the policy modules can emit …" | module list | + the three transition modules |
| `m1-hardening`, `copymove-remediation`, `path-resolution` "contract surfaces untouched" | digest of all actions | digest of actions minus the one recorded addition (`bypass_authorization.added_actions`); the addition is asserted explicitly |
| `runtime-failclosed-check.mjs` R8 | bypass refused | bypass takes effect |

## 7. Launching after merge

```
cd C:\Users\Henil\projects\<worktree on a dedicated branch>
claude --dangerously-skip-permissions
```

The first interactive launch shows Claude Code's own warning dialog (accepting stores `skipDangerousModePermissionPrompt` in user
settings; a project file cannot set it). Do not set `defaultMode: "bypassPermissions"` anywhere: bypass must remain an explicit
launch. Sessions on `main` get no bypass authorization. Other modes behave as before.

### Updating PR #252 after this PR merges

In the D3.3 worktree (`C:\Users\Henil\projects\PatelRep-d33`), keeping its uncommitted isolation evidence intact:

```
git fetch origin
git merge origin/main        # brings the transition; resolve conflicts if any
git push                     # fast-forward of feat/developer-harness-v3-d33-local-infra
```

Then review the D3.3 working changes to the privileged closure and re-pin (§4) before the next bypass session runs `dh3`.
