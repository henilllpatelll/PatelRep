# H4 customer billing, reconciliation and controlled overage

Decisions and audit findings are in [ADR-0003](adr-0003-h4-customer-billing.md). Code lives in:
- `apps/api/services/agent_billing/`: customer, operator and job code, the Stripe transport and webhooks.
- `apps/api/services/agent_orchestrator/customer_billing_ledger.py`: the paid-call ledger port.
- `supabase/migrations/248_*.sql` and `249_*.sql`.

## 1. Four financial concepts that stay separate

| Concept | Unit | Where | Who sees it |
|---|---|---|---|
| Provider expense | USD | `agent_model_attempts`, `agent_model_spend_events` (H3) | PatelRep only |
| Customer credits | credits (4 dp) | `credit_ledger.credits_used` (total), `agent_customer_credit_charges` (agent journal) | GM: usage breakdown |
| Customer overage | credits + exact USD | overage share of agent charges; `credit_ledger.agent_overage_*` | GM: overage card |
| Stripe outcomes | integer cents, Stripe ids | `agent_billing_operations` (+ events) | GM: billing history |

The platform's USD provider budget (H3 policies) and the hotel's spending caps (§5) are different things and are never
compared with each other.

## 2. Data flow of one customer-billed agent call (`customer_billing_mode = 'enforced'`)

```
worker                      agent_billing_attempt_reserve (ONE transaction)
                              ├─ H3 agent_model_attempt_reserve   (run → attempt → provider counters)
                              └─ customer hold                    (credit_ledger row lock)
                                   policy active? subscription billable? ledger open & matches policy?
                                   quote = ceil(exposure × markup / usd_per_credit), ≥ minimum
                                   included part / overage part → consent, limit, hard cap, whole-bill cap
                                   denied → H3 reservation released in the same transaction
                            agent_billing_attempt_dispatch (ONE transaction)
                              re-check hold, policy unchanged, consent still valid and within limit
                              refused → hold + provider reservation released together
                              → H3 dispatch marker (its own checks); trigger refuses a dispatch without a hold
network call (no transaction open)
                            agent_billing_attempt_settle (ONE transaction)
                              H3 settle → settled:   one charge (≤ hold), ledger breakdown updated, hold converted
                                          released:  hold released
                                          uncertain / unreconciled: hold → awaiting_reconciliation (no charge)
```

While `customer_billing_mode = 'disabled'` (the default), each wrapper is a pass-through to the H3 RPC: identical
behavior, no hold, no charge.

**Lock order:** run → attempt → provider counters → hold → `credit_ledger`. The legacy `deduct_ai_credits` locks only
`credit_ledger`. The reconciler takes attempt locks with `SKIP LOCKED`.

**Partial failures.** Each step is one committed transaction, so a crash leaves one of these states:

| Crash point | State left | Recovery |
|---|---|---|
| before reserve commits | nothing | none needed |
| after reserve, before dispatch | attempt `reserved` + hold `held` | H3 `spend-recover` releases the attempt; the reconciler then releases the hold |
| after dispatch, before settle | attempt `dispatched` + hold `held` | H3 recovery marks it `uncertain`; the hold waits for evidence |
| H3 settled but the H4 step never ran (direct H3 call or an operator H3 reconcile) | attempt `settled` + hold `held` | the reconciler creates the single charge |

## 3. Pricing-policy versioning

- `agent_customer_pricing_policies`: `included_credits`, `usd_per_credit`, `markup_multiplier`,
  `minimum_credits_per_operation`, `hard_cap_usd` and `terms_version`, all per hotel, with a version number.
- Proposed by operator A, approved by operator B (`approved_by <> created_by`, enforced by a CHECK constraint).
  Approval closes the previous policy (`effective_to`) and starts the new one at the moment of approval. A trigger
  refuses any other change, and policies are never deleted.
- Fails closed when the policy is missing, unapproved, expired or retired, when it contradicts the ledger allowance
  (`pricing_policy_ledger_mismatch`), or when the subscription is not active/trialing.
- Every charge snapshots the policy id, version, rates and the provider schedule version. A later policy never
  reprices an earlier charge.
- Compatibility: `usd_per_credit` must be 0.02, the existing credit price that `credit_ledger` and the legacy cap use.
- No hotel receives a policy from this PR. Policies are created only by operators (§10).

## 4. Consent and overage semantics

