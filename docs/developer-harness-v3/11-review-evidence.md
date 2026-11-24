# Developer Harness V3 — 11 Independent Review Evidence (D3.2)

Two reviews were run **sequentially**, each in a fresh agent context that received the task specification, the threat model and the commit, but **not** the implementer's reasoning or the other review's output.
Honest limits: both reviewers are AI agents from the same model family as the implementer, in separate contexts (code review: Sonnet; security review: Opus). They are independent contexts, **not independent humans**,
and not an external audit. Their reports are recorded here as findings and dispositions; the reports' own claims were checked by re-running or re-reading, not trusted blindly. Reported subagent token counts
(code review ≈246 k, security review ≈192 k) are harness-reported tool metrics, **not** subscription usage; actual Pro-allowance consumption is **NOT MEASURED**.

Reviewed commits: code review at `f683ab93`; security review at `2dccabe7` (code-review remediation applied). Remediation of the security review is in the commit that adds this file.

## 1. Code review (commit f683ab93) — verdict: not ready as the D3.3 foundation until findings 1–6 were fixed

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | Author-independence check failed open without `author_context_id` | **Fixed** `EVIDENCE.AUTHOR_CONTEXT_UNKNOWN`; test `review #1` |
| 2 | High | `scope` depended on check order; reorder-then-promote bypass | **Fixed** lazy path loading; validator requires `path_validity` with `scope`; test `review #2` |
| 3 | High | `accept_evidence` had no replay detection without a ledger | **Fixed** ledger required; test `review #3` |
| 4 | High | Resource ownership taken from the request | **Fixed** controller registry `trusted.resources`; test `review #4` |
| 5 | High | `head_changed` mishandled recoverable/blocked states, bypassing the post-merge guard | **Fixed** effective-state logic; test `review #5` |
| 6 | High | `launch_claude_session` ran no credential-environment check; token not forbidden | **Fixed** `credentials_env` on launches; `CLAUDE_CODE_OAUTH_TOKEN` forbidden; test `review #6` |
| 7 | Med | An added line starting with `++` was dropped from tripwire input | **Fixed** hunk-based parsing; test `review #7` |
| 8 | Med | Gatherer warnings and unknown origin were never consumed | **Fixed** `FACTS.INCOMPLETE`, `FACTS.ORIGIN_UNVERIFIED`; test `review #8` |
| 9 | Med | Idempotency replay accepted before fencing/payload checks | **Fixed** fencing first, payload-digest binding; test `review #9` |
| 10 | Med | Remediation skippable through waiting-state chains; incident from any wait | **Fixed** `via_remediation`; effective-state incident rule; test `review #10` |
| 11 | Med | Policy-revision invalidation, risk-conditional security review, owner action to leave `blocked` were claimed but missing | **Fixed** `policy_changed`, `security_review_required`, `owner_action_id`; docs corrected; tests `review #11` |
| 12 | Med | `validateContract` ignored sections the evaluator uses; ReDoS surface | **Fixed** validation added; regex use removed from globs; tripwire made linear; tests `review #12`, `sec #3` |
| 13 | Med | Single-use evidence sequencing across actions undocumented; `production_verification` unused | **Documented** (02); `production_verification` stays reserved for the D3.7 lifecycle transition |
| 14 | Med | No check that the candidate's base is current (migration numbering) | **Fixed** `MIGRATION.BASE_NOT_CURRENT` against `trusted.target_tip_sha`; test `review #14` |
| 15 | Med | Spend inputs requester-controlled | **Documented** requester fields can only add denials; a trusted spend ledger is D3.3 |
| 16 | Low | Broken README link | **Fixed** (this file) |
| 17 | Low | Protected-path gaps, device names, symlink/gitlink blindness | **Fixed** protected list extended; device names rejected; special modes refused; tests `review #17` |
| 18 | Low | `in` lookups through the prototype chain | **Fixed** own-property lookups; test `review #12/#18`, `sec #10` |
| 19 | Low | `admitTask` unvalidated thresholds/metrics | **Fixed** validation; contract is the stated source of the session limit; test `review #19` |
| 20 | Low | No consume-atomically contract | **Fixed/Documented** `consumeAll`; 02/04 discipline; test `review #20` |
| 21 | Low | Tests that could not fail; V2 coupling | **Fixed** constant assertions removed, many tests added; the V2-characterization test still couples to V2 router behavior **by design** and says so |
| 22 | Low | Tripwire easy to dodge | **Improved** order-insensitive, linear; still a heuristic that only adds denials |
| 23 | Low | Dead fields; no fencing rotation event | **Partly fixed** `worker_recovered` added. `idempotency_id`/`results` evidence fields and `event_id` remain reserved for the durable ledger (D3.4) |

## 2. Security review (commit 2dccabe7) — verdict: sound as an INACTIVE foundation; fix #1 #5 #2 #3 #4 #8 first, #6 #7 before the launcher

