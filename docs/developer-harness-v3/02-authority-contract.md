# Developer Harness V3 — 02 Authority Contract

Machine-readable form: [`authority-contract.json`](authority-contract.json). Consumer: `scripts/developer-harness-v3/authority/`.
**Status: contract-only. No action is active.** V2 (`docs/developer-harness-v2/contract.json`, `.claude/settings.json`, the V2 hook, the
existing gates and rulesets) stays authoritative until a later phase activates a successor through the trusted bootstrap in 04.

## 1. Principle

The owner decides what PatelRep becomes. The harness decides how. V3 replaces V2's "ask a human" with **verification that scales with risk**:

| Class | Meaning | What higher risk adds |
|---|---|---|
| **allowed** | executes automatically; local, reversible, task-scoped, cannot change authority, spend or shared state | nothing |
| **safeguarded** | executes automatically **only after independent verification** | more required evidence, never a routine permission prompt |
| **prohibited** | always blocked; no identity, evidence or policy claim can authorize it | n/a. Changing a prohibition is an owner ceremony (04 §5) |

Unknown actions are prohibited. Anything the evaluator cannot parse, prove or explain is a denial.

## 2. Identities (twelve, independently enforced)

`task_ingress` · `orchestrator` · `implementer` · `independent_reviewer` · `security_reviewer` · `trusted_publisher` · `delivery_verifier` · `merger` ·
`production_releaser` · `recovery` · `notifier` · `policy_promoter`.

Rules the code enforces (tested): the **implementer** is the only identity that writes candidate code and it can issue no evidence and hold no key;
it cannot obtain authority by changing its own code, instructions, role, task state, configuration or evidence. An identity is **established by the
trusted controller** and passed as `trusted.identity`; a request that *claims* a different identity is denied (`IDENTITY.CLAIM_MISMATCH`), never
adopted. Repository text, AI output, logs, issues, external content and Telegram messages are never authority; Telegram can only reach
`task_ingress` after D3.8 authentication.

## 3. Actions

| Class | Actions (abbreviated; the JSON is normative) |
|---|---|
| allowed | `read_repository`, `edit_files_in_task_worktree`, `commit_to_task_branch`, `run_local_checks`, `checkpoint_task`, `queue_task`, `send_notification`, `cleanup_task_owned_resources`, `accept_evidence`, `launch_claude_session` |
| safeguarded | `start_bypass_permissions_session`, `publish_candidate_branch`, `mark_pull_request_ready`, `verify_delivery_eligibility`, `merge_pull_request`, `production_release`, `production_recovery`, `access_credential`, `promote_policy` |
| prohibited | push to `main`, force-push protected branches, modify historical migrations, `supabase migration repair`, apply unreviewed migrations remotely, expose credentials to the candidate environment, **activate customer-agent execution, grant customer-agent autonomy, enable customer-agent billing**, paid model authentication, purchasing usage or upgrading, raising own spend authority, self-approval, selecting own policy revision, modifying active enforcement from a candidate, weakening required gates, bypassing hooks or gates, unofficial Claude authentication, modifying the Claude binary, enabling host Bypass Permissions, deleting task evidence, terminating unowned processes |

`launch_claude_session` is *allowed* only because its checks (`spend`, `launch_environment`) fail closed on any paid or unverifiable authentication
path. Every safeguarded action declares `requires_activation`; the shipped contract activates none (`ACTIVATION.NOT_ACTIVE`, with a dry-run
summary of whether its requirements would otherwise be met).

## 4. Checks (deterministic, no AI, no network)

`path_validity` · `scope` · `candidate_binding` · `protected_paths` · `control_plane_self_change` · `migrations` · `customer_agent` ·
`credentials_env` · `credential_scope` · `spend` · `launch_environment` · `environment_isolation` · `resource_ownership` · `evidence_validity` · `promotion`.

Decisions covered by the brief → where implemented:

| Decision | Implementation |
|---|---|
| Task scope | `scope` against `trusted.task.authority.allowed_paths/denied_paths`, **bound to the signed `task_authority` evidence by `authority_digest`**; path normalization rejects `..`, backslashes, drive letters, trailing dot/space, 8.3 names, alternate data streams, case collisions |
| Protected paths | `protected_paths` (task must authorize; adds independent + security review) and root-of-trust paths (**denied to automation**) |
| New vs historical migrations | `migrations` from **Git facts only** (`git-facts.mjs` → `migration-facts.mjs`); no label input exists |
| Trusted execution identity | `trusted.identity` + `IDENTITY.*` codes |
| Candidate publication / delivery eligibility | `publish_candidate_branch`, `verify_delivery_eligibility`, `merge_pull_request` evidence sets |
| Review and test evidence acceptance | `evidence.mjs` + `accept_evidence` |
| Policy-change eligibility | `promote_policy` + `policy-version.mjs` |
| Production credential restrictions | `credential_scope` (per-scope identities **and** per-scope evidence), `credentials_env` (credential-shaped variable names forbidden in a worker environment) |
| Resource and spending restrictions | `spend` (limit `$0`), `launch_environment`, `resource_ownership`, `lifecycle/resource-admission.mjs` |
| Prohibited customer-agent activation | prohibited actions; declared-effect denial; **heuristic** migration tripwire (can only add a denial, never grant) |

