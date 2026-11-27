# Developer Harness V3 — 41 D3.7 handoff

D3.6 ends at **merge_eligible**: an exact candidate, published on a task-owned branch with one owned PR (marked ready for review), CI and staging verified on that exact head, a signed delivery-verification package, and the staging hold released. D3.6 never merges, releases or activates; it is SIMULATED and INACTIVE.

## Interfaces D3.7 builds on
| Need | Where |
|---|---|
| authorize + durable effect + authenticated reconciliation | `delivery/authorize.mjs` (`authorizeIntent`, `reauthorize`, `DurableEvidenceView`), `ledger/intents.mjs`, `delivery/observation.mjs` |
| the delivery controller and its deterministic steps | `delivery/controller.mjs` (`DeliveryController.effect`, `reconcile`, `step`) |
| exact-head checks, staging, milestones | `delivery/required-checks.mjs`, `delivery/state.mjs`, `delivery_milestones` |
| LIVE eligibility (call this immediately before any merge decision) | `DeliveryController.currentEligibility(task)` → `deliveryEligibility()` (`delivery/eligibility.mjs`); withdrawn or superseded results are invalid even though the package signature has not expired |
| the signed package to merge on | `meta delivery_package:<task>:<head>` + the `delivery_verification` evidence (single-use, 1 h; its `idempotency_id` = package digest) |

## What D3.7 must add (nothing here is closed)
1. A `merge_pull_request` path through the SAME protocol: evaluator (merger identity, `delivery_verification` consumed atomically), exact-head + strict up-to-date re-check at dispatch, authenticated reconciliation of the merge (merged, merge commit, parents), and a `merge_receipt` from an authenticated read. The schema refuses a `merged` milestone until then; `openDependencies` already waits for it.
2. Code dependencies (`requires: 'merged'`) then become satisfiable; pre-merge dependent development stays unsupported unless an upstream candidate can be brought into the dependent worktree verifiably.
3. The owner integration in doc 39 (protected CI, Linux) first; then G-REMOTE-READER, G-PUBLISHER-CREDENTIAL, G-OWNER-ACTION-EVIDENCE.
4. Carried residuals: doc 40 §5 (R-25…R-31) and every open D3.4/D3.5 residual (G-LIVE-RECOVERY-ADAPTERS incl. R-23/R-24, G-ISSUER-INDEPENDENT-FACTS, G-LEDGER-FRESHNESS-WITNESS, G-PARALLEL-REASONING).

## Contract changes from the D3.6 independent-verification remediation (D3.7 must build on these)
* **Never merge on a state name or an unexpired package.** `merge_eligible` + `delivery_verification` evidence is necessary, not sufficient: call `currentEligibility(task)` at dispatch time; it re-observes the remote and withdraws anything a newer CI / staging run of the same head superseded. A merge intent must be re-validated at dispatch against the same function.
* **Reconciliation of the merge** uses `reconcileIntent` with the ACTIVE policy (required), observations bound to repository and the EXACT subject (add the merge's subject to `effectSubject` / `confirmResponse` / `observeEffect` together: a delivery effect without a derivable subject is never reconciled), and absence only from reads AFTER the end of the request. A merge response is success only with positive confirmation (merged, the merge commit, its parents).
* Re-run / re-dispatch outcomes follow the same rules; an effect that cannot be settled is RETAINED (`unresolved_effect:*`, `effect_unresolved` status), never retried and never assumed absent.