- **Off by default.** No row means off. Plans, upgrades, settings visits, enabling AI and spend caps do not change it.
- **Only the GM can change it,** through `POST /billing/overage/authorize` or `/revoke`. Hotel and user come from the
  verified token. The database re-checks that the user is an active GM of that hotel, and the request body carries no
  identity (extra fields are rejected).
- **Affirmative acceptance:** whole-number credit limit, the current policy id and terms version, and the exact maximum
  charge from `GET /billing/overage/quote`, which the database recomputes. Any mismatch is refused.
- **Effect rules:**
  - A new authorization applies to new holds immediately.
  - Revocation applies immediately: every undispatched overage hold is refused at dispatch.
  - Calls already dispatched are legitimately accrued and stay billable.
  - A new pricing policy pauses overage (`needs_reconfirmation`) until the GM confirms again.
  - Lowering the limit below what has already accrued stops further overage and never voids accrued charges.
- **Consent history:** append-only versions, protected by a trigger against every writer. Each change also writes a
  `agent_customer_billing_events` audit row with the GM's user id.

## 5. Caps (scope: one hotel, one billing period = the `credit_ledger` row's period)

| Cap | Set by | Checked |
|---|---|---|
| Authorized overage credits | GM | at hold time and again at dispatch (row lock) |
| Policy hard agent-overage cap (USD) | operators (always set) | at hold time; the authorization itself cannot exceed it |
| Subscription `cap_cents` (whole monthly bill) | existing plan setting | at hold time when set |

The included portion of a hold needs no consent. Anything beyond the allowance needs consent and all three caps.

## 6. Financial idempotency

| Risk | Guard |
|---|---|
| Same attempt charged twice | partial unique index `agent_customer_credit_charges_one_per_attempt`; hold state machine; attempt row lock |
| Two holds for one attempt | `UNIQUE (attempt_id)` on holds |
| Charge edited later | immutability trigger; corrections are negative `adjustment` rows (two-person, bounded by the original) |
| A period billed twice | each charge gets `billing_operation_id` exactly once; preparing a period only takes unassigned charges |
| Stripe retry after key pruning | search by `patelrep_billing_operation_id` metadata before every create; ambiguous → reconcile first |
| Duplicate / out-of-order webhooks | handler is idempotent; `event.created` ordering; `paid` / `void` are final |
| Wrong customer / live object | DB refuses: customer must equal the snapshotted `stripe_customer_id`; `livemode` must be false |

## 7. Reconciliation (`agent_customer_billing_reconcile`, CLI `reconcile`)

- Bounded to `--limit` (max 500) and idempotent. Dry run by default. Output is metadata only.
- **Writes:** turns holds whose attempt is now `settled` into charges; releases holds whose attempt is `released`;
  moves holds whose attempt is `uncertain` / `unreconciled` to `awaiting_reconciliation`.
- **Reports, never fixes:**
  - credits awaiting provider reconciliation;
  - stale open attempts;
  - holds created under a policy that is no longer active;
  - settled attempts that have no hold (created while billing was disabled, so billed to nobody);
  - any mismatch between ledger breakdown columns and the journal or open holds.
- Missing evidence remains unresolved. The path out is an H3 operator reconciliation with an evidence code
  (`spend-reconcile`), after which the reconciler charges from that recorded amount.
- Not scheduled by this PR.

## 8. Stripe invoice lifecycle (H4 outbox)

```
prepared ──claim──▶ submitting ──item created──▶ item_created ──item joins invoice──▶ invoiced ──▶ paid
    ▲                   │ timeout/5xx/429                                               │      ├─▶ payment_failed ──▶ paid
    └── confirmed ──── ambiguous ◀── stale claim (10 min)                                │      ├─▶ uncollectible ──▶ paid
        absent              │ found by metadata ──▶ item_created                          └──────┴─▶ void
any unsafe fact (customer mismatch, live mode, rejection, duplicate items, amount mismatch) ──▶ manual_intervention
```

- `prepare` runs only for periods that ended more than the grace period ago. It assigns every unbilled charge of that
  hotel and period to one operation and rounds the exact USD total once, to whole cents. A total of 0 becomes
  `nothing_to_bill`. A negative total, a missing customer or an inactive or cancelled subscription becomes
  `manual_intervention`.
