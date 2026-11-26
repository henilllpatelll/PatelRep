# Developer Harness V3 — 39 D3.6 consolidated protected integration (Workstream B): ONE owner action package

**Why this is an owner package and not a PR from this session.** The V2 policy hook (`docs/developer-harness-v2/14-v2-permission-transition.md`) treats `.github/**`, V3 `authority/**` and `docs/developer-harness-v3/*.json` as NEVER-authorizable for development sessions, and the brief forbids indirect circumvention (e.g. `git apply` onto a branch to push). So this session prepared, digest-pinned and tested every protected change on DISPOSABLE copies only, and did not create the protected branch. Consequently **V3 is not yet wired into protected CI and the Linux run has not happened**: D3.6 is NOT complete as a phase until the steps below are done.

## 1. Proposals (apply these, in this order, never a superseded predecessor)
| Order | Id | Digest (sha256) | Touches | Replaces |
|---|---|---|---|---|
| 1 | P1v2 | `d12edfdd6fc56bbaafa920870ae2be718a53dd2026e6090508fdd0ca2c20bac2` | authority/git-facts.mjs, issuer/facts-git.mjs, trusted-git.mjs → authority/, d34-issuer test | P1 |
| 2 | P6v2 | see `proposals/manifest.json` | task-lifecycle.json, lifecycle/lifecycle.mjs | P6 (and P5) |
| 3 | P7 | see `proposals/manifest.json` | authority-contract.json, authority/{contract,evaluator,evidence}.mjs | — (new) |
| 4 | P2 | `c42ca081049c5b3e8144634c866ad6a014e568795490183196add56eea6c52ec` | ci.yml, V2 guard + Phase-2 pins, fetch-pinned-provenance.mjs | — |
P1v2 and P2 are unchanged from D3.5 (digests re-verified against the merged files; both apply to main `41995dcb`). P6 is superseded by P6v2 and kept byte-for-byte; P7 changes NO existing action (the three D3.2 delivery actions stay byte-identical, so the D3.2 authority tests keep their meaning). The proposals touch disjoint files. No proposal activates any action.

## 2. Procedure (owner-controlled, one sitting)
1. Review and merge the D3.6 implementation PR (merging activates nothing).
2. From the new `main`: `git switch -c control-plane/dh3-d36-integration`; apply in order: `git apply -p1 docs/developer-harness-v3/proposals/<file>` for P1v2, P6v2, P7, P2; verify each digest against the manifest first.
3. With Git bash on PATH (the V2 guard executes `bash`): `node --test scripts/developer-harness-v2-ci-workflow.test.mjs scripts/developer-harness-v3/tests/git-facts.test.mjs`; `node scripts/developer-harness-v2/ci/run-ci-suites.mjs`; `node scripts/developer-harness-v3/ci/run-v3-suites.mjs` (full suite, sequential, no skips). Then update, **transparently**, the tests that assert the pre-integration state: `d34-proposals` / `d35-lifecycle-proposal` / `d36-proposals` expect P1v2/P6/P6v2/P7 *unapplied* (switch them to "already applied", which `d34-proposals` already accepts), the `d36-*` AUTHORITATIVE-configuration tests expect `ACTION.UNKNOWN` for the new P7 actions (now `ACTIVATION.NOT_ACTIVE`), and `d35-lifecycle-proposal`'s "loophole still present" test (the escape is closed by P6v2). Never weaken a boundary test: each change must make it assert the STRONGER integrated behaviour.
4. Open ONE control-plane PR (human review). Its CI run is the **first Linux execution of the V3 suite**: the CI Gate job set is unchanged, P2 adds the V3 step to the existing job. Fix any Linux portability failure in ordinary V3 code (D3.5's process-facts and host-runner tests have Windows-specific paths that are expected to fail closed elsewhere; if a test asserts Windows-only behaviour unconditionally, make it assert the documented fail-closed behaviour on other platforms — never a skip, never a weakened expectation).
5. Re-pin the dh3 closure once from the final reviewed commit (`bypass-pins.mjs --write --from-ref <40-hex>`), since P1v2 and P7 change `authority/**`.
6. Close G-V3-CI, G-V2-PROVENANCE-FETCH, G-TRUSTED-GIT, G-LIFECYCLE-P6, G-TECH-SUSPENSION-STATE and G-DELIVERY-AUTHORITY in `activation-gates.mjs` **only** with that CI evidence. Closing them activates nothing.

## 3. Owner decisions that remain (not routine engineering)
* **Publisher credentials** (G-PUBLISHER-CREDENTIAL): which GitHub App permissions V3 delivery may use, per action (`contents` + `pull-requests` for push/PR; `actions: write` only for re-run and staging dispatch), token custody, and that the unscoped App key is never used.
* **Live reader** (G-REMOTE-READER): a read-only GitHub credential and OS account for the delivery verifier.
* **Owner-action authenticity** (G-OWNER-ACTION-EVIDENCE): an authenticated owner channel issuing `owner_decision` evidence (P7 defines the type; the channel and its key custody are open).
* **Migration authorization** in task authority (R-30) if V3 tasks should ever add migrations.
* Activation itself (all gates) remains the D3.9 ceremony.
