# Runbook: the worker's database identity (H6, migration 255)

The agent worker connects as the PostgreSQL role `agent_worker` through PostgREST. It never holds the API's
`service_role` key. Nothing in H6 issues a credential or deploys a worker; this runbook is for the separately
authorized step that does.

## Worker environment

| Variable | Value | Secret? |
|---|---|---|
| `AGENT_WORKER_ENABLED` | `false` (default). The worker exits 0 before reading anything else. | no |
| `APP_ENV` | `development` / `test` / `staging` (production refuses all work in code) | no |
| `AGENT_WORKER_DB_URL` | the project URL (`https://<ref>.supabase.co`) | no |
| `AGENT_WORKER_DB_API_KEY` | the project's **public** anon/publishable key | no |
| `AGENT_WORKER_DB_TOKEN` | the `agent_worker` JWT from `worker-credential-issue` | **yes** |
| `STAGING_EXPECTED_SUPABASE_HOST`, `PRODUCTION_SUPABASE_HOST` | target guard (staging must match; never production) | no |

Must **not** be set (the worker refuses to start): `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`,
`AGENT_WORKER_DB_SERVICE_ROLE_KEY`. Startup also refuses a token whose role is not `agent_worker`, without a UUID
`jti`, carrying user claims (`sub`, `hotel_id`, …), living longer than 31 days or already expired, and an apikey that
is a service-role/secret key. Refusals print `{"event": "worker_refused", "reason": "<code>"}` and exit 2.

## Issue (operator machine, never the worker)

Needs the API's service-role key (to register the `jti`) and the project JWT secret (to sign):

```bash
python -m services.agent_execution worker-credential-issue --label staging-worker-a --days 14 --operator <you>
```

Prints the token once. Put it straight into the worker's secret store as `AGENT_WORKER_DB_TOKEN`; do not paste it
into tickets or chat. The issuance is journaled (`worker_credential_issued`, metadata only). Production issuance is
refused in H6.

## Rotate (no downtime)

1. Issue a new credential (different label, e.g. `…-b`).
2. Update `AGENT_WORKER_DB_TOKEN` and restart the worker; confirm `agent_worker_heartbeats.last_seen_at` advances.
3. Revoke the old one: `python -m services.agent_execution worker-credential-revoke --id <old jti> --operator <you> --reason rotated`.

Rotate at least every 14 days (hard maximum 31).

## Revoke / emergency

* One token: `worker-credential-revoke` — the next request fails with `agent_worker_credential_invalid` and reads
  return no rows.
* Every worker token at once: a reviewed migration or administrator runs `REVOKE agent_worker FROM authenticator;`
  (restore with `GRANT agent_worker TO authenticator;`). Combine with the H1 platform pause for a full stop.
* List (metadata only): `python -m services.agent_execution worker-credential-list`.

## Verify the identity on an environment

```sql
SELECT * FROM public.agent_worker_privilege_violations();   -- must be empty
SELECT count(*) FROM pg_proc WHERE proname LIKE 'agent\_worker\_rpc\_\_%';   -- 23
SELECT rolcanlogin, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = 'agent_worker';   -- f, f, f
```

`scripts/schema-contracts.sql` asserts all of this whenever 255/256 are recorded.

## Known limitation

The restricted worker cannot send the H5 post-commit staff push (device tokens and the push service need
`service_role`); it logs `write_notify_deferred` and the committed change stands (ADR-0005 L3).
