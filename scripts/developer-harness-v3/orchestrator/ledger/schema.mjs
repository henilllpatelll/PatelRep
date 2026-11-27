// Developer Harness V3 (D3.4) — durable execution ledger schema (SQLite via node:sqlite, built in; no extra service or dependency).
//
// Append-only where history matters (task_events), immutable where identity matters (task requirements), and constrained by the database itself
// (UNIQUE / partial UNIQUE / CHECK / triggers) so that a buggy or racing caller cannot violate an invariant the reducer already pins:
//   * one active reasoning lease at a time (partial unique index),
//   * one acceptance of a nonce and one consumption of an evidence id,
//   * one action intent per idempotency key,
//   * original requirements are immutable and digest-bound.
// Migrations are explicit, ordered and each runs in its own transaction; a database newer than this code is refused (never downgraded).
import { V4 } from './schema-v4.mjs'

export const SCHEMA_VERSION = 4
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
  status TEXT NOT NULL CHECK (status IN ('open','remediated','accepted_optional')),
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


// V2 (D3.4 remediation F3-F6). Nothing here removes or weakens a V1 constraint. The outbox and findings tables are rebuilt ONLY to WIDEN a CHECK (SQLite cannot alter a CHECK in place); V1 above is unchanged since it was first released.
const V2 = `
-- F3: an intent is bound to the candidate TREE, the creating lease and (when re-authorized) the intent it supersedes.
ALTER TABLE action_intents ADD COLUMN tree_digest TEXT;
ALTER TABLE action_intents ADD COLUMN lease_id TEXT;
ALTER TABLE action_intents ADD COLUMN superseded_by TEXT;
ALTER TABLE action_intents ADD COLUMN supersedes TEXT;

-- F5: a technical (non-owner) suspension: the task keeps its lifecycle state, is not scheduled until retry_at (cooling_down) or ever again by itself (terminal).
CREATE TABLE suspensions (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  epoch INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('cooling_down','terminal')),
  cause TEXT NOT NULL,
  stage TEXT,
  since INTEGER NOT NULL,
  retry_at INTEGER,
  diagnostics_json TEXT NOT NULL,
  CHECK ((disposition = 'cooling_down' AND retry_at IS NOT NULL) OR (disposition = 'terminal' AND retry_at IS NULL))
) STRICT;

-- F6: a finished reviewer deliverable, durable BEFORE its session is torn down. It is UNTRUSTED until the controller has verified termination, candidate binding, context independence and the read-only proof.
CREATE TABLE review_deliverables (
  review_id TEXT PRIMARY KEY REFERENCES reviews(review_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  candidate_sha TEXT NOT NULL,
  tree_digest TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  deliverable_json TEXT NOT NULL,
  persisted_at INTEGER NOT NULL
) STRICT;

-- F4: what an INDEPENDENT reviewer found about each plan step and each acceptance criterion for one candidate.
CREATE TABLE coverage (
  review_id TEXT NOT NULL REFERENCES reviews(review_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  candidate_sha TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('step','criterion')),
  subject_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('satisfied','unsatisfied','unknown')),
  evidence TEXT NOT NULL,
  PRIMARY KEY (review_id, subject_type, subject_ref)
) STRICT;
CREATE INDEX coverage_task ON coverage(task_id, candidate_sha);

-- the findings lifecycle needs carried and confirmed (an independent re-review confirms an earlier finding fixed): widen the CHECK by rebuild, V1 stays untouched
CREATE TABLE findings_v2 (
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
INSERT INTO findings_v2 SELECT * FROM findings;
DROP TABLE findings;
ALTER TABLE findings_v2 RENAME TO findings;
-- at most ONE effect in flight per task and action: a second dispatch of the same effect is a database error, not a convention
CREATE UNIQUE INDEX one_inflight_effect ON action_intents(task_id, action) WHERE status IN ('dispatched','uncertain');

CREATE TABLE outbox_v2 (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('completion','genuine_blocker','handoff_ready','production_incident','technical_suspension')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
INSERT INTO outbox_v2 SELECT * FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_v2 RENAME TO outbox;
`

