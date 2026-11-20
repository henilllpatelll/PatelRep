# H7 risk model: effect-based classification (Engineering, Housekeeping)

Status: Phase 1, reviewed design input. Classification is by **effect** (what changes in the world and who bears it),
not by the agent or the model. It feeds the risk floor used by manifest v2 validation
([h7-authorization-contract.md](h7-authorization-contract.md) §3). A tool may be classified higher than its floor,
never lower.

Decision values: **L1** observe only (no write) · **L3 eligible** (may be granted bounded autonomy) · **L2 required**
(per-action human approval) · **prohibited** (no agent may perform it in H7, at any level).

## 1. Matrix

| Effect category | Examples | Consequence | Risk floor | H7 decision | Why |
|---|---|---|---|---|---|
| Read-only operational observation | WO lookup, room status, readiness, candidates | operational | low | **L1** | no side effect; already level 1 |
| Internal advisory flag | closed-enum flag on a WO/room visible to staff ("possible duplicate", "parts likely needed", "SLA at risk") | operational | low | **L3 eligible** | internal, additive, reversible, no person or guest affected |
| Internal exception / review record | "status conflict needs supervisor review" record for a room or WO | operational | low | **L3 eligible** | creates work for a human to decide; changes no operational state |
| Engineering WO assignment / reassignment | `engineering.work_orders.assign` v2 | operational (directs a person's work) | medium | **L2 required** | allocates a person's time; existing reviewed tool |
| Housekeeping room assignment / reassignment | `housekeeping.room_assignments.assign` v1 | personnel | high | **L2 required** | workload allocation; personnel consequence → never level 3 |
| WO priority change | raise/lower priority | operational | medium | **L2 required** | reorders human work; can hide urgent issues |
| WO due date change | move SLA/due date | operational | medium | **L2 required** | can mask breaches |
| WO status change | open → in progress → closed | operational | medium | **L2 required** | closing hides unresolved defects |
| HK clean / inspect / ready transitions | dirty → clean, inspected, released ready | guest-facing (ready releases a room for sale/check-in) | high | **L2 required** (clean/in-progress) · **prohibited** (inspection pass, release ready) | inspection is a human quality decision; "ready" puts a guest in the room |
| Guest communication | SMS, messages, notes to guests | guest-facing | high | **prohibited** | external, irreversible, reputational |
| PMS modifications | Opera room status, reservations, folios | guest-facing / financial | critical | **prohibited** | external system of record; two-way sync deferred |
| Financial, payroll, billing | credits, adjustments, pay, Stripe | financial | critical | **prohibited** | human authority by policy (`HUMAN_AUTHORITY_CONSEQUENCES`) |
| Security and emergency decisions | lockouts, fire/life-safety, access control, incident response | safety | critical | **prohibited** | human only, always |
| Staff messaging / nudges | push to an assignee | personnel-adjacent | medium | **L2 required** in H7 | needs the durable outbox (threat-model-h7.md C) and rate design first |

## 2. Rules that hold everywhere

* Consequence `financial`, `personnel`, `safety` or `guest_facing` ⇒ never L3 (enforced already by
  `autonomy.py:requires_human_authority` for writes; manifest v2 keeps it).
* Any external system effect (PMS, SMS, email, Stripe, push) ⇒ not L3 in H7.
* Any effect that removes or overrides a human's decision (unassign, close, reprioritise) ⇒ not L3.
* L3 tools take closed-enum/id arguments only; no free text reaches the write.

## 3. Candidate low-risk operations (not implemented in Phase 1)

1. **`engineering.work_orders.advisory_flag` v1** — add one closed-enum advisory flag to a work order in the agent's
   hotel (e.g. `possible_duplicate`, `parts_likely_needed`, `sla_at_risk`). Additive, deduplicated per (WO, flag),
   reversible by any engineer/chief, does not change status, priority, assignee, due date or notify anyone.
   Quota: small per hour/day. Primary candidate for shadow mode.
2. **`housekeeping.rooms.review_exception` v1** — open one internal review record for a supervisor when room facts
   conflict (e.g. status vs. occupancy discrepancy already detected by the existing read tools). Changes no room
   status, assignment or PMS value; deduplicated per (room, day, reason).

Both need: a new domain table or column set (reviewed migration), a shared domain function used by any human route,
a DB autonomy spec entry with digests, and the Phase 5 enforcement RPC. Neither may ship before Phases 2–3.
