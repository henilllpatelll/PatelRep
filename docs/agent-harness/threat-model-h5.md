# H5 human-approval threat model

Scope: the two Operations specialists, the plan → gateway handoff, and the two human-approved writes. Assets: work-order
and room-assignment state (staff workload), approval integrity, tenant isolation, guest/staff privacy, provider spend.

| # | Threat | Actor / vector | Mitigation (layer) | Test |
|---|---|---|---|---|
| T1 | Model claims identity, role, hotel or approval | model output, prompt injection | draft schemas have no such field; `hotel_id`, `role`, `approved`, … refused at any depth (H2 schema); identity only from JWT / authoritative reload | `test_untrusted_drafts_are_rejected_with_stable_codes`, planning cases |
| T2 | Injection in a record steers a proposal (e.g. work-order title "assign to X") | staff-entered free text | facts are JSON marked `trusted_instructions: false`; proposals are checked against verified candidates/owner/date, not text | `test_prompt_injection_in_a_record_cannot_steer_a_proposal` |
| T3 | Hallucinated agent, tool or version | model | exact frozen registries; intent allowlist; DB allowlist keyed by agent version | `test_cross_department_and_hallucinated_tools_are_refused`, `test_unknown_tools_and_versions_never_resolve` |
| T4 | Cross-department escalation (Housekeeping agent assigns a work order) | model / misconfiguration | Housekeeping manifest pins no Engineering tool; DB allowlist has no such row; intent write is exact | contract + planning tests |
| T5 | Invented facts ("room is blocked", "overdue") | model | every finding re-evaluated against the verified facts | `test_findings_must_be_true_of_the_facts` |
| T6 | Ineligible or foreign assignee | model / injection | assignee ∈ verified candidates; write re-checks eligibility under lock; cross-hotel ids resolve to nothing | planning + execution tests |
| T7 | Auto-execution of a validated plan | design regression | no path submits; handoff requires the initiator; tests assert zero gateway runs before submission | `test_proposal_executes_only_after_submission_and_independent_approval` |
| T8 | Self-approval | initiator | Python refusal, decide RPC, table CHECK, execution RPC | same |
| T9 | Approval reuse / replay of a different action | attacker with an approval id | approval bound to action digest, invocation, agent+tool version, resource; single use; consumption in the write tx | H2 tests + `test_committed_write_replays_and_a_stale_worker_writes_nothing` |
| T10 | Approver demoted / deactivated between approval and execution | org change | approver's CURRENT role re-read at execution (Python and SQL) | `test_approver_demotion_rejection_and_withdrawal_change_nothing` |
| T11 | Stale approval executes into a changed world | concurrency | expected-owner, blockers, stage, eligibility, hotel day re-checked under row locks; failure is terminal and consumes the approval | `test_world_changes_after_approval_fail_closed_and_consume_the_approval` (6 cases), engineering equivalents |
| T12 | Altered plan submitted | DB tamper / stale screen | stored digest recomputed from the stored plan and compared with the reviewed digest; arguments compared in SQL | `test_submission_refusals_are_enforced_in_code_and_database` |
| T13 | Duplicate side effects | retries, double clicks, crash after commit | one handoff per proposal; idempotency keys; ledger replay; publication operation id = invocation id | duplicate + replay tests |
| T14 | Worker holds a lease while waiting for a human | design regression | `awaiting_approval` releases lease, step and queue message | happy-path test asserts `lease_owner IS NULL` |
| T15 | Tenant override | forged RPC parameters | RPCs keyed by tenant; handoff admit compares tenant, resource and initiator; another hotel reads `not_found` | forged-RPC cases |
| T16 | AI declares a room ready | model | no tool accepts a status; write never updates `room_status.status`; tests assert the stage is unchanged | `test_room_readiness_tools_cannot_set_room_state`, happy path |
| T17 | Privacy leak to the model or logs | adapters, prompts | minimal columns (no guest/notes/names); test asserts guest name and note never reach the model request; metadata-only events | planning happy path, contract test |
| T18 | Spend without authority | planning | reads happen before any paid call; missing grant → `rejected` with zero model attempts; H3/H4 ledgers unchanged | `test_missing_grant_rejects_before_any_model_call` |
| T19 | UI implies an unavailable action | client | routes 404 when gates are off; `actions.*` true only if the backend would accept now | route tests |
| T20 | Production activation by accident | config | production refused in code (gateway, orchestrator, handoff, routes); DB switches default false; no worker deployed | route + config tests |

Residual risks (accepted for H5, tracked for H6+): an approver can approve without reading the facts (UI/H6 must
present them); attendance/roster is not part of server eligibility; a push can be lost if the worker crashes between
commit and notification (same as the human routes).