// V3 (D3.5 self-healing recovery and resource-aware parallel development). ADDITIVE ONLY: V1 and V2 above are byte-for-byte unchanged (a test pins their digests) and no V1/V2
// constraint is removed. In particular the V1 partial unique index `one_reasoning_slot` stays: `leases.reasoning_slot` is now the SLOT NUMBER (1..capacity), so the same index means
// exactly "one live lease per slot", and with the default capacity of 1 it is the old global single slot. V3 adds per-task exclusivity, slot capacity, heavy-test work slots,
// durable resource reservations, per-task workspaces, scope claims, resumable test units, bounded recovery, quarantine, ownership identity, cleanup intents and a database-maintained
// authority high-water mark (authority_log) that backups and restores are judged against.
const V3 = `
CREATE TABLE slot_config (
  kind TEXT PRIMARY KEY CHECK (kind IN ('reasoning','heavy_test')),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 8),
  basis TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO slot_config(kind,capacity,basis,updated_at) VALUES ('reasoning',1,'task-lifecycle.json concurrency.max_reasoning_sessions = 1',0), ('heavy_test',1,'D3.3 max_heavy_test_workloads = 1',0);
CREATE TRIGGER slot_config_no_delete BEFORE DELETE ON slot_config BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
CREATE TRIGGER slot_config_no_insert BEFORE INSERT ON slot_config BEGIN SELECT RAISE(ABORT, 'LEDGER.SLOT_KIND_FIXED'); END;
-- a capacity can never shrink underneath a live lease (the lease would otherwise sit in a slot that no longer exists)
CREATE TRIGGER slot_config_no_shrink_r BEFORE UPDATE OF capacity ON slot_config WHEN NEW.kind = 'reasoning' AND EXISTS (SELECT 1 FROM leases WHERE state IN ('active','termination_unverified') AND reasoning_slot > NEW.capacity)
BEGIN SELECT RAISE(ABORT, 'LEDGER.SLOT_IN_USE'); END;

-- one live reasoning lease per TASK (in addition to one per slot): a task can never run two reasoning executions at once
CREATE UNIQUE INDEX one_live_lease_per_task ON leases(task_id) WHERE state IN ('active','termination_unverified');
CREATE TRIGGER leases_slot_in_range BEFORE INSERT ON leases WHEN NEW.reasoning_slot < 1 OR NEW.reasoning_slot > (SELECT capacity FROM slot_config WHERE kind = 'reasoning')
BEGIN SELECT RAISE(ABORT, 'LEDGER.SLOT_OUT_OF_RANGE'); END;
CREATE TRIGGER leases_identity_immutable BEFORE UPDATE OF lease_id, task_id, execution_id, fencing_token, reasoning_slot, issued_at ON leases BEGIN SELECT RAISE(ABORT, 'LEDGER.LEASE_IDENTITY_IMMUTABLE'); END;
-- a closed lease stays closed, and an unverified termination never becomes active again: the slot is freed only by a verified release or a verified supersession
CREATE TRIGGER leases_no_resurrection BEFORE UPDATE OF state ON leases WHEN OLD.state IN ('released','superseded') OR (OLD.state = 'termination_unverified' AND NEW.state = 'active')
BEGIN SELECT RAISE(ABORT, 'LEDGER.LEASE_CLOSED'); END;
CREATE TRIGGER leases_no_delete BEFORE DELETE ON leases BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;

-- deterministic heavy-test work holds a WORK slot (not a reasoning slot); the same per-slot and per-task exclusivity, enforced by the database
CREATE TABLE work_leases (
  work_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  kind TEXT NOT NULL CHECK (kind IN ('heavy_test')),
  slot_no INTEGER NOT NULL CHECK (slot_no >= 1),
  unit_ref TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','released','termination_unverified','superseded')),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER
) STRICT;
CREATE UNIQUE INDEX one_live_work_per_slot ON work_leases(kind, slot_no) WHERE state IN ('active','termination_unverified');
CREATE UNIQUE INDEX one_live_work_per_task ON work_leases(task_id, kind) WHERE state IN ('active','termination_unverified');
CREATE TRIGGER work_slot_in_range BEFORE INSERT ON work_leases WHEN NEW.slot_no > (SELECT capacity FROM slot_config WHERE kind = NEW.kind) BEGIN SELECT RAISE(ABORT, 'LEDGER.SLOT_OUT_OF_RANGE'); END;
CREATE TRIGGER work_identity_immutable BEFORE UPDATE OF work_id, task_id, kind, slot_no, unit_ref, fencing_token, issued_at ON work_leases BEGIN SELECT RAISE(ABORT, 'LEDGER.LEASE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER work_no_resurrection BEFORE UPDATE OF state ON work_leases WHEN OLD.state IN ('released','superseded') OR (OLD.state = 'termination_unverified' AND NEW.state = 'active')
BEGIN SELECT RAISE(ABORT, 'LEDGER.LEASE_CLOSED'); END;
CREATE TRIGGER slot_config_no_shrink_w BEFORE UPDATE OF capacity ON slot_config WHEN EXISTS (SELECT 1 FROM work_leases WHERE kind = NEW.kind AND state IN ('active','termination_unverified') AND slot_no > NEW.capacity)
BEGIN SELECT RAISE(ABORT, 'LEDGER.SLOT_IN_USE'); END;

-- memory/disk promised to a lease or work slot, created IN THE SAME TRANSACTION as the slot and bound to it (holder_ref): no other task can consume it
CREATE TABLE reservations (
  reservation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  holder_ref TEXT NOT NULL UNIQUE,
  profile TEXT NOT NULL CHECK (profile IN ('reasoning','heavy_test')),
  mem_mb INTEGER NOT NULL CHECK (mem_mb BETWEEN 0 AND 65536),
  disk_mb INTEGER NOT NULL CHECK (disk_mb BETWEEN 0 AND 1048576),
  fencing_token INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held','materialized','released')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  released_at INTEGER
) STRICT;
CREATE TRIGGER reservations_identity_immutable BEFORE UPDATE OF reservation_id, task_id, holder_ref, profile, mem_mb, disk_mb, fencing_token, created_at ON reservations BEGIN SELECT RAISE(ABORT, 'LEDGER.RESERVATION_IMMUTABLE'); END;
CREATE TRIGGER reservations_final BEFORE UPDATE OF state ON reservations WHEN OLD.state = 'released' BEGIN SELECT RAISE(ABORT, 'LEDGER.RESERVATION_RELEASED'); END;

-- per-task isolation of mutable workspace: one worktree, one worker overlay, one checkpoint namespace and one candidate namespace per task, never shared, never reassigned
CREATE TABLE task_workspaces (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  worktree_path TEXT NOT NULL UNIQUE,
  overlay_id TEXT NOT NULL UNIQUE,
  checkpoint_ns TEXT NOT NULL UNIQUE,
  candidate_ns TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER task_workspaces_immutable BEFORE UPDATE ON task_workspaces BEGIN SELECT RAISE(ABORT, 'LEDGER.WORKSPACE_IMMUTABLE'); END;
CREATE TRIGGER task_workspaces_no_delete BEFORE DELETE ON task_workspaces BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;

-- the write footprint a task holds while it changes the repository (scheduler serialization of overlapping/unknown footprints)
CREATE TABLE scope_claims (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  footprint_json TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  released_at INTEGER
) STRICT;
CREATE TABLE schedule_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  passes INTEGER NOT NULL DEFAULT 0,
  last_considered_at INTEGER,
  last_admitted_at INTEGER
) STRICT;

-- resumable, unit-granular test runs: a unit that passed is FINAL for its group (never repeated, never overwritten)
CREATE TABLE test_units (
  group_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(task_id),
  ordinal INTEGER NOT NULL,
  candidate_sha TEXT,
  tree_digest TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','passed','failed','interrupted_resource','interrupted_ambiguous')),
  attempts INTEGER NOT NULL DEFAULT 0,
  interruptions INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, unit_id)
) STRICT;
CREATE TRIGGER test_units_passed_final BEFORE UPDATE ON test_units WHEN OLD.status = 'passed' BEGIN SELECT RAISE(ABORT, 'LEDGER.UNIT_FINAL'); END;
CREATE TRIGGER test_units_no_delete BEFORE DELETE ON test_units BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
CREATE TABLE resource_samples (
  sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  context TEXT NOT NULL,
  sample_json TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;

-- bounded, persisted recovery: attempts, back-off and a circuit breaker per (scope, incident) survive restarts, so a restart loop cannot become a recovery storm
CREATE TABLE recovery_attempts (
  scope TEXT NOT NULL,
  incident TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  circuit TEXT NOT NULL CHECK (circuit IN ('closed','open')),
  last_code TEXT,
  PRIMARY KEY (scope, incident)
) STRICT;
CREATE TABLE quarantine (
  quarantine_id TEXT PRIMARY KEY,
  task_id TEXT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER quarantine_append_only_u BEFORE UPDATE ON quarantine BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
CREATE TRIGGER quarantine_append_only_d BEFORE DELETE ON quarantine BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;

-- ownership identity: who created a resource, under which execution and token, its canonical path or process identity (pid + creation time, never a name), and whether it is protected
ALTER TABLE resources ADD COLUMN execution_id TEXT;
ALTER TABLE resources ADD COLUMN fencing_token INTEGER;
ALTER TABLE resources ADD COLUMN canonical_ref TEXT;
ALTER TABLE resources ADD COLUMN process_identity_json TEXT;
ALTER TABLE resources ADD COLUMN creation_id TEXT;
ALTER TABLE resources ADD COLUMN protected_class TEXT;
ALTER TABLE resources ADD COLUMN termination_verified INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX resources_creation_unique ON resources(creation_id) WHERE creation_id IS NOT NULL;
CREATE TRIGGER resources_identity_immutable BEFORE UPDATE OF resource_id, task_id, kind, execution_id, fencing_token, canonical_ref, process_identity_json, creation_id, protected_class ON resources WHEN OLD.creation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'LEDGER.RESOURCE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER resources_no_delete BEFORE DELETE ON resources BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
CREATE TABLE cleanup_intents (
  intent_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  resource_id TEXT NOT NULL REFERENCES resources(resource_id),
  plan_digest TEXT NOT NULL,
  dry_run INTEGER NOT NULL CHECK (dry_run IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('planned','executing','verified','failed','unknown','refused')),
  outcome_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_live_cleanup_per_resource ON cleanup_intents(resource_id) WHERE status IN ('planned','executing','unknown') AND dry_run = 0;

-- the authority high-water mark: every authority-relevant mutation appends here, maintained BY THE DATABASE so no code path can forget it. A backup records MAX(seq);
-- a restore is judged against an independent witness of it (a backup is never "current" merely because its digest matches).
CREATE TABLE authority_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER authority_log_append_only_u BEFORE UPDATE ON authority_log BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
CREATE TRIGGER authority_log_append_only_d BEFORE DELETE ON authority_log BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
CREATE TRIGGER al_evidence_accepted AFTER INSERT ON evidence BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('evidence_accepted', NEW.evidence_id, NEW.accepted_at); END;
CREATE TRIGGER al_evidence_consumed AFTER UPDATE OF consumed_at ON evidence WHEN NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('evidence_consumed', NEW.evidence_id, NEW.consumed_at); END;
CREATE TRIGGER al_evidence_invalidated AFTER UPDATE OF invalidated_at ON evidence WHEN NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('evidence_invalidated', NEW.evidence_id, NEW.invalidated_at); END;
CREATE TRIGGER al_nonce AFTER INSERT ON evidence_nonces BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('nonce_seen', NEW.nonce, NEW.seen_at); END;
CREATE TRIGGER al_intent_created AFTER INSERT ON action_intents BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('intent_created', NEW.intent_id, NEW.created_at); END;
CREATE TRIGGER al_intent_status AFTER UPDATE OF status ON action_intents WHEN NEW.status <> OLD.status BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('intent_' || NEW.status, NEW.intent_id, NEW.updated_at); END;
CREATE TRIGGER al_fencing AFTER UPDATE OF fencing_token ON tasks WHEN NEW.fencing_token <> OLD.fencing_token BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('fencing_advanced', NEW.task_id || ':' || NEW.fencing_token, NEW.updated_at); END;
CREATE TRIGGER al_cancel AFTER UPDATE OF cancelled ON tasks WHEN NEW.cancelled <> OLD.cancelled BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('cancellation', NEW.task_id || ':' || NEW.cancelled, NEW.updated_at); END;
CREATE TRIGGER al_policy AFTER UPDATE OF policy_revision ON tasks WHEN NEW.policy_revision IS NOT OLD.policy_revision BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('policy_revision', NEW.task_id, NEW.updated_at); END;
CREATE TRIGGER al_owner_decision AFTER INSERT ON task_events WHEN json_extract(NEW.event_json, '$.owner_action_id') IS NOT NULL BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('owner_decision', NEW.task_id || ':' || NEW.seq, NEW.at); END;
CREATE TRIGGER al_lease_issued AFTER INSERT ON leases BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('lease_issued', NEW.lease_id, NEW.issued_at); END;
CREATE TRIGGER al_resource AFTER INSERT ON resources BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('resource_registered', NEW.resource_id, NEW.registered_at); END;
CREATE TRIGGER al_cleanup AFTER UPDATE OF status ON cleanup_intents WHEN NEW.status <> OLD.status AND NEW.dry_run = 0 BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('cleanup_' || NEW.status, NEW.intent_id, NEW.updated_at); END;
INSERT INTO authority_log(kind,ref,at) VALUES ('schema_v3_baseline', 'migration', 0);
`

export const MIGRATIONS = Object.freeze([{ version: 1, sql: V1 }, { version: 2, sql: V2 }, { version: 3, sql: V3 }, { version: 4, sql: V4 }])
