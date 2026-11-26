# Developer Harness V3 — 19 D3.4 Trusted issuers and key custody

## 1. Architecture

One issuer process = one identity = one key (`issuer/issuer-main.mjs <config.json>`): `orchestrator` (`test_results`), `independent_reviewer`, `security_reviewer`, `delivery_verifier`
(`isolation_attestation`). The D3.2 envelope, signing domain, evidence types and verification are reused unchanged; an issuer only *creates* envelopes the D3.2 verifier already accepts.

* **No generic signing interface.** Operations are `issue_test_results{task_id,run_id}`, `issue_review{task_id,review_id}`, `issue_isolation_attestation{task_id,environment_id}` (identifiers only). Every signed fact is derived by the issuer from (a) a **read-only** ledger handle, (b) its own pinned policy (`policy_pin` supplied out of band; a mismatch refuses start), (c) an independent candidate derivation (`facts-git.mjs` with the hardened git).
* **Refusals** (all tested): unknown/cancelled task, policy mismatch, no environment, no current candidate, run/review for another candidate, future fencing epoch, not-submitted review, read-only not proven, reviewer session not verified stopped (closed with verified termination, or abandoned by a recovery whose guest cleanup was verified — `termination_unverified`/`running` are refused), wrong reviewer role, mandatory model not satisfied (wrong, substituted or unreported), context not independent or reused, candidate facts disagree, key deactivated, key not registered/valid.
* **Verdict** is computed by the issuer: any critical/high or reviewer-mandatory open finding ⇒ `findings_open`; the reviewer's own `mandatory:false` cannot lower a critical.
* **Replay**: a subject is issued at most once per recovery epoch **while its approval is live** (durable `issued` table); re-asking returns the same envelope. An approval that has **expired** is re-issued under a successor subject (`#r1`, `#r2`, …, at most 6, within 24 h of the first issue) after the issuer has re-derived every fact (preflight, independent candidate, review/run binding); this is a fresh lifetime for the same verdict about the same candidate, bounded by the controller's retry budgets; the ledger accepts each nonce once and consumes single-use evidence atomically.
* **Isolation attestation** is implemented and **refuses** on the D3.3 probe facts: it requires a passing, current suite *and* a full-size worker admitted *and* a dedicated worker account *and* the QEMU firewall rule. A probe-VM PASS alone never attests.

## 2. Key custody (`issuer/key-custody.mjs`)

* `generateIssuerKey`: Ed25519, created exclusively (`wx`, 0600) in a key directory that must not be, contain or sit inside a repository/worker root; `implementer` can never hold a key; `test-` key ids only with `test:true` and never for real keys. Returns only the **public** registry entry.
* `proposeKeyRegistration / Rotation / Revocation`: produce a proposed policy bundle and the D3.2 `diffPolicy` result (`root_of_trust`); `automated_promotion_possible` is always **false**. Rotation overlaps windows and shortens the old key's `not_after`; revocation removes the entry (earlier evidence stops verifying — the conservative choice).
* `emergencyDeactivate`: writes a marker **checked before every signature** (so a running issuer stops at once) and renames the key out of its loadable name; idempotent.
* `aclPlan`: `icacls` commands — inheritance removed, key directory granted to the issuer account and SYSTEM only, **controller explicitly denied**, IPC secret directory shared with exactly one issuer. It is data; the owner ceremony applies and verifies it. Tests prove the plan's shape, **not** that Windows enforced it.

## 3. What is and is not isolated today

Tested: process separation, read-only ledger, key directory outside repos, controller code cannot import signing/key code (static test), IPC authentication, deactivation. **Not achieved and not claimed**: OS-enforced identity (dev runs everything as the owner account), peer SID verification, hardware/OS key protection. Closing that is gate G-ISSUER-ACCOUNTS.

## 4. Procedures (owner ceremony, never automated)

1. Create per-role Windows accounts; apply `aclPlan`; verify with `icacls`.
2. Generate real keys **as the issuer account** (non-`test-` ids); record public entries.
3. Build the policy bundle with `proposeKeyRegistration`; review the diff; promote by the root-of-trust ceremony (04); pin the revision out of band.
4. Start issuers under their accounts with `policy_pin`; confirm `READY` and `status`.
5. Rotation: `proposeKeyRotation` with a cut-over time; deactivate the old key afterwards. Compromise: `emergencyDeactivate` first, then `proposeKeyRevocation`.
6. No real key was generated and no policy promoted in D3.4.
