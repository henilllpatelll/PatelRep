# Developer Harness V3 — 27 D3.5 lifecycle security, expired approvals and the consolidated protected proposal P6

**Nothing here changes the authoritative reducer or contract.** `task-lifecycle.json`, `lifecycle/lifecycle.mjs` and every `authority/**` file are byte-identical to verified main (pinned in `d35-boundaries.test.mjs`). The proposals are owner-only root-of-trust changes.

## P6 — `proposals/P6-lifecycle-consolidated.patch` (sha256 in `manifest.json`)
One patch to the contract and the reducer, **superseding P5** (apply P6 instead of P5, never both):
1. **`technical_suspension`** recoverable state (P5's five reasons + `RECOVERY_EXHAUSTED`, `RESOURCE_WAIT_EXCEEDED`): resume only to the recorded state, no owner action, never a genuine blocker.
2. **Re-verification back-edge** `publishing → testing`, reason `APPROVALS_EXPIRED` only, from `publishing` only; it **invalidates** the test-results and review approvals it replaces. Old approvals are never extended or re-dated.
3. **Explicit cancellation**: terminal `cancelled`, owner action required, refused after merge (`merged`, `production_*`).
4. **Wait reasons**: `waiting_external PROVIDER_UNAVAILABLE` and `waiting_subscription BILLING_REVERIFICATION_REQUIRED` (both in `never_blocked_reasons`).
5. **The blocked-state escape fix (P3(g))**: a **sticky `owner_hold`** set on entering `blocked`. Moving to any other recoverable state (waiting, paused, worker/context recovery, technical suspension) keeps it and keeps the blocker reason; `worker_recovered`/`head_changed` keep it; every exit to a main-flow state then requires `owner_action_id`; only an owner action (or an owner cancellation) clears it.

Tests (`d35-lifecycle-proposal.test.mjs`) apply P6 to a **disposable copy** of the real reducer + contract and drive the patched reducer: the direct, indirect (one and two hops through seven recoverable states), paused, recovery, suspension and fenced paths out of `blocked` are all refused without an owner action; cancellation, the back-edge and the reasons behave as specified. A companion test shows the **authoritative** reducer still has the loophole (preserved on purpose until the owner applies P6); the D3.4 controller never takes it (`applyWait` never hops out of `blocked`).

**Forged or absent owner-action evidence.** A reducer can only require that `owner_action_id` is present. Authenticity needs an owner-decision evidence type and issuer in the authority contract (gate **G-OWNER-ACTION-EVIDENCE**, open). The ledger already accepts an `ownerActionVerifier`; in the proposal configuration a forged id is refused (`EVENT.OWNER_ACTION_UNVERIFIED`) before the reducer runs.

## Labelled proposal configuration
`Ledger.open(file, { proposalReducer: { label: 'PROPOSAL_UNDER_TEST', applyEvent, createTask, lc } })` — refused for any ledger that is not in-memory or under the OS temp directory; a proposal ledger is marked and can never be reopened with the authoritative reducer (or vice versa). Engine paths that are **gated on the contract declaring them** and therefore inactive today:
* `suspendTechnically` enters/leaves `technical_suspension` (the ledger `suspensions` row stays the scheduling source of truth); the engine counts leaving it as progress (a bug in the first integration, found by the test, fixed);
* `handoff`: approvals beyond the bounded re-attestation window (24 h, ≤ 6 re-issues — unchanged) schedule **new verification work** — `publishing → testing`, a NEW test run (reuse disabled for that candidate) and NEW reviews — bound to the CURRENT candidate, at most twice per candidate, then the D3.4 terminal suspension. Without P6 the D3.4 behaviour (terminal `HANDOFF_APPROVALS_TOO_OLD`) is unchanged.
* `Ledger.cancel` becomes the terminal owner-only transition.
End-to-end proof: a task whose approvals aged 25 h re-verifies (2 test runs, 2 independent reviews; every handoff approval is new, unexpired and bound to the current candidate) and hands off with zero owner interventions.

## P1v2 — `proposals/P1v2-git-facts-trusted-git-in-authority.patch`
P1 (kept byte-for-byte) + moving `orchestrator/trusted-git.mjs` to `authority/trusted-git.mjs` (pure rename) and updating its two importers, so a development scope can never edit the git hardening that authority code imports (21 §6). Verified in a throwaway worktree: 44/44. Apply P1v2 instead of P1. P2 is unchanged.

## What remains dependent on protected integration
G-LIFECYCLE-P6 (apply P6, re-pin), G-TECH-SUSPENSION-STATE, G-OWNER-ACTION-EVIDENCE, G-TRUSTED-GIT (P1v2), G-V3-CI and G-V2-PROVENANCE-FETCH (P2 — which must also list the eleven D3.5 test files already added to `run-v3-suites.mjs`; P2 itself does not pin that list).