## 5. Evidence

Strict, versioned envelope: `{schema, version:1, payload, signature:{alg:'ed25519', key_id, value}}`. Twelve evidence types, each with permitted
issuer identities, bindings (repository, base SHA, candidate SHA, tree digest, policy revision, environment, subject policy revision, authority
digest), maximum TTL and single-use/independence flags. Verification order and codes are in `authority/evidence.mjs`. **A self-computed checksum is
not authentication**: acceptance requires an Ed25519 signature verified against a key pinned by the **active** policy for the claimed issuer, inside
its validity window, with the payload bound to the exact candidate, tree, base, repository, environment, task, fencing token and active policy
revision. Reviews must come from contexts distinct from the author's and from each other.

**Implemented now:** the verifier, the ledger semantics, the contract. **Not implemented (D3.3+):** any issuer service, any production signing key,
the durable replay ledger. In D3.2 `trusted_keys` is empty, so *nothing* authenticates, which is the safe default.

### Hardening added after the independent security review

- **No self-attested approvals.** Evidence types flagged `approval` (`independent_review`, `security_review`, `policy_promotion_approval`, `isolation_attestation`, `delivery_verification`, `merge_receipt`)
  may never be issuable by an identity that requests the action they approve; `validateContract` rejects such a contract. Consequently `policy_promotion_approval` and `isolation_attestation` are issued by
  `delivery_verifier` (the trusted verifier that probes the environment and checks promotion conditions), not by `policy_promoter` or `orchestrator`.
- **Promotion is bound end to end.** For `promote_policy` the independent review, security review and test results must each be bound to the **successor revision** (`subject_policy_revision`), and the
  controller must show the proposal was derived from the candidate tree the evidence is bound to (`trusted.proposed_policy_source_tree`).
- **Worker environments are allow-listed.** `worker_environment_allowlist` names are the only variables a worker may have; a credential-shaped name gets `CREDENTIAL.IN_WORKER_ENV`, any other unlisted name
  `ENV.NAME_NOT_ALLOWLISTED`. For launches the effective environment includes `settings.env` keys.
- **Globs are not regular expressions.** Contract globs use a restricted alphabet and a linear segment matcher (`lib/paths.mjs`); `**` and `*` cannot cause backtracking, so no auto-promotable list entry can stall the evaluator.
- **Git fact gathering is hardened** against repository config: colors, `diff.ignoreSubmodules`, `binary` attributes, textconv/external diff, literal pathspecs, a blank global config; the origin URL match is anchored. Symlinks and gitlinks are reported and refused.
- **Snapshot once.** `evaluate`, `loadPolicy`, `promotionCheck` and `validateEvidence` clone untrusted input at entry, so a getter or proxy cannot show different values to different checks.

### Evidence consumption and sequencing (post-review clarifications)

- **Single-use evidence is consumed per action.** `delivery_verification`, `merge_receipt`, `production_verification` and `policy_promotion_approval` are single-use. Each safeguarded delivery
  action (merge, production release, production credential access) therefore needs its **own freshly issued** single-use item with its own nonce; one verification cannot be spent twice.
  `production_verification` is consumed by the lifecycle transition to `completed` in D3.7 and is intentionally not an input to any D3.2 action.
- **The caller must consume atomically.** The evaluator never mutates the ledger; it returns `consumes`. The runtime must call `EvidenceLedger.consumeAll(consumes)` (or the durable equivalent) **in the
  same transaction as the action it authorizes** and abort if it returns false. Two concurrent `allow` decisions on the same single-use evidence cannot both succeed.
- **Requester-supplied fields can only ADD denials.** `params.incremental_usd`, `purchase`, `customer_agent_effect` and `paths` are requester claims. Real spend, resource ownership/lifecycle and
  candidate facts come from trusted inputs (`trusted.launch`, `trusted.resources`, `trusted.candidate`); a trusted spend ledger is D3.3 work.
- **Facts must be complete.** Candidate facts with gatherer warnings (`problems`), an unverified origin, or any symlink/gitlink change are refused (`FACTS.INCOMPLETE`, `FACTS.ORIGIN_UNVERIFIED`, `PATH.SPECIAL_FILE_MODE`).
  A new migration is accepted only if `trusted.target_tip_sha` equals the candidate's base (`MIGRATION.BASE_NOT_CURRENT` otherwise).
- **Review independence needs a known author context.** Without `trusted.task.author_context_id` review evidence is rejected (`EVIDENCE.AUTHOR_CONTEXT_UNKNOWN`).

## 6. What the contract deliberately does not do

It does not weaken, replace or bypass CI Gate, Mobile CI, Staging Gate, the Database Migration Gate, schema contracts, rulesets, the trusted
publisher, reviewed-migration protections, production target verification, release auditing, backup/recovery, tenant isolation, or customer-agent
execution and billing controls. It does not enable Bypass Permissions, automatic merge or production delivery.