| # | Sev | Finding (verified by probe unless noted) | Disposition |
|---|---|---|---|
| 1 | High | Promotion reviews not bound to the proposed policy; promoter approved its own request | **Fixed** reviews/tests bound to `subject_policy_revision`; approval issued by `delivery_verifier`; `approval` flag + validator rule; `PROMOTION.PROPOSAL_NOT_FROM_CANDIDATE`; tests `sec #1` |
| 2 | High | Customer-agent globs matched none of the real agent code (`apps/api/services/agent_*`) | **Fixed** globs corrected; test asserts every real agent file under `apps/api/{services,routers}` is watched (`sec #2`) |
| 3 | Med | A "strengthening" glob/regex entry could freeze the evaluator (23 s on 60 chars) | **Fixed** regex-free linear matcher; restricted glob alphabet; wildcard cap; `sec #3` |
| 4 | Med | Hostile git config (color, `ignoreSubmodules`) blinded facts; origin regex unanchored | **Fixed** hardened invocation, `--text`, literal pathspecs, anchored origin; `sec #4` |
| 5 | Med | Orchestrator approved its own bypass session | **Fixed** attestation issuer is `delivery_verifier`; validator rule; `sec #1/#5` |
| 6 | Med | Auth check missed `settings.env`; value match case-sensitive | **Fixed**; `sec #6` |
| 7 | Med | Credential check was a denylist missing real secret names | **Fixed** allow-list model; `sec #7` |
| 8 | Med | Root-of-trust list omitted reducer, tests, `settings.local.json`, agent definitions | **Fixed**; `sec #8` |
| 9 | Low | Edit/commit scope used requester-declared paths | **Fixed** candidate changes also checked; `sec #9` |
| 10 | Low | `diffPolicy` prototype-chain lookups | **Fixed**; `sec #10` |
| 11 | Low | TOCTOU on multiply-read inputs | **Fixed** snapshot at entry; `sec #11` |
| 12 | Low | One public key under several identities | **Fixed**; `sec #12` |
| 13 | Info | Signature string malleability; lenient dates; `accept_evidence` returns no nonce list | **Fixed** canonical signature encoding, strict ISO round-trip, `validated` list returned; `accept_evidence` validates authenticity, **not** the verdict, by design |
| — | reasoned | Invalid paths silently dropped in pattern checks; non-string `denied_paths`; U+FFFD; literal pathspecs | **Fixed** denial on invalid paths, `denied_paths` type check, encoding rejection, literal pathspecs |
| — | reasoned | `supabase/config.toml`, `supabase/seed.sql` not protected | **Accepted risk** (CI-local database only); revisit in D3.6 |

Categories the security reviewer reported as holding up: canonicalization, policy pinning and loaded-policy provenance, signature/domain separation and S+L malleability, key/identity cross-check and windows, TTL and
binding, nonce conflicts, single-use replay, prohibited-action immutability, path normalization on NTFS, migration classification, lifecycle fencing, and absence of command/argument injection in fact gathering.

## 3. Re-verification of the security remediation (commit 43e25875) — verdict: sound to merge as an inactive foundation

The same security reviewer re-ran its own probes and attacked the new code (glob matcher, allow-list, promotion binding, snapshotting, hardened git invocation, reducer). All 13 original findings were confirmed
fixed except two leftovers, plus one regression it found in my rewrite. Dispositions:

| Finding | Sev | Disposition |
|---|---|---|
| Literal `*` in a path segment defeated the new glob matcher (`supabase/seed*` missed `supabase/seed*.sql`) | Low (new) | **Fixed** matcher tests the wildcard first; `* ? " < > \|` are rejected in repository paths (illegal on NTFS); tests `sec re-verification` |
| `LC_*` / `XDG_*` allow-list wildcards admitted secret-shaped names | Low (open #7) | **Fixed** exact names only; credential patterns gained `*TOKEN*`, `*_KEY`, `*AUTH*`; test |
| `NODE_OPTIONS`, `HTTP(S)_PROXY` are on the allow-list and change worker behavior | Low | **Accepted**: their VALUES are set only by the trusted launcher, never by the candidate; recorded for D3.3 |
| Patch digest depended on repo-local diff settings | Info | **Fixed** (pinned `diff.context`, `algorithm`, `noprefix`, `mnemonicPrefix`, `interHunkContext`); `.git/info/attributes` cannot be pinned by flag, so a divergent digest simply fails to bind (fail closed) |
| `lifecycle.mjs` | — | unchanged since the first remediation, nothing new found |

Held up under re-verification: hardened git invocation (color, `ignoreSubmodules`, `binary` attributes, `bigFileThreshold`), glob validation, the approval self-attestation rule, the `proposed_policy_source_tree` check
(a controller-asserted value that the evaluator cannot verify further), and snapshotting. No glob that matched under the old regex stopped matching across every repository file and 27 crafted edge paths, except the literal-`*` case now fixed.

The final two fixes above were verified by tests but **not** given a further independent review pass.

## 4. Verification evidence

V3 suite (sequential, 1 GB heap): **105 tests pass** at the final candidate. V2 regression through the V2 CI runner (run before the V3 remediation commits; V2 files are unchanged by this PR): 5 of 7 suites pass; the
2 failing items are the two known local-only Windows conditions (directory-symlink privilege skip; the archive "manifest entries" assertion in a full clone) recorded against main before this work. The pinned CI guard and
delivery-contract tests (39) pass. CI and Staging evidence for the exact head is in the PR report.
