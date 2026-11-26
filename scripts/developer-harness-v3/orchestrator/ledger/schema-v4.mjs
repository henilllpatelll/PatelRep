// Developer Harness V3 (D3.6) — ledger schema V4 (split out of schema.mjs to keep files under 500 lines; imported by schema.mjs).
// V4 (D3.6 delivery: publication, exact-candidate CI, staging, delivery eligibility). ADDITIVE ONLY: V1-V3 above are byte-for-byte unchanged (a test pins their digests).
// Nothing here makes a remote effect possible: every delivery action stays inactive in the authoritative policy. These tables record what the SIMULATED delivery path needs durably.
export const V4 = `
-- an intent records WHEN it was dispatched (an 'absent' reconciliation must be read after it) and WHICH cited evidence it consumed (NULL = the D3.4 rule: every cited id was consumed)
ALTER TABLE action_intents ADD COLUMN dispatched_at INTEGER;
ALTER TABLE action_intents ADD COLUMN consumed_ids_json TEXT;
-- the digest of the evaluator REQUEST authorized at creation: every re-authorization (dispatch, retry) must evaluate the byte-identical request
ALTER TABLE action_intents ADD COLUMN authorized_request_digest TEXT;
-- the exact effect parameters (bounded, canonical) so a trusted reader derives WHAT to look up from the recorded intent, never from the requester; params_digest stays the binding
ALTER TABLE action_intents ADD COLUMN params_json TEXT;
-- authenticated remote observations accepted for reconciliation (verified signatures only; append-only; one row per signed observation id)
CREATE TABLE remote_observations (
  observation_id TEXT PRIMARY KEY,
  intent_id TEXT REFERENCES action_intents(intent_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  subject TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('present','absent','conflict','rejected')),
  read_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  remote_version TEXT,
  digest TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE INDEX remote_observations_intent ON remote_observations(intent_id, observed_at);
CREATE TRIGGER remote_observations_append_only_u BEFORE UPDATE ON remote_observations BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
CREATE TRIGGER remote_observations_append_only_d BEFORE DELETE ON remote_observations BEGIN SELECT RAISE(ABORT, 'LEDGER.APPEND_ONLY'); END;
-- one delivery record per task: the task-owned branch, the PR it owns, and the CURRENT delivery base (generation 0 = the submitted base; a base update is generation n+1)
CREATE TABLE deliveries (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  branch TEXT NOT NULL UNIQUE,
  pr_number INTEGER UNIQUE,
  base_sha TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER deliveries_branch_immutable BEFORE UPDATE OF branch, task_id ON deliveries BEGIN SELECT RAISE(ABORT, 'LEDGER.DELIVERY_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER deliveries_pr_set_once BEFORE UPDATE OF pr_number ON deliveries WHEN OLD.pr_number IS NOT NULL AND NEW.pr_number IS NOT OLD.pr_number BEGIN SELECT RAISE(ABORT, 'LEDGER.DELIVERY_PR_IMMUTABLE'); END;
CREATE TRIGGER deliveries_generation_monotonic BEFORE UPDATE OF generation ON deliveries WHEN NEW.generation < OLD.generation BEGIN SELECT RAISE(ABORT, 'LEDGER.DELIVERY_GENERATION_MONOTONIC'); END;
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
-- explicit delivery milestones, each bound to the exact candidate it was reached for; invalidated (never deleted) when that candidate stops being current
CREATE TABLE delivery_milestones (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  milestone TEXT NOT NULL CHECK (milestone IN ('built','locally_verified','published','ci_verified','staging_verified','merge_eligible','merged')),
  candidate_sha TEXT NOT NULL,
  tree_digest TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  evidence_ref TEXT,
  reached_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  PRIMARY KEY (task_id, milestone, candidate_sha)
) STRICT;
CREATE TRIGGER delivery_milestones_no_delete BEFORE DELETE ON delivery_milestones BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
CREATE TRIGGER delivery_milestones_identity BEFORE UPDATE OF task_id, milestone, candidate_sha, tree_digest, base_sha, reached_at ON delivery_milestones BEGIN SELECT RAISE(ABORT, 'LEDGER.MILESTONE_IMMUTABLE'); END;
CREATE TRIGGER delivery_milestones_no_merged BEFORE INSERT ON delivery_milestones WHEN NEW.milestone = 'merged' BEGIN SELECT RAISE(ABORT, 'LEDGER.MERGED_REQUIRES_D37_MERGE_EVIDENCE'); END;
-- what a dependency REQUIRES of its upstream: 'locally_verified' (the D3.4/D3.5 ordering boundary; the dependent's worktree does NOT contain the upstream code) or 'merged' (code dependency: waits for D3.7 merge evidence)
ALTER TABLE task_dependencies ADD COLUMN requires TEXT NOT NULL DEFAULT 'locally_verified' CHECK (requires IN ('locally_verified','merged'));
-- the ONE shared staging environment: at most one V3 task owns V3-initiated staging work at a time; an unresolved owner keeps it (never released by a timeout)
CREATE TABLE staging_reservations (
  reservation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'shared_staging'),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  candidate_sha TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held','unresolved','released')),
  acquired_at INTEGER NOT NULL,
  released_at INTEGER,
  release_basis TEXT
) STRICT;
CREATE UNIQUE INDEX one_staging_owner ON staging_reservations(kind) WHERE state IN ('held','unresolved');
CREATE TRIGGER staging_reservations_final BEFORE UPDATE OF state ON staging_reservations WHEN OLD.state = 'released' BEGIN SELECT RAISE(ABORT, 'LEDGER.RESERVATION_RELEASED'); END;
CREATE TRIGGER staging_reservations_no_delete BEFORE DELETE ON staging_reservations BEGIN SELECT RAISE(ABORT, 'LEDGER.NO_DELETE'); END;
-- deterministic polling: persisted next wake-up per (task, subject); survives restarts so a controller never busy-polls or forgets a wait
CREATE TABLE delivery_polls (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  subject TEXT NOT NULL,
  next_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_code TEXT,
  PRIMARY KEY (task_id, subject)
) STRICT;
-- CI/staging failure diagnostics: one row per (candidate, run, job, attempt); the fingerprint, never the log
CREATE TABLE delivery_diagnostics (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  candidate_sha TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ci','staging')),
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  job TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('transient','genuine','protected_control_plane','unknown')),
  excerpt_digest TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, candidate_sha, source, run_id, attempt, job)
) STRICT;
-- watchdog: every supervised operation has a deadline; a timed-out operation that is still in flight stays 'unresolved' and keeps what it holds
CREATE TABLE operation_deadlines (
  op_id TEXT PRIMARY KEY,
  task_id TEXT,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','settled','unresolved','settled_late')),
  holds_json TEXT NOT NULL DEFAULT '[]',
  settled_at INTEGER
) STRICT;
CREATE INDEX operation_deadlines_state ON operation_deadlines(state, deadline_at);
CREATE TRIGGER al_observation AFTER INSERT ON remote_observations BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('remote_observation', NEW.observation_id, NEW.recorded_at); END;
CREATE TRIGGER al_milestone AFTER INSERT ON delivery_milestones BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('milestone_' || NEW.milestone, NEW.task_id || ':' || NEW.candidate_sha, NEW.reached_at); END;
CREATE TRIGGER al_milestone_invalidated AFTER UPDATE OF invalidated_at ON delivery_milestones WHEN NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('milestone_invalidated', NEW.task_id || ':' || NEW.milestone, NEW.invalidated_at); END;
CREATE TRIGGER al_staging AFTER UPDATE OF state ON staging_reservations WHEN NEW.state <> OLD.state BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('staging_' || NEW.state, NEW.reservation_id, COALESCE(NEW.released_at, NEW.acquired_at)); END;
CREATE TRIGGER al_staging_acquired AFTER INSERT ON staging_reservations BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('staging_held', NEW.reservation_id, NEW.acquired_at); END;
CREATE TRIGGER al_delivery_base AFTER UPDATE OF generation ON deliveries WHEN NEW.generation <> OLD.generation BEGIN INSERT INTO authority_log(kind,ref,at) VALUES ('delivery_base', NEW.task_id || ':' || NEW.generation, NEW.updated_at); END;
-- delivery status and genuine delivery blockers go through the same durable outbox (D3.8 connects it to Telegram/dashboard): widen the CHECK by rebuild, exactly as V2 did; rows kept
CREATE TABLE outbox_v4 (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('completion','genuine_blocker','handoff_ready','production_incident','technical_suspension','delivery_status')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
INSERT INTO outbox_v4 SELECT * FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_v4 RENAME TO outbox;
INSERT INTO authority_log(kind,ref,at) VALUES ('schema_v4_baseline', 'migration', 0);
`

