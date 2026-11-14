# Agent Harness H1: Operational Runbook

All commands run from `apps/api` with the environment's backend credentials already set (Railway-managed variables in
a deployed environment). They print sanitized JSON: identifiers, states and codes, never payloads. No command here
can enable agent execution.

```bash
python -m services.agent_execution diagnostics [--limit 20]
python -m services.agent_execution recover [--limit 100]
python -m services.agent_execution control --scope platform|hotel|agent [--tenant T] [--agent A] [--paused] [--cost-stop] --operator NAME [--reason CODE]
python -m services.agent_execution run --tenant T --run R --action cancel|pause|resume --operator NAME
python -m services.agent_execution probe --tenant T --operation noop|transient_failure|permanent_failure|delay   # non-production only
```

`diagnostics` returns `runs_by_state`, `oldest_queued_at`, `expired_leases`, `missing_dispatch`, `dead_letters`,
`queue` (depth, visible, oldest message, max `read_ct`, archived), `controls` and `workers`.

## Diagnose a stuck run

1. `diagnostics` → find the run in `expired_leases` or by state. For one run's full history use the tenant-scoped RPCs
   `agent_run_get(p_tenant_id, p_run_id)` and `agent_run_events_page(...)` (SQL editor as service role).
2. `queued` for long: check `workers` (is anyone alive and `running`?) and `controls` (a pause or cost stop blocks claims;
   look for `control_blocked` events). If `missing_dispatch > 0`, run `recover`.
3. `running` with an old `last_heartbeat_at`: the worker likely died. Once `lease_expires_at` passes, the message becomes
   visible and another worker takes over; `recover` also re-dispatches if the message is gone.
4. `retry_wait`: `next_attempt_at` says when; `last_error_class/_code` says why.

## Inspect a failed step

`agent_run_get` → `steps[]` shows `state`, `attempt_count/max_attempts`, `error_class`, `error_code`, `result_meta`.
Events with `event_type = 'step_state_changed'` show each transition, its fencing token and `reason_code`.
`authorization_denied` means the initiator's current membership no longer permits the run (demoted, removed,
deactivated, hotel inactive, or ambiguous roles) — fix the membership and submit a new run; it is never retried.

## Investigate expired leases

`expired_leases` lists runs whose `lease_expires_at` passed. A short-lived entry is normal after a worker restart.
Persistent entries with no `lease_takeover` events mean no worker is claiming: check `workers[].last_seen_at` and the
worker logs (`slot_error`, `store_call_failed`, `claim_skipped`). Never edit lease columns by hand.

## Check queue backlog

`queue.depth` (all messages), `queue.visible` (ready now), `queue.oldest_enqueued_at`, `queue.max_read_ct`. Depth larger
than active runs is expected while retries wait. A high `max_read_ct` means repeated crash/claim cycles.

## Identify dead-lettered runs

`dead_letters` lists the latest with `last_error_class`, `last_error_code`, `attempt_count`. Their final message is kept
in `pgmq.a_patelrep_agent_runs_v1`. Dead letters are terminal; investigate, fix the cause, then submit a new run with a
new idempotency key.

## Safely disable the worker

* Fastest, platform-wide: `control --scope platform --paused --operator NAME --reason incident`. New admissions and
  claims stop; running work yields at its next checkpoint. Clear with the same command without `--paused`.
* Cost emergency: `control --scope platform --cost-stop ...`.
* One hotel / one agent: `--scope hotel --tenant T --paused` / `--scope agent --agent harness.synthetic --paused`.
* Stop the process: unset `AGENT_WORKER_ENABLED` (or stop the service). SIGTERM drains gracefully. Queued runs wait;
  hotel operations are unaffected.

## Recover from a worker restart

Nothing manual is required: in-flight runs either yielded (graceful stop) or are retaken after lease expiry, and slot 0
runs `recover` on start. To speed up, run `recover` once. Cancellations requested while the worker was down complete
on the next claim or sweep.

## Verify no operational agent actions are enabled

1. `python -c "from services.agent_harness.controls import H0_EXECUTION_SUPPORTED as x; print(x)"` → `False`.
2. `SELECT conname FROM pg_constraint WHERE conname = 'agent_runs_h1_synthetic_only';` → present.
3. `SELECT DISTINCT agent_id FROM public.agent_runs;` → only `harness.synthetic` (or empty).
4. In production `diagnostics.workers` should be empty or show `disabled`; a production worker refuses to process.
5. `grep -rn "services.agent_execution" apps/api --include=*.py` outside the package and tests → nothing (enforced by
   `tests/smoke/test_agent_execution_isolation.py`).
