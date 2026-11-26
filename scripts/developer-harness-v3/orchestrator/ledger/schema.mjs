// Developer Harness V3 (D3.4) — durable execution ledger schema (SQLite via node:sqlite, built in; no extra service or dependency).
//
// Append-only where history matters (task_events), immutable where identity matters (task requirements), and constrained by the database itself
// (UNIQUE / partial UNIQUE / CHECK / triggers) so that a buggy or racing caller cannot violate an invariant the reducer already pins:
//   * one active reasoning lease at a time (partial unique index),
//   * one acceptance of a nonce and one consumption of an evidence id,
//   * one action intent per idempotency key,
//   * original requirements are immutable and digest-bound.
// Migrations are explicit, ordered and each runs in its own transaction; a database newer than this code is refused (never downgraded).
export const SCHEMA_VERSION = 1
export const LEDGER_APPLICATION_ID = 0x44483334 // 'DH34'

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  submit_key TEXT NOT NULL UNIQUE,
  repository TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  requirements_digest TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('routine','complex','security_sensitive')),
  priority INTEGER NOT NULL DEFAULT 100,
  lifecycle_json TEXT NOT NULL,
  state TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  fencing_token INTEGER NOT NULL,
  head_sha TEXT,
  policy_revision TEXT,
  environment_id TEXT,
  handoff_ready INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX tasks_state ON tasks(state, priority, created_at);
CREATE TRIGGER tasks_requirements_immutable BEFORE UPDATE OF task_id, submit_key, repository, base_sha, requirements_json, requirements_digest, scope_json, acceptance_json, risk_class ON tasks
BEGIN SELECT RAISE(ABORT, 'LEDGER.TASK_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;

CREATE TABLE task_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  idempotency_id TEXT NOT NULL,
  event_digest TEXT NOT NULL,
  event_json TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  resulting_revision INTEGER NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (task_id, idempotency_id)
) STRICT;
CREATE TRIGGER task_events_append_only_u BEFORE UPDATE ON task_events BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
CREATE TRIGGER task_events_append_only_d BEFORE DELETE ON task_events BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;

CREATE TABLE plans (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  plan_version INTEGER NOT NULL,
  plan_digest TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, plan_version)
) STRICT;
CREATE TABLE plan_steps (
  task_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','abandoned')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, plan_version, step_id),
  FOREIGN KEY (task_id, plan_version) REFERENCES plans(task_id, plan_version)
) STRICT;

CREATE TABLE executions (
  execution_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  role TEXT NOT NULL CHECK (role IN ('planner','implementer','independent_reviewer','security_reviewer','summarizer')),
  stage TEXT NOT NULL,
  context_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  model_requested TEXT NOT NULL,
  effort_requested TEXT NOT NULL,
  model_actual TEXT,
  cli_version TEXT,
  context_window INTEGER,
  status TEXT NOT NULL CHECK (status IN ('starting','running','ended','terminated_verified','termination_unverified','abandoned')),
  end_reason TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  telemetry_json TEXT,
  fencing_token INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
) STRICT;
CREATE INDEX executions_task ON executions(task_id, ordinal);
CREATE UNIQUE INDEX executions_context_unique ON executions(task_id, context_id);

CREATE TABLE leases (
  lease_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  execution_id TEXT NOT NULL REFERENCES executions(execution_id),
  fencing_token INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','released','superseded','termination_unverified')),
  reasoning_slot INTEGER NOT NULL DEFAULT 1,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER
) STRICT;
-- One reasoning session at a time across ALL tasks and reviewers. A lease whose session could not be proven dead keeps the slot.
CREATE UNIQUE INDEX one_reasoning_slot ON leases(reasoning_slot) WHERE state IN ('active','termination_unverified');

CREATE TABLE candidates (
  candidate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  base_sha TEXT NOT NULL,
  candidate_sha TEXT NOT NULL,
  tree_digest TEXT NOT NULL,
  patch_digest TEXT NOT NULL,
  snapshot_ref TEXT,
  superseded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, candidate_sha, tree_digest)
) STRICT;

CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  requirements_digest TEXT NOT NULL,
  head_sha TEXT,
  snapshot_ref TEXT,
  snapshot_digest TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, seq)
) STRICT;

CREATE TABLE reviews (
  review_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  kind TEXT NOT NULL CHECK (kind IN ('independent_review','security_review')),
  round INTEGER NOT NULL,
  execution_id TEXT NOT NULL REFERENCES executions(execution_id),
  context_id TEXT NOT NULL,
  candidate_sha TEXT NOT NULL,
  tree_digest TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','submitted','verified_pass','verified_fail','invalidated')),
  snapshot_digest TEXT,
  readonly_verified INTEGER NOT NULL DEFAULT 0,
  post_tree_digest TEXT,
  evidence_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, kind, round)
) STRICT;
CREATE TABLE findings (
  finding_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(review_id),
  task_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  mandatory INTEGER NOT NULL,
  path TEXT NOT NULL,
  evidence TEXT NOT NULL,
  reproduction TEXT NOT NULL,
  remediation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','remediated','accepted_optional','carried','confirmed')),
  PRIMARY KEY (review_id, finding_id)
) STRICT;

CREATE TABLE test_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  candidate_sha TEXT NOT NULL,
  tree_digest TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  results_json TEXT NOT NULL,
  passed INTEGER NOT NULL,
  failure_fingerprint TEXT,
  evidence_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  evidence_type TEXT NOT NULL,
  issuer_identity TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  idempotency_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  candidate_sha TEXT,
  tree_digest TEXT,
  policy_revision TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  consumed_at INTEGER,
  consumed_by TEXT
) STRICT;
CREATE INDEX evidence_task ON evidence(task_id, evidence_type);
CREATE TABLE evidence_nonces (nonce TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, seen_at INTEGER NOT NULL) STRICT;
CREATE TRIGGER evidence_envelope_immutable BEFORE UPDATE OF envelope_json, payload_digest, nonce, evidence_type, task_id ON evidence BEGIN SELECT RAISE(ABORT, 'LEDGER.EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;

CREATE TABLE retry_budgets (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  stage TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  next_eligible_at INTEGER NOT NULL,
  exhausted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, stage, fingerprint)
) STRICT;
CREATE TABLE waits (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  since INTEGER NOT NULL,
  eligible_at INTEGER,
  detail_json TEXT NOT NULL
) STRICT;
CREATE TABLE recovery_history (
  recovery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE TABLE resources (
  resource_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  kind TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  registered_at INTEGER NOT NULL
) STRICT;
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  depends_on TEXT NOT NULL REFERENCES tasks(task_id),
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
) STRICT;

-- Durable intent for effects the database cannot commit atomically (a remote GitHub call, a publish). 'uncertain' MUST be reconciled before any retry.
CREATE TABLE action_intents (
  intent_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  params_digest TEXT NOT NULL,
  candidate_sha TEXT,
  policy_revision TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('intended','dispatched','succeeded','failed','uncertain','reconciled_succeeded','reconciled_absent')),
  outcome_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('completion','genuine_blocker','handoff_ready','production_incident')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
`

export const MIGRATIONS = Object.freeze([{ version: 1, sql: V1 }])
