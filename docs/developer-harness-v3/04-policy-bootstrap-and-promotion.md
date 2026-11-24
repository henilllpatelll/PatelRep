# Developer Harness V3 — 04 Policy Bootstrap and Promotion Protocol

Implements: `authority/contract.mjs` (bundles, revisions, `loadPolicy`), `authority/policy-version.mjs` (diff, `promotionCheck`), evaluator action
`promote_policy`. Tested in `tests/promotion.test.mjs` and `tests/foundation.test.mjs`.

## 1. Objects

- **Policy bundle** = `{contract, trusted_keys, parent_revision}`.
- **Revision** = sha256 of its canonical JSON. Content-addressed: any change, including activation of one action, is a new revision. `parent_revision`
  chains revisions, so a successor names the policy it replaces.
- **Pin** = the revision the trusted controller currently treats as active. The pin is **never** read from the candidate.
- `loadPolicy(bundle, pin)` accepts a bundle only if it is structurally valid (contract rules, key rules) **and** its recomputed revision equals the
  pin. The evaluator accepts only objects produced by `loadPolicy` (frozen, registered), so a hand-built policy object is refused (`POLICY.NOT_LOADED`).

## 2. Selection and pinning (what is enforced where)

| Concern | Enforced by code now | Must be enforced by the deployed runtime |
|---|---|---|
| Candidate cannot choose its policy | `claimed_policy_revision` ≠ pinned → deny; evidence for another revision rejected | the pin lives outside Z3 (controller DB / root-owned file) |
| Candidate cannot alter active enforcement | root-of-trust paths denied to automation | verifier runs from a pinned checkout; Z3 has no write path to Z2/Z4 |
| Candidate cannot issue its own evidence | signature must verify against pinned keys; implementer has none | private keys held only by issuer processes in Z2/Z4 |
| Candidate cannot change its own financial authority | `limits.max_incremental_usd` is root-of-trust; spend prohibited actions | no payment method reachable from any zone |
| Candidate cannot reclassify prohibited actions | validator forbids downgrading `REQUIRED_PROHIBITED`; diff marks any downgrade `weakening` | n/a |
| Candidate cannot activate a successor | `promote_policy` needs the **active** policy's evidence and is inactive in D3.2 | promoter process alone writes the pin |
| Candidate cannot weaken verification and benefit immediately | decisions use the active policy; weakening cannot be promoted automatically | n/a |

## 3. Promotion (automated path: strengthening or neutral only)

The ACTIVE policy governs validation of its successor. For `promote_policy`:

1. Established identity must be `policy_promoter`.
2. The successor's own structure must validate. Its revision is **recomputed**, never read from the proposer.
3. `parent_revision` must equal the active revision (`PROMOTION.PARENT_REVISION_MISMATCH`); an empty diff is `PROMOTION.NO_CHANGE`.
4. `diffPolicy(active, proposed)` classifies every change:
   - **weakening** (class downgrade, a removed prohibition, a new *allowed* action, broadened identities, removed evidence/checks/bindings, longer TTL,
     reusable evidence, dropped independence, shrunk protected paths, removed forbidden variables, raised limits, changed migration or customer-agent
     rules, any unclassified change) → `PROMOTION.WEAKENING_REQUIRES_OWNER_CEREMONY`;
   - **root_of_trust** (trusted keys, identity registry, evidence issuers, root-of-trust paths, financial authority, credential scopes, activation,
     contract identity) → `PROMOTION.ROOT_OF_TRUST_REQUIRES_OWNER_CEREMONY`;
   - **strengthening/neutral** only → eligible.
5. Required evidence (from the **active** contract): `independent_review`, `security_review` (distinct contexts, neither the author's),
   `test_results` (policy regression suite on the exact candidate), `policy_promotion_approval` from `policy_promoter` whose
   `subject_policy_revision` equals the recomputed successor revision. The approval is **single-use** and consumed through the ledger.
6. On success the promoter (Z2) writes the new pin. D3.2 never writes a pin.

Because every check reads `active`, a successor can neither lower its own bar nor vouch for itself: evidence minted under the successor's revision
is rejected as `EVIDENCE.WRONG_POLICY_REVISION` while the active policy governs.

## 4. Bootstrap (first activation)

The shipped bundle has `parent_revision: null`, `trusted_keys: {}` and no active action. Bootstrap is an **owner ceremony**, because the first set of
keys and the first activation cannot be authorized by a policy that does not yet exist:

1. Owner reviews and merges this PR (human merge, per the existing boundary).
2. D3.3 provisions the isolated environment; D3.4 provisions issuer processes and generates keys **inside** Z2/Z4 (private keys never leave).
3. Owner signs off a bundle that adds the public keys, records its revision, and stores the pin in the controller store (out-of-band).
4. Each later activation of an action class (merge, production) is an owner ceremony until D3.9 proves the system end to end.

### Ledger discipline (required of the runtime)

The evaluator returns `consumes` and never writes. The deployed controller must consume them atomically with the authorized action. A durable ledger must keep the semantics of `EvidenceLedger`:
nonce → payload digest (a nonce re-presented with different content is rejected), single-use consumption that is all-or-nothing.

## 5. Owner ceremony (root-of-trust changes)

Performed by the owner outside the harness, producing a new bundle whose `parent_revision` is the current pin, recorded with the owner's own
commit/signature in a location Z3 cannot write. Triggers: any `weakening` or `root_of_trust` diff, key rotation or revocation, activation or
de-activation of an action, any change to the evaluator/verifier code that is deployed as the trusted checkout. **Emergency de-activation**
(removing an active action, adding a prohibition) is allowed as a unilateral owner action and never needs the harness.

## 6. Exceptional changes that cannot safely self-authorize

(a) the first trusted-key registry; (b) the identity of `policy_promoter` and its key; (c) the evaluator, verifier and fact-gatherer code once
deployed; (d) `.claude/settings.json` permission mode and hooks; (e) financial authority; (f) activation list. These are listed in
`root_of_trust_paths` / diff `root_of_trust`, and automation cannot satisfy them by design.

## 7. Guarantees: now vs D3.3

| Guarantee | Now | Needs D3.3 runtime integration |
|---|---|---|
| Policy revision is content-addressed and pin-checked | ✅ library | pin storage and access control |
| Only `loadPolicy` output is evaluated | ✅ library | n/a |
| Successor diff classification and promotion rules | ✅ library | promoter process writing the pin |
| Evidence authenticated by pinned keys | ✅ verifier | issuer services and key custody |
| Root-of-trust paths denied to automation | ✅ evaluator | the evaluator actually gating the publisher/merger |
| Verifier independent of the candidate's tree | ❌ design only | pinned trusted checkout |
| No Z3→Z2 path | ❌ design only | VM isolation and firewalling |
