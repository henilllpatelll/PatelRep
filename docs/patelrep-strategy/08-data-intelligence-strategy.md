# 08 — Data Intelligence Strategy

> **Status:** The responsibilities of Data Intelligence, the data-use boundaries and the infrastructure stance are
> founder-approved ([FD-29, FD-41](15-strategic-decision-register.md#1-founder-approved-decisions)). The provenance
> envelope, quality model, benchmarking model and milestones are **proposed** (PA-08, PA-15).
> **Baseline:** `origin/main` @ `41995dcb` (2026-11-26). **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

## 1. Purpose

PatelRep Data Intelligence turns authorized hotel data into trustworthy answers, measurements and predictions. It
covers ingestion, normalization, operational history, knowledge retrieval, provenance, data quality, analytics,
predictive modeling, benchmarking and evidence-based improvement. Its value depends entirely on trust: a wrong number
delivered confidently costs more time than it saves.

## 2. Principles

1. **Customer data access does not imply ownership** or unrestricted secondary use (FD-29).
2. **No automatic model training** on customer information and **no cross-customer benchmarking** without explicit,
   documented authorization (§7).
3. **Provenance on everything derived.** A number can always be traced to the records and method behind it.
4. **Quality before intelligence.** Quality and freshness checks gate analytics and predictions through readiness
   ([07](07-adaptive-intelligence.md)).
5. **Existing infrastructure until scale justifies more.** Supabase Postgres, pgvector and pgmq stay the default;
   additions follow measured triggers ([04 §8](04-platform-architecture.md#8-scale-triggers-when-to-add-infrastructure)).
6. **Deterministic where possible.** Rules and validated statistics are preferred to models when they are as good.

## 3. Data domains and sources

| Domain | Native sources today | External sources (through Connect) |
|---|---|---|
| Operational events | Room status history, clean sessions, inspections, work orders and events, tasks, logbook, guest requests | PMS room status |
| Workforce | Schedules, availability, time off, coverage, housekeeping shift sessions | Payroll, timekeeping, HR |
| Guest interactions | Guest requests, staff-entered satisfaction score, staff-initiated SMS | Guest messaging, reviews, CRM |
| Reservations and occupancy | Arrivals for today and tomorrow (OPERA pilot), SFTP and PDF imports | PMS, revenue systems |
| Assets and maintenance | Assets, meters, PM schedules, downtime, spare parts | External CMMS or building systems |
| Financial | Configured ADR only | Accounting, payroll, PMS revenue |
| Knowledge | Approved SOP documents and chunks | Authorized documents |
| AI usage | `ai_interactions` metadata (no message text), credit ledger, harness spend ledgers | — |

## 4. Provenance and quality (proposed, PA-08)

Every derived fact carries a small envelope:

| Field | Meaning |
|---|---|
| `source` | System and table or Connect capability |
| `as_of` / `ingested_at` | When the fact was true and when PatelRep learned it |
| `method` | Measured, derived by a named rule, estimated or predicted (and model version) |
| `inputs` | References to the records used |
| `quality` | Completeness, validity and freshness flags |

Quality dimensions are completeness, freshness, validity, consistency and uniqueness. Their results feed readiness:
a stale feed makes dependent capabilities `stale`, not silently wrong.

Known data-quality issues at the baseline, recorded so that they are fixed rather than built upon:

* OPERA SFTP report times are stored as UTC without hotel-timezone conversion.
* `housekeeper_profiles` is described as a moving average in the schema but maintained as a cumulative mean.
* `is_ai_created` is also set by non-AI automation, so it cannot attribute work to AI on its own.
* `ai_interactions.credits_charged` stores fewer decimal places than credits are computed with.
* Some registry definitions and their calculators disagree ([CF-27](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)).

## 5. Operational history and knowledge retrieval

* **History.** Status and lifecycle tables are the backbone of measurement ([09](09-performance-and-impact-engine.md)).
  Several event tables are already append-only by trigger (for example guest messages and AI recommendation events,
  migrations 072 and 073); `room_status_history` is written by the API without an immutability trigger and keeps no
  daily snapshots, so past-day status cannot always be rebuilt.
* **Knowledge.** SOP retrieval uses pgvector (`sop_chunks`, 1536-dimension embeddings with an IVFFlat index) through
  `match_sop_chunks` (parameter `match_hotel_id`), returning approved procedures with citations. Expanding to other
  authorized documents keeps three rules: approved content only, access rules applied before retrieval, citations
  always ([06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep)).

## 6. Analytics and predictive modeling

| Capability | How it works today | Strategy note |
|---|---|---|
| Room-readiness predictions | Rule-based heuristic every 30 minutes for rooms with a check-in within 12 hours | Effectively needs PMS check-in times; readiness should show `unavailable` without them |
| Asset failure predictions | Nightly, one model call per active asset for every hotel with active assets, with a rule-based fallback | Needs metering, a flag and accuracy tracking (CF-23) |
| Cleaning-time estimates | Hotel-level median with shrinkage, kept only if it beats the baseline on a chronological hold-out | The validation pattern every prediction should follow |
| Smart Balance | Deterministic CP-SAT optimization over verified facts | Optimization, not prediction; employee protection rules apply ([10](10-employee-protection-policy.md)) |
| Labor forecast (Management ROI) | Weekday trailing averages over four weeks | Must be labeled an estimate; reconcile with the staffing forecast (CF-19) |
| Staffing forecast | Same-day demand versus scheduled capacity, labeled verified / estimate / unavailable | Future days `unknown` until a reliable reservation feed exists |

Rules for every prediction: a stated baseline it must beat on held-out data; a model or rule version; accuracy and
calibration tracked over time; a minimum-history readiness gate; and a deterministic fallback.

## 7. Customer data use boundaries

1. **Purpose.** Customer data is used to operate and improve that customer's PatelRep service.
2. **No training by default.** No training or fine-tuning code exists today, and none may be added without an explicit,
   reviewed decision and documented customer authorization. Earlier descriptions of data as an input to "AI model
   training" (the `room_status_history` comments in migration 004) or "AI cold-start" (the 90-day OPERA history pull in
   `services/opera/sync.py`) describe intent, not authorization ([CF-29](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)).
3. **Guest communications stay out of AI** unless explicitly permitted: messages are stored with
   `excluded_from_ai = true` (migration 072), a precedent set when guest messaging was introduced.
4. **Benchmarking only by authorization (PA-15).** Cross-customer comparison requires each participating customer's
   explicit opt-in, aggregation with a minimum cohort size, suppression of small groups, and no re-identification.
   Portfolio reporting across an owner's own properties is not benchmarking; it requires the owner's authorization
   and the portfolio tenancy design (PA-11).
5. **Model providers.** Provider data-handling terms are verified per provider and documented; the harness OpenAI
   adapter already requests no storage.
6. **Employee data** follows [10](10-employee-protection-policy.md); guest data stays minimal ([13 §5](13-security-privacy-and-governance.md#5-privacy-principles)).

## 8. Retention, deletion and export

The current state is summarized in [13 §5](13-security-privacy-and-governance.md#5-privacy-principles): logbook entries
are archived rather than deleted, lost-and-found items are flagged for review, controlled documents carry retention
metadata without purge, several data classes have no retention rule, and no tenant offboarding, erasure or
data-export path was found. The proposed retention catalog (W5-D5) assigns every data class a retention period, a deletion or
anonymization method, legal-hold handling and an owner, and adds tested deletion and export jobs.

## 9. Milestones

Data Intelligence milestones W5-D1 to W5-D5 are defined in the
[master roadmap](03-master-product-roadmap.md#w5--establish-the-data-intelligence-foundation).
