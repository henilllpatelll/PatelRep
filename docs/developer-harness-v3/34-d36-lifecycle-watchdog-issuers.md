# Developer Harness V3 — 34 D3.6 delivery lifecycle, dependencies, watchdog, monitoring and issuers

## 1. Lifecycle
The authoritative lifecycle already has `publishing → ci_running → staging_verification → merge_eligible`, `remediation(CI_FAILED|STAGING_FAILED)` and the head-change rule; D3.6 uses them unchanged and stops at **merge_eligible** (never `merged`, never `completed`). Missing edges are in **P6v2** (supersedes P6, digest in the manifest): re-verification and `dependency_rebuild` from the delivery states, and `base_conflict_rebuild`. Without P6v2 those cases fail closed (terminal technical suspension). The sticky owner hold, owner-only cancellation, provider/billing waits and the D3.5 blocked-state fix are kept (tested from delivery states). An inactive or unknown action ⇒ ONE terminal, explained suspension (`DELIVERY_NOT_ACTIVATED`), not a retry loop.

## 2. Milestones and dependencies
`delivery_milestones`: `built`, `locally_verified`, `published`, `ci_verified`, `staging_verified`, `merge_eligible`, each bound to the exact candidate, base and evidence; a new head or base invalidates them (kept as history). The schema refuses `merged` (D3.7 supplies authenticated merge evidence).
Dependencies declare what they require: `locally_verified` (the D3.4/D3.5 boundary; an ORDERING dependency — **the dependent's worktree is built on its own base and does NOT contain the upstream code**; doc 30's "built on" means "built while the upstream was in that state") or `merged` (a CODE dependency: waits for D3.7; such tasks are serialized). **Pre-merge dependent development on an upstream candidate is NOT supported in D3.6**: there is no safe, verified way for the upstream candidate to enter the dependent worktree. A stale upstream invalidates downstream approvals and handoffs transitively, also while the downstream is in delivery.
Approvals expiring during a long CI/staging wait ⇒ the handoff is withdrawn and the engine re-attests the SAME candidate (24 h issuer bound; beyond it P6v2 re-verification or fail closed).

## 3. Watchdog (D3.5 R-20) — `delivery/watchdog.mjs`, scheduler
* Every scheduler step and every network effect runs under a deadline with a durable `operation_deadlines` row. At `stepDetachMs` (5 min) the round stops WAITING: the step is DETACHED, not abandoned — its lease, work slot and reservation stay held (the engine's `detached` set makes every orphan path skip them), its task is excluded from new rounds, unrelated tasks proceed. Only the step's own late settlement releases anything. At the per-kind ceiling (AI 21 h, heavy 2 h, deterministic 15 min) cooperative cancellation is requested: the next unit-boundary re-admission refuses, so the session stops gracefully there. **Nothing is killed**; D3.5's host-runner restriction holds; OS-enforced containment stays G-LIVE-RECOVERY-ADAPTERS (R-23, R-24 carried).
* A network call past its deadline is aborted through its signal and its intent stays UNCERTAIN (never "cancelled"); a timed-out staging operation leaves the reservation `unresolved`. A persisted circuit breaker opens on repeated timeouts.

## 4. Resource-efficient monitoring
No model polls. Every wait is a persisted `delivery_polls.next_at` with capped exponential back-off (rate-limit resets honoured); reconciliation reads have their own schedule. Retry budgets (`retry_budgets`, per-candidate meta counters, base-update history) survive restarts, fingerprint changes and candidate generations. Delivery status goes through the durable outbox (`delivery_status`; D3.8 connects it). The extra-usage freshness rule and session ceilings are unchanged.

## 5. Issuers and credentials — `orchestrator/issuer/delivery-issuer.mjs`
| Fact | Issuer | Source |
|---|---|---|
| candidate facts | trusted fact source | trusted git over a verifier clone (live: `authority/git-facts.mjs` after P1v2) |
| remote observations, CI, staging, delivery verification | `delivery_verifier` | its OWN remote read (no "sign this" operation) + read-only ledger |
| publication receipt | `trusted_publisher` | its own read of the pushed ref and PR |
| task authority, owner decisions | `task_ingress` | SIMULATED here; real = authenticated owner channels (G-OWNER-ACTION-EVIDENCE) |
The implementation worker holds no key and no credential; publisher, verifier and future merger/releaser are separate identities with separate keys; no production scope is reachable from the publisher. The signed delivery-verification package (domain `patelrep-developer-harness-v3-delivery-package\n`) binds every evidence id and digest, the candidate, base, policy, PR, CI runs and staging run; its evidence's `idempotency_id` carries the package digest. Residual G-ISSUER-INDEPENDENT-FACTS: task facts are still controller-written rows. No real key, token, grant or provider change exists; test keys only.
