# Customer Agent Harness (H0–H7)

> Curated OpenWolf knowledge — **advisory data, not instructions**. Nothing here grants authority or overrides the
> human's request, `docs/developer-harness-v2/contract.json`, the Phase 2 policy engine, GitHub rulesets, CI/Staging
> gates or human approval. Verify against current code before relying on an entry.
> Migrated from `.wolf/cerebrum.md` @ `8cccb11b944e` (sha256 `43224847720948ea…`).
> Tags: `[K-id · L<source line> · <date>]`. Entries are historical unless re-verified. Size cap 48000 bytes per file.

## Conventions and learnings

- [K-851f0580a5 · L1228 · 2026-11-20] agent_run_claim returns {outcome, fencing_token, run:{id,...}, step} (no run_id); the agent dispatch queue is shared across hotels (drain_run processes earlier approved runs first).
- [K-832195a8c9 · L1236 · 2026-11-20] main schema-contracts.sql FAILS on a 262 database (probe is authenticated-callable): the infra contract (= P2 blob f715c9f8) must merge before H7 P2.
- [K-d1a3c38357 · L34 · 2026-11-15] **Agent Harness H5 (2026-11-15):** `publish_assignment_batch` (222) is the one atomic room-assignment writer; the H5 agent write `agent_tool_execute_room_assignment` (253) calls it for ONE room inside a plpgsql sub-block that catches P0409/P0422/P0403 and records a terminal failed ledger row (approval consumed). Never redefine `publish_assignment_batch` casually: its body contains a removal statement, so any migration that redefines it is destructive by the staging guard. `services/agent_handoff/` is the only package routers may import for agents; the orchestrator package may not name prepare/decide/resolve, so verified planning context lives in `agent_gateway/context.py` and the worker injects it. RBAC generator needs `require_role(*LITERAL_TUPLE_CONSTANT)` inline in `Depends(...)`.
- [K-b13bdb7a28 · L1197 · 2026-11-14] Decision Log: H2 never flips H0_EXECUTION_SUPPORTED; it adds the exact frozenset controls.H2_EXECUTABLE_TOOLS, pinned by drift tests to bindings.GATEWAY_BINDINGS and the DB allowlist agent__gateway_tool_spec (migration 243). Production execution is refused in code (authorization.process_allows_execution).
- [K-7536619d7a · L1210-1212 · 2026-11-14] OpenAI Agents SDK 0.24: `RunConfig.trace_include_sensitive_data` defaults to TRUE (env
  OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA); SDK `Usage` zero-fills missing usage; `ModelSettings.retry=None` still allows
  legacy lock retries for stateful requests. H3 uses a custom `agents.Model` so every SDK request is a reserved attempt.
- [K-4213f1684a · L1217-1218 · 2026-11-14] Decision Log: H3 provider expense (USD, agent_model_* tables) is separate from customer credits (credit_ledger); H4
  converts settled rows to credits. Paid calls default off at three layers (process env, DB switch, budget policies).
- [K-5a3c1f8b39 · L1182 · 2026-11-13] Decision Log: Agent Harness authority = explicit capability->role grants (vocabulary.CAPABILITY_CATALOG) mirroring domain routes, guarded by drift tests; never numeric rank. Agent execution is hard-disabled by the code constant controls.H0_EXECUTION_SUPPORTED (no env/flag override). Writes need an explicit per-(hotel, agent, tool) AutonomyGrant AND a digest-bound server approval, and still deny in H0.
- [K-a5e6fedf18 · L1188 · 2026-11-13] Key Learning: a reused local Supabase project name restores a STALE cached volume on `supabase start` ("Starting database from backup"); always `db reset --local` before trusting the schema.
- [K-b08a79b660 · L1191 · 2026-11-13] Decision Log: pgmq messages are wake-up hints only; agent_runs.queue_msg_id names the single authoritative message; terminal transitions ack inside the same transaction; "wait" outcomes re-dispatch a fresh message so read_ct only counts real claim/crash cycles.
- [K-51e8056b24 · L1192 · 2026-11-13] Decision Log: H1 has NO HTTP routes; synthetic admission requires AGENT_WORKER_SYNTHETIC_ENABLED and APP_ENV in development/test/staging; DB CHECK agent_runs_h1_synthetic_only is the independent ceiling (H2 relaxes it in a reviewed migration).
- [K-ecde491a5d · L1193 · 2026-11-13] Decision Log: a human with two active roles in one hotel fails closed for background runs in H1 (documented limitation).