- An **invoice item** id (`ii_…`) and an **invoice** id (`in_…`) live in separate, format-checked columns. History links
  only actual invoices. A pending item shows "On next invoice". Nothing is shown as paid unless Stripe said `paid`.

## 9. Database migration safety

- 248 and 249 are additive and contain no destructive statement (`check-migrations.mjs`: non-destructive).
- New `credit_ledger` columns have defaults, so existing rows read as zero agent usage and the legacy math is
  unchanged.
- No H3 function is replaced. H4 adds one trigger to `agent_model_attempts`, which is inert while the mode is
  `disabled`.
- All functions are SECURITY INVOKER with `search_path = ''` and are executable only by `service_role`. All tables have
  RLS on and no end-user grants.
- Because nothing is destructive, the existing Staging Candidate / Staging Gate applies them through the normal gated
  path. No reviewed preview is required.

## 10. Operator commands (`python -m services.agent_billing …`)

`status`, `reconcile [--apply]`, `controls`, `policy-propose`, `policy-approve`, `policy-retire`, `adjust`,
`trueup-prepare`, `trueup-run`. The module docstring describes each. There is no command that opts a hotel into
overage.

## 11. Emergency shutdown and incident recovery

| Situation | Action |
|---|---|
| Stop all new customer-billed AI immediately | H3: `spend-switch --off` (no paid calls at all). Billing stays consistent: open holds resolve through the reconciler. |
| Stop customer billing but keep the H3 dev/staging harness | `controls --mode disabled`. Wrappers become pass-through; existing holds and charges are kept. |
| Stop Stripe activity | `controls --mode enforced` without `--trueup`, or unset `AGENT_BILLING_STRIPE_TRUEUP_ENABLED`. Operations stay `prepared`. |
| One hotel | `policy-retire --tenant T --reason R`. That hotel's agent calls fail closed. |
| Wrong charge | `adjust` (two-person, compensating). If already billed, the adjustment is a late credit for operator review (`net_credit_requires_operator`). |
| Operation in `manual_intervention` | Inspect `agent_billing_operation_events` and Stripe test-mode records for metadata `patelrep_billing_operation_id`. If confirmed absent, call `agent_billing_operation_record(... 'resolve_retry' ...)` as `operator` with an evidence code. If an item exists, record it with `item_created`. |
| Ledger drift reported | Do not edit `credit_ledger` by hand. Compare the journal and holds; open an incident. Drift should be impossible (single-transaction updates). |

## 12. Safe staged activation (each step needs separate human authorization)

1. Merge (human). Staging gets 248/249 through the normal gate. Production stays untouched; the mode stays `disabled`.
2. Staging only: create a policy for a synthetic hotel (two operators). Set `controls --mode enforced`. Exercise holds
   with fake providers. Run `reconcile`.
3. Staging only: set the Stripe test-mode key and `AGENT_BILLING_STRIPE_TRUEUP_ENABLED`, then `controls --trueup`.
   Run `trueup-prepare` / `trueup-run` against Stripe **test mode**.
4. Product owner approves pricing (§13). Live Stripe needs a reviewed code change (`H4_LIVE_STRIPE_SUPPORTED`) *and* a
   reviewed migration (outbox `livemode` constraint). Neither is in this PR.
5. Production activation is a separate release decision.

## 13. Outstanding product decisions (not made by this PR)

1. **Included allowance and pricing for agent usage:**
   - whether agents share the plan's credits;
   - the markup multiplier;
   - the minimum credits per operation;
   - the hard agent-overage cap per plan.

   No values are hardcoded; every policy is entered by operators.
2. **Credit price:** whether the agent credit price may differ from the legacy $0.02. A different price requires
   migrating `credit_ledger`'s generated overage columns.
3. **Allowance order:** the attribution rule when legacy usage consumes allowance that an agent hold reserved. The
   current rule is chronological, so legacy usage after the allowance is exhausted is legacy overage under existing
   terms.
4. **Cancellation billing (F5):** how to bill legacy overage at cancellation. Options are a final invoice or no charge;
   today it creates a pending item with no next invoice.
5. **Legacy true-up onto the outbox (F6):** whether to move the legacy true-up onto the H4 outbox.
6. **Consent terms:** customer-facing terms text and the `terms_version` scheme.
7. **Unbilled work:** whether usage settled while billing was disabled (dev/staging only) should ever be billed.
   Current answer: never.
