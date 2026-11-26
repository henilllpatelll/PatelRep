# Developer Harness V3 — 21 Protected-change proposals, owner integration procedure and the activation-gate register

D3.4 modified **no** protected path (no `.github/**`, V2 file, `.claude/**`, V3 authority code, contract JSON, pin or hook). It prepared exact, digest-pinned proposals in
[`proposals/`](proposals/manifest.json) and verified each in a **throwaway worktree** (deleted afterwards). `d34-proposals.test.mjs` pins the digests and checks each patch applies cleanly (or is already applied).

## 1. Proposals

| ID | File | Digest (sha256) | Mandatory for D3.4 completion? | Activation prerequisite |
|---|---|---|---|---|
| P1 | `proposals/P1-git-facts-trusted-git.patch` — `authority/git-facts.mjs` stops spawning a bare `git` | `194760b4…d7600` | **No** (D3.4's issuer already uses the hardened runner) | G-TRUSTED-GIT |
| P2 | `proposals/P2-consolidated-ci-integration.patch` — ONE control-plane change: trusted prep step for the provenance fetch, the V3 suite step, the V2 guard re-pinned (6-step job) and the Phase-2 identity test's pin for the edited ypass-hook.test.mjs | `eca70654…b1e7` | **No** | G-V3-CI, G-V2-PROVENANCE-FETCH |
| P3 | lifecycle contract additions (design only, §3) | — | No | recommended before D3.5 |
| P4 | a `dh3-d34`/`dh3-d35` scope in `bypass-scopes.json` (§4) | — | No | owner choice |

Verification performed (not an independent audit): P1 — applied in a scratch worktree, `git-facts` + `security` + `d34-issuer` tests 41/41, `git apply --check` clean on the branch. P2 — the pin method first reproduced the baseline pins exactly (`18ce2d13…`), then the re-pinned guard `developer-harness-v2-ci-workflow.test.mjs` passed 6/6 with Git bash on `PATH` (the guard executes `bash`; without it even the **baseline** reports `GATE_REJECTS_ALL_GREEN` on this Windows host), `git apply --check` clean. **Not verified:** the whole V3 suite on Linux CI (it was run on Windows only; `d33-*` host-specific behaviour on `ubuntu-latest` is unknown), and a GitHub run of the patched workflow.

P2 detail: step 4 `Fetch pinned provenance commits` (`fetch-pinned-provenance.mjs`, the only network access of that job; reuses `verifyPinProvenance(..., {fetchIfShallow:true})`, so the same sha-only, option-injection-safe fetch moves out of the test); `bypass-hook.test.mjs` then verifies provenance **without** fetching; step 6 `Run Developer Harness V3 regression suites` (`run-v3-suites.mjs`: one process per file, sequential, 1 GB heap, rebuilt environment, no skips, pinned file list). The guard keeps every rule; only the step count (4→6), the harness index, two new exact-step checks and the two pins change.

## 2. Consolidated owner integration procedure (one sitting, no incremental re-pinning)

1. Review and merge the D3.4 PR (merging activates nothing).
2. New branch from `main`: `git apply -p1 docs/developer-harness-v3/proposals/P1-…patch` and `…/P2-…patch`; confirm the digests against `manifest.json`.
3. With Git bash on `PATH`: `node --test scripts/developer-harness-v2-ci-workflow.test.mjs scripts/developer-harness-v3/tests/git-facts.test.mjs`; `node scripts/developer-harness-v2/ci/run-ci-suites.mjs`; `node scripts/developer-harness-v3/ci/run-v3-suites.mjs`.
4. Open ONE control-plane PR (human review, not merged by automation). Watch the first CI run on Linux; fix any `d33-*` platform assumption there, not by loosening a rule.
5. Re-pin the dh3 scope closure once from the final reviewed commit (`bypass-pins.mjs --write --from-ref <40-hex>`), because P1 changes `authority/**`.
6. Mark G-TRUSTED-GIT, G-V3-CI, G-V2-PROVENANCE-FETCH closed in `activation-gates.mjs` **only** with that evidence.

## 3. P3 — lifecycle contract proposals (design only; not applied, not run against the reducer pins)
(a) a terminal `cancelled` state (D3.4 uses a ledger flag + `paused`); (b) `waiting_external` reason `PROVIDER_UNAVAILABLE` (today mapped to `NETWORK_UNAVAILABLE`); (c) a back-edge `publishing → testing` for **expired approvals** (D3.4 re-attests, but if the controller is down longer than evidence TTL — 4 h reviews / 6 h tests — handoff fails closed with `needs_reverification`); (d) a defined `paused` duration policy. Changing `task-lifecycle.json` is root-of-trust.

## 4. P4 — development scope
The brief refers to "the dedicated D3.4 development scope supplied by the owner". `docs/developer-harness-v2/bypass-scopes.json` at the baseline contains only `dh3-d33` (bound to the D3.3 worktree/branch). No D3.4 scope was present in this checkout, so the work ran under the session's ordinary permissions; no scope, pin or hook was edited or bypassed. The owner can add `dh3-d34` (worktree `PatelRep-d34`, branch `feat/developer-harness-v3-d34-orchestration`, writable `scripts/developer-harness-v3/**` excluding `authority/**`) and pin the orchestrator closure at the reviewed commit.

## 5. Activation-gate register (live execution requires every gate `closed`; D3.4 closes none)

Rendered from `orchestrator/activation-gates.mjs` (tested for completeness against the brief):

| Gate | Requirement | Status | D3.4 contribution | Remaining step |
|---|---|---|---|---|
| G-WORKER-ACCOUNT | Dedicated low-privilege worker account (O-7) | open | none | create `dh3-worker`, scheduled-task launch |
| G-FULL-WORKER | Full 3 GB worker admitted and validated | open | governor reused | provision + verify at full size |
| G-CRED-ISOLATION | Credential isolation proven under the real account | open | snapshot credential scanning | owner login (O-2), re-run residue scenarios |
| G-EGRESS-FIREWALL | QEMU outbound firewall rule (O-6) | open | none | add the rule |
| G-PROVIDER-AUTH | Provider authorization of the exact architecture | open | doc 20 (not a grant) | independent decision |
| G-OWNER-AUTH | Owner native login in the worker | open | none | `dh3 login` |
| G-EXTRA-USAGE | Extra usage verified off | open | re-checked per AI stage | attest + probe |
| G-ISSUER-KEYS | Issuer keys + policy bootstrap | prepared | key-custody, proposals | root-of-trust ceremony |
| G-ISSUER-ACCOUNTS | Per-role OS accounts and ACLs | prepared | processes, IPC, ACL plan | create accounts, apply plan |
| G-ATTESTATION | Current signed isolation attestation | prepared | issuer path (refuses on probe facts) | after the above gates |
| G-V3-CI | V3 suite in protected CI | prepared | P2 | control-plane PR |
| G-NEIGHBOR-TEST | Isolation tested with WSL/Docker active | open | none | run with neighbours |
| G-RESIDUALS | Egress/credential residuals (V3-T16 etc.) | open | documented | accept or close |
| G-D33-FOLLOWUPS | D3.3 follow-ups without re-review | open | untouched | review |
| G-V2-PROVENANCE-FETCH | V2 provenance test network-free | prepared | P2 | control-plane PR |
| G-TRUSTED-GIT | `git-facts.mjs` hardened git | prepared | P1 + trusted-git.mjs | owner-only change + re-pin |
| G-CLI-EFFORT | `--effort`/`--model` verified on the pinned guest binary | open | host 2.1.332 help + parser | run `parseCliHelp` in the guest |
| G-LIVE-ADAPTER | A reviewed live session adapter exists | open | simulated only | D3.9 |
| G-BYPASS-ACTIVATION | Bypass only inside proven isolation | open | never requested | D3.9 ceremony |

## 6. Amendments from the independent security review (2026-11-25)
* **P1 must also move orchestrator/trusted-git.mjs into uthority/** (and the import path in the patch with it): otherwise P4's development scope (everything under scripts/developer-harness-v3/** except uthority/**) would let development sessions edit the git hardening that authority code imports (review F12). Not done here because uthority/** is owner-only.
* **P2 originally broke openwolf-hooks.test.mjs** (it pins ypass-hook.test.mjs by sha256); found by running the V2 runner, fixed in the shipped patch. Two V2 policy tests fail only inside the scratch worktree and pass on the real branch; one cannot rule out an environmental cause without an unpatched scratch run.
* New gate **G-ISSUER-INDEPENDENT-FACTS**: review issuers read read-only proof, model identity, termination and independence from controller-written ledger rows (review F4). A compromised controller could have a review row signed; fixing needs a source the controller cannot write.

