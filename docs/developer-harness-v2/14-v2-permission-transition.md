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
   the never-authorizable paths (V2 policy, `.claude/**`, `.github/**`, `.githooks/**`, protected `.wolf` files, `supabase/**`,
   CLAUDE.md/AGENTS.md anywhere, V3 `authority/**` and `docs/developer-harness-v3/*.json`, protected infrastructure). Unprotected
   bookkeeping such as `.wolf/memory.md` stays an ordinary file.
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
| `install_or_upgrade_dependencies` | npm/pnpm/yarn/pip install-family commands, `npx` packages, `playwright install`, `expo install`, manifest edits — never global or outside the worktree (`-g`, `--location`, `--prefix`/`-C`, `--dir`/`--cwd`, `pip --user/--target/--prefix/--root`), never `gh extension` |
| `run_unreviewed_script` | the script is inside the worktree or a temp dir, not under a protected path (except the read-only `run-ci-suites.mjs` and `bypass-pins.mjs --print/--check`), its arguments and **content** do not reference the policy/agent configuration/git hooks and carry none of the credential or protected-effect signatures inline code is checked for; or `python -m` with an allow-listed module |
| `run_interpreter_inline_code` | `node`/`python` only (`-e`/`-c`), and the code does not reference the policy/agent configuration/git hooks (its credential/protected-effect signatures are forbidden in every mode) |
| `run_unrecognized_command` | `shell.unrecognized` (an unknown program, not a verification failure) that is not a host-administration, credential, network-probe (`nslookup`, `ping`, …), archive/patch tool or unparsed interpreter (`perl`, `cscript`, …), has no PowerShell mutating verb and no argument referencing the policy; or `expo export`/`expo prebuild` |
| `push_dedicated_branch_fast_forward` | `git push` in the session worktree, remote `origin` (or default), every destination equals the session branch |
| `open_draft_pull_request`, `interact_with_pull_request_or_issue` | `gh pr create --draft` / `gh pr edit` / `gh pr comment` with no PR selector, no `--repo` and no `GH_*` environment override (the session branch's own PR), an allow-listed flag set, base `main` only; title, body and body-file text must not contain credential-like values (tokens, keys, private keys, connection strings, `SECRET=`-style lines) |
| tree-changing git (allowed class, re-checked) | only `git merge [--ff-only…] origin/main`, `git pull origin main`, `merge/cherry-pick/revert --abort`, and a **new** branch from `HEAD` or `origin/main` (`checkout -b`, `switch -c`) whose name is not a scope branch. `git symbolic-ref HEAD <ref>` is a ref write (`manage_local_refs`) in every mode. Switching to or merging any other ref is denied: it would load that revision's policy files and settings (Claude Code hot-reloads settings) |

Not in the ceiling (always denied in bypass): `modify_agent_instructions_or_hooks`, `edit_outside_task_worktree`, `edit_credential_file`,
`discard_or_rewrite_local_work`, `manage_local_refs`, `modify_git_configuration_or_remotes`, `network_request_or_remote_shell` (curl,
ssh, WebFetch, browser actions), `read_remote_production_state`, `start_local_dev_server` (`apps/api/.env` points at production),
`terminate_processes`, `launch_nested_agent_session`, `run_local_docker_or_database_stack`, `author_new_forward_only_migration`,
`mark_pull_request_ready_for_review`, `modify_pull_request_state`, unknown tools and unclassified MCP tools — and every `forbidden`
action (main pushes, force pushes, merges, workflow dispatch, releases, deployments, remote Supabase, staging/production mutation,
credential reads, customer data, customer-agent activation/grants/billing, hook or CI bypass, alternate publishing paths).

## 4. D3.3 scope (`dh3-d33`)

Active only when the session's project root **is** `C:/Users/Henil/projects/PatelRep-d33` (canonical path) **and** is on
`feat/developer-harness-v3-d33-local-infra`. Binding the scope to one checkout as well as one branch means retargeting HEAD in another
worktree cannot activate it, and no bypass session may create a branch with a scope branch's name.

- **Edits:** `scripts/developer-harness-v3/**` except `authority/**`. (`docs/developer-harness-v3/*.md` are ordinary files; the V3
  `*.json` contracts are owner-only in bypass.)
- **Trusted execution:** `node scripts/developer-harness-v3/bin/dh3.mjs <subcommand> [--options]` as a **foreground** Bash/PowerShell
  command run from the worktree, with no interpreter flags, no computed arguments, a subcommand in `doctor, setup, provision, start,
  stop, status, reset, monitor, verify-isolation, auth-check` and only the options `--dry-run --ram --wait-minutes --samples --interval
  --id`. `--root` is refused: it would point the pinned code at an agent-writable runtime (QEMU, MSYS2, VM config).
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

- **R-1 Code execution is not a sandbox.** Authorized scripts, tests, package lifecycle scripts and `npx` packages run as the owner's
  Windows user and can do anything that user can, including editing policy files or copying a credential into a tracked file through
  code the hook cannot read. The script scan (entry file plus relative imports: policy references and credential signatures) is an
  **accident tripwire**, not a boundary: absolute/`file://`/package-alias imports, `fork`/`spawn`/`Worker` of another file, `eval` of
  read data, Python imports, obfuscation and `node --test <file>` (allowed in every mode since Phase 2, never inspected) are not covered.
- **R-1b Commit content.** GitHub secret-scanning push protection is **disabled** on the repository (checked live 2026-11-24:
  `security_and_analysis.secret_scanning_push_protection = disabled`). So before a bypass `git commit` is authorized the hook scans
  exactly what the commit adds: the paths `git diff --cached` reports against HEAD, read by their staged sha with `git cat-file
  --batch` (UTF-8, UTF-16 and a NUL-stripped view), plus the message. These two fixed, read-only git calls (shell:false, sanitized env,
  fsmonitor/hooks disabled, 6 s timeout) are the only subprocess the hook ever runs, and only for a bypass commit. Staging at commit
  time (`-a`, `--only`, pathspecs) is refused; a computed message is accepted only in the literal quoted-heredoc form; `merge`/
  `cherry-pick`/`revert --continue` are refused (finish with `git commit`); unreadable or oversized staged content denies. Compressed or
  encrypted files, re-encoded secrets and commits made outside bypass are not covered. **Owner action recommended:** enable secret scanning and push protection
  (Settings → Code security) as the authoritative server-side control; agents cannot change repository security settings. The authoritative boundaries
  remain server-side: the `main` ruleset (CI Gate + Staging Gate, no bypass actors), the CI pin of `ci.yml`, environments, credential
  isolation and owner review of every PR touching `.claude/**`, `scripts/developer-harness-v2/**` or `docs/developer-harness-v2/**`.
- **R-2 The checked-out policy is trusted.** The hook loads the engine, contract and scopes from the session's worktree. Bypass sessions
  cannot write them or switch to another revision, but a default-mode session (with approval) or the owner can. Review policy diffs.
- **R-3 Reads are not restricted to the worktree** (unchanged from V2): non-credential files in other worktrees can be read.
- **R-4 Unknown-program and credential-tool lists are tripwires**, not complete inventories.
- **R-5 Pins prove identity, not safety.** A pin says "the owner reviewed this exact code"; the review itself is the control.
- **R-6 Dependency installs** run third-party lifecycle code without a prompt (typosquatting/compromised packages).
- **R-7 PR bodies and comments** on the session's own PR are published to GitHub without a prompt. Credential files and text with
  credential-like values are refused; a secret that has been re-encoded is not detected.
- **R-8 Pinned code runs what it loads at run time.** dh3 imports some modules lazily and launches PowerShell scripts from the closure.
  The pinned call must be the whole command line in canonical form (no `&`, `nohup`, `setsid`, `start`, `Start-Process`, subshell,
  `cd`, environment assignment or second statement), in the foreground, from the worktree root; background and Monitor runs are refused.
  A concurrently running subagent (or a parallel tool call) could still edit a closure file mid-run; the robust fix (running dh3 from
  a verified snapshot) is V3 design work and out of scope. Do not run D3.3 privileged commands while subagents edit `infra/`/`runtime/`.
- **R-9 Outside the pins:** the DH3 root contents (QEMU, images, VM config), System32/OpenSSH binaries and `node.exe` are not pinned.
  Tool calls cannot write the DH3 root, but code execution (R-1) can.

## 6. Independent review (Opus, high effort) and remediation

The first review of `7446ec9e` returned NO-GO. Every finding was reproduced, fixed and pinned by a test
(`bypass-authorization.test.mjs` "independent review reproductions"):

| # | Finding | Fix |
|---|---|---|
| 1 (blocking) | `git symbolic-ref HEAD refs/heads/<scope branch>` classified as a read (pre-existing off-by-one), so any worktree could take the D3.3 scope and push to PR #252's branch | `positionals(args, 0)` → ref write in every mode; scopes bound to a worktree path; no new branch may take a scope branch name |
| 2 (blocking) | script copies `apps/api/.env` to a file, then `gh pr comment --body-file` publishes it | scripts get the inline-code credential/protected-effect signatures; PR text and body files are checked for credential-like values |
| 3 | `GH_REPO=` / `GH_HOST=` retarget `gh pr` | any environment override on a `gh pr` line is denied in bypass |
| 4 | `python -m <anything>` (e.g. `zipfile -e`) | module allow-list + argument tripwire |
| 5 | `npm --prefix`, `pip --user` write outside the worktree | outside-the-worktree install flags treated as global |
| 6 | a background pinned run could load files edited later | privileged entrypoints only in the foreground (not background, not Monitor), from the worktree; residual R-8 |
| 7 | `nslookup`/`ping`, `perl -e` | network probes and unparsed interpreters denied; inline code only for node/python |
| 8 | `--root` points pinned dh3 at an agent-writable runtime | per-execution option allow-list without `--root` |
| 10 | doc listed `.wolf/**` as never-authorizable | corrected (§2) |
| 11 | `expo export`/`prebuild` denied | authorized as routine |

Re-verification of `f5919897` (same reviewer) closed F1 and F11 and found variants of F2–F8; all fixed at the next head and pinned
(`bypass-authorization.test.mjs` "independent review round 2"):

| Finding | Variant | Fix |
|---|---|---|
| F2 | forbidden effect moved into an imported helper; `--body-file -` from stdin/pipe | relative imports followed (bounded), computed imports refused; stdin bodies refused. `node --test` and push content recorded as R-1 (a)/(b) |
| F3 | `read GH_REPO <<< …; export GH_REPO; gh pr …` | any `GH_*`/`GITHUB_*` name or `env` wrapper on a `gh pr` line is an override |
| F4 | `python -m coverage run x.py`, `doctest` | module list reduced to modules that do not execute files |
| F5 | `PIP_USER=1`, `PIP_TARGET=`, `--break-system-packages` | pip/npm/pnpm/yarn environment variables and system-site installs treated as outside the worktree |
| F6/F8 | `&`, `nohup`, `(…&)`, `setsid`, `cmd /c start`, `Start-Process`, `LOCALAPPDATA=`, `cd … &&` | canonical whole-line form from the worktree root; launchers (`setsid`, `start`, `nice`, …) denied as unknown programs |
| F7 | `msbuild`, `go run`, `dotnet run` | compile-and-run toolchains denied |
| new | placeholder `CRON_SECRET=<redacted-value>` in prose flagged | placeholders excluded from the secret-value check |

Round 3 (`af89cd56`) closed F2-stdin, F3, F4 and F5 and found:

| Finding | Fix |
|---|---|
| (blocking) the pinned single-command check accepted a second line (`\s` matched newlines) | the command must be one physical line, `[ \t]` separators, arguments without `=`, `:` or `/` |
| (blocking) `npm run build` denied: `process.env)` matched the credential-file signature | `process.env`, `import.meta.env`, `os.environ` are not file references |
| PR override check matched `GITHUB_TOKEN` mentioned inside a body; lowercase `token = …` code flagged as a secret | override = assignment/`export`/`read`/`source`/`env` target only; `KEY=value` secret branch is uppercase-only |
| `corepack enable`, `volta install` change the global toolchain | denied |
| push content uninspected while push protection is off | staged-content and commit-message scan before a bypass commit (R-1b) |

Round 4 (`2f710984`) closed the single-line form, `process.env`, the narrowed false positives and the toolchain managers, and found:

| Finding | Fix |
|---|---|
| (blocking) every commit denied: "loose object" ≠ newly staged (45k loose objects here); committed fixtures blocked later commits | scan `git diff --cached` paths only (vs HEAD), whether loose or packed |
| (blocking) `-m "$(cat notes.txt)"`, backticks, `$(<file)`, PowerShell `$(Get-Content …)` messages unchecked | computed message only as the literal quoted heredoc; anything else denied |
| `merge/cherry-pick/revert --continue` commit without the check | denied in bypass (abort/quit only) |
| packed blobs skipped after auto-gc | resolved by the diff-based scan |
| UTF-16 text treated as binary | UTF-16LE/BE and NUL-stripped views scanned |
| placeholder prefix (`Example…`) accepted | placeholder must be the whole token |

Round 5 (`2a57865c`) closed 5a, 5c, 5d, 5e and found that staging in the same command as the commit (`git add x && git commit`) runs
after the scan, and that a heredoc could smuggle a command after its delimiter or a `$VAR` could carry file content into the message.
Fix: in bypass a `git commit` must be the **only** command on its line; outside quotes no separator, redirect, subshell or expansion,
inside double quotes no `$`, backtick or backslash; the only computed message is a quoted heredoc that ends at its first delimiter line
and closes immediately. Fixture P-11 (`git add … && git commit …`, allowed in other modes) is therefore denied in bypass by design.

Known friction that remains in bypass (deliberate): `apps/web/scripts/apply-feature-flag.mjs` and `verify-feature-rollout.mjs`
(rollout tooling that mentions workflows), `apps/mobile/scripts/staging-env.js` (targets the remote staging Supabase), test files run
directly with `node <file>.test.mjs` instead of `node --test`, dev servers, WebFetch/curl, Docker, `git stash`, switching branches.

## 7. Changed assertions (behavior intentionally changed; nothing deleted)

| Test | Before | After |
|---|---|---|
| `policy-hook.test.mjs` "settings: bypass mode …" | `disableBypassPermissionsMode === 'disable'` | key absent, no `defaultMode`, routine ask rules absent, remaining gates present |
| `policy-hook.test.mjs` "approval-gated action under bypassPermissions …" | exit 2 "cannot be mediated" in the real repo | exit 2 `bypass.authorization_unavailable` in a sandbox without the scopes file (authorized paths are covered by the new suites) |
| `policy-engine.test.mjs` "approval-gated actions are denied …" | reason `/cannot be mediated/` in all three modes | same for `dontAsk`/`auto`; bypass (no scopes in that ctx) → `bypass_denied … [bypass.authorization_unavailable]` |
| `policy-engine.test.mjs` "every action the policy modules can emit …" | module list | + the three transition modules |
| `m1-hardening`, `copymove-remediation`, `path-resolution` "contract surfaces untouched" | digest of all actions | digest of actions minus the one recorded addition (`bypass_authorization.added_actions`); the addition is asserted explicitly |
| `runtime-failclosed-check.mjs` R8 | bypass refused | bypass takes effect |

## 8. Launching after merge

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
