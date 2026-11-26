# Developer Harness V3 — 26 D3.5 ledger backup, integrity and disaster recovery

Status: **implemented, tested on real SQLite files; automatic replacement is SIMULATION-ONLY.** Gate **G-LEDGER-FRESHNESS-WITNESS** stays open: outside simulation every restore candidate is QUARANTINED by design.

## Why a matching digest is not enough
A backup is internally consistent but may be OLD. Restoring an old ledger would roll back: consumed evidence and seen nonces (replay), fencing tokens (stale workers regain authority), action intents and completed effects (a repeat publish), cancellations, owner decisions, policy revisions and resource ownership. Schema V3 therefore maintains an **authority sequence** in the database itself: `authority_log` gets a row for every evidence acceptance/consumption/invalidation, nonce, intent creation and status change, fencing advance, cancellation change, policy revision, owner decision, lease issue, resource registration and verified cleanup (14 triggers; no code path can forget it).

## Design (`orchestrator/ledger/disaster-recovery.mjs`, on top of `backup.mjs`)
1. **Backup**: storage admission (2 × ledger size + 2 GB free) → `VACUUM INTO` a temp file → integrity, identity and sequence verified → digest → rename → atomic **manifest** (`ledger_id`, schema version, authority sequence, sha256, bytes) — the commit point. A data file without a manifest is a partial publication: ignored and collected. Retention keeps the newest N (≥ 1), manifest removed before data.
2. **Verification before restore**: digest, `quick_check`, application id, schema compatibility (1..3), and the identity/sequence INSIDE the file equal the manifest (a manifest claiming a newer sequence is refused).
3. **Freshness decision**: automatic replacement requires an independently trusted witness of the same ledger whose sequence the backup EQUALS. Behind → `RESTORE.STALE_BACKUP`; witness behind → `RESTORE.WITNESS_BEHIND`; untrusted or missing → `RESTORE.FRESHNESS_UNPROVEN`. The only witness implemented (`fileWitness`) is controller-written and reports `trusted:false`; tests construct an explicitly SIMULATED trusted witness.
4. **Controller exclusion**: recovery takes the controller lock; a live controller → `RESTORE.CONTROLLER_ACTIVE`; a healthy live ledger is never replaced.
5. **Candidate** in a separate directory; a quarantined candidate gets a `.QUARANTINED.json` with the reason and the owner step.
6. **Journaled swap**: `begin` → corrupt live ledger (+WAL/SHM) moved to the quarantine directory (preserved for diagnostics) → candidate renamed into place → **seal** → journal removed. Every step is re-derived from the files on restart (tested with a crash after each step).
7. **Seal** (one transaction, idempotent): every `intended`/`dispatched` intent becomes `uncertain` (only an authenticated reconciliation — G-INTENT-EVALUATOR — can settle it; `markDispatched` is refused), every unconsumed approval is withdrawn, live leases and work slots become termination-unverified, every open task's fencing token advances.
8. **Rollback guard** `checkNotRolledBack`: a ledger whose sequence is behind a trusted witness refuses to run (`LEDGER.ROLLBACK_DETECTED`).

## Tested (`d35-disaster-recovery.test.mjs`)
Partial publication, retention, storage admission, corrupt data, missing data, forged manifest, incompatible schema; a STALE backup after authority moved on (with the newest backup corrupt) → quarantined, live file untouched; no independent witness → quarantined; controller conflict; fresh restore interrupted after each swap step → completed once; after restore: the old intent cannot be dispatched, old envelopes cannot be replayed (nonce), approvals withdrawn, fencing advanced, no active lease.

## What remains
The independent witness (issuer-signed sequence checkpoints held outside the controller account, or a remote record) — G-LEDGER-FRESHNESS-WITNESS. Until then the owner decides about a quarantined candidate.
