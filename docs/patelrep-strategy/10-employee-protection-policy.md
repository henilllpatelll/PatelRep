# 10 — Employee Protection Policy

> **Status:** The prohibitions in §2 (left column), the duties named in the §3 headings and the requirement of human
> responsibility for sensitive decisions are founder-approved ([FD-35](15-strategic-decision-register.md#1-founder-approved-decisions)).
> Their product interpretations (§2 right column, §3 detail), the analytics rules' specifics, the checklist and the
> review items are **proposed** (PA-19). This policy governs future product work; it does not change code.
> **Baseline:** `origin/main` @ `41995dcb` (2026-11-26). **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

## 1. Purpose

PatelRep exists to give people in hospitality their time back. That promise is broken if the product quietly turns
recovered minutes into more rooms per shift, more pressure, or more surveillance. This policy states what PatelRep
will never do to the people who use it, what it must always do, and how every feature is checked against both.

PatelRep helps hotels with short staffing by removing waste: administrative work, manual coordination, duplicate data
entry, waiting, rework and fragmented information. **It never solves staffing problems by encouraging unsafe
workloads, sacrificing service quality, pressuring employees or concealing genuine staffing shortages** (FD-20).

## 2. Prohibited outcomes

| # | PatelRep must never | In product terms this means |
|---|---|---|
| P1 | Accelerate work unsafely | No targets, timers or nudges that push people past safe working speeds; no "beat your time" prompts |
| P2 | Make unfair or excessively demanding assignments | Assignment logic respects declared workload limits and treats people consistently; supervisors see and can change every proposal |
| P3 | Create unpaid administrative work | Nothing PatelRep requires happens off the clock. Off-shift, only optional offers that need no response and carry no penalty for ignoring them (for example open-shift offers), and escalations to staff designated and paid as on call |
| P4 | Enable intrusive surveillance | No continuous location tracking, covert monitoring, or screen or keystroke capture; no continuous, covert or involuntary audio capture — voice only by push-to-talk for the speaker's own input, with editable transcripts and minimal retention |
| P5 | Make automated disciplinary decisions | No warning, write-up, schedule cut, pay change or termination is decided or triggered by PatelRep |
| P6 | Produce unsupported performance rankings | No leaderboards or composite productivity scores; no other ranking of people without context and adequate samples |
| P7 | Disregard availability, qualifications, approved leave or workload limits | These are inputs the system must honor or surface as conflicts, never silently override |
| P8 | Discourage safety reporting | No metric, incentive or workflow makes reporting a hazard, injury or near miss costly to the reporter |
| P9 | Optimize at the expense of guests or quality | Time "saved" by skipping steps, inspections or service is not a saving and is not counted as Hours Returned |

## 3. Required behaviors

### 3.1 Report genuine staffing shortages

When the work cannot be done safely with the people scheduled, PatelRep says so clearly to the people who can act
(supervisors, managers, owners). It never hides a shortage by spreading the excess across the people on shift.

Precedent: the housekeeping staffing forecast (`apps/api/services/staffing_forecast.py`) labels every number
`verified`, `estimate` or `unavailable`, treats demand as a lower bound when some rooms are unestimated, and can prove
"short" but never claims "sufficient" unless both demand and capacity are known.

### 3.2 Respect workload limits and never invent capacity

Allocation planners enforce known limits and disclose unknown ones. Precedent: Smart Balance
(`apps/api/services/smart_balance.py`) is deterministic, never exceeds a receiver's credit target band or remaining
shift time when those are known, and reports unknown capacity as an assumption instead of inventing it. Its output is
a proposal a supervisor applies.

### 3.3 Honor availability, qualifications and approved leave

Precedent: `apps/api/services/scheduling_availability.py` treats stated availability as evidence (silence is
`unknown`, never "available"), makes approved time off a hard blocker mirrored by a database trigger (migration 227),
and surfaces pending leave as a warning. Coverage fills are revalidated in one database transaction
(`apps/api/services/coverage_fill.py`).

### 3.4 Keep administrative work inside paid time

* Data entry PatelRep asks for is minimized, captured as a by-product of the work where possible (status taps, voice),
  and never required after a shift ends.
* Notifications respect roles, schedules and preferences through the central policy (`apps/api/services/notify.py`);
  a preference only ever suppresses optional push and the operational record is never lost.

### 3.5 Make safety reporting easy and safe

Reporting a hazard, injury or near miss must stay one step away for every role, in the person's language, including
by voice where voice input exists. Report counts are never used as a negative signal about the reporter or their team.

### 3.6 Keep quality and guests in the equation

Optimization is constrained by inspection outcomes, re-clean rates, work-order recurrence and guest outcomes. A change
that saves time while degrading any of them is reported as a trade-off, not as a gain
([09 §4](09-performance-and-impact-engine.md#4-measurement-integrity-rules)).

### 3.7 Keep humans responsible for sensitive decisions

Employment, financial, emergency and safety decisions always have a responsible human:

* In the Customer Agent Harness, `financial`, `personnel` and `safety` consequences can never be unlocked by an
  autonomy level (`HUMAN_AUTHORITY_CONSEQUENCES`, `apps/api/services/agent_harness/vocabulary.py`), housekeeping room
  assignment is classified personnel / high risk and stays human-approved, and security and emergency decisions are
  prohibited for agents ([agent-harness/risk-model-h7.md](../agent-harness/risk-model-h7.md)).
* Outside the harness, the same rule applies to every product feature: PatelRep may prepare, explain and recommend;
  a person decides.

## 4. Measurement and analytics rules

1. **Aggregate first.** Team, department and property metrics are the default view.
2. **Individual data has a legitimate purpose and context.** Where supervisors see per-person data (for example task
   and work-order counts or SLA outcomes), it shows the context that explains it and flags small samples. Precedent:
   `apps/api/services/reporting/team.py` returns `None` instead of `0` for untracked labor, flags `low_sample`, limits
   visibility by department and sorts alphabetically, "never an output-count leaderboard".
3. **No per-person learning for pace.** Precedent: hotel cleaning-time estimates
   (`apps/api/services/cleaning_estimates.py`) are hotel-level, model-free and validated against a baseline, and
   "nothing here reorders rooms, sets deadlines or ranks people".
4. **People can see what is recorded about them** and can correct or contest it through their manager.
5. **No covert capture.** Precedent: housekeeper voice input uses on-device recognition with editable transcripts and
   no audio recorded or sent ([MOBILE_HOUSEKEEPER_AI.md §12](../MOBILE_HOUSEKEEPER_AI.md)).
6. **Hours Returned is not a quota.** Recovered time belongs to the people and the operation; it is never converted
   into a per-person output target ([09 §2](09-performance-and-impact-engine.md#2-hours-returned-the-north-star)).
7. **Small groups are protected.** No aggregate, survey result, export or answer that describes fewer than a minimum
   number of people (proposed: five, confirmed per property in the pilot's P0) is shown; smaller groups are merged or
   suppressed. At a 50–150-room hotel a "role group" can be one person, such as the chief engineer or night auditor.
   The rule applies to every surface, including Ask PatelRep and future owner and corporate views.

## 5. Feature review checklist

Every feature answers these questions in its Strategy Fit Record ([14 §3](14-development-and-acceptance-standards.md#3-the-strategy-fit-record)).
Every question is phrased so that "yes" signals a risk; any "yes" needs a documented mitigation or an explicit human
product decision before release.

| # | Question |
|---|---|
| C1 | Could this increase the pace, volume or intensity of work for any person? |
| C2 | Does it allocate work in a way a supervisor cannot see the reasons for or override, or without enforcing known limits and disclosing unknown ones? |
| C3 | Does it create data entry or action prompts that could fall outside paid time? |
| C4 | Does it collect, display or infer anything about an individual (location, speed, output, behavior) that is not necessary, not aggregated where possible, or not visible to the person? |
| C5 | Could its output be used to discipline, rank, reward or pay people without a named human decision? |
| C6 | Does it read or change schedules, availability, leave, qualifications or pay-affecting records? |
| C7 | Could it make reporting a safety issue harder, slower or riskier for the reporter? |
| C8 | Could it save time by reducing quality, inspections or guest service? |
| C9 | When data is missing, could it assume capacity, availability or zero instead of saying "unknown"? |
| C10 | Could it hide or delay a staffing shortage instead of surfacing it to someone who can act? |
| C11 | Could it show results for a group small enough to identify individuals (§4 item 7)? |

## 6. Existing functionality to review (recommendations, not findings of harm)

| Item | Observation | Recommendation for reviewed follow-up |
|---|---|---|
| Smart Balance with unknown capacity | When a target or schedule is unknown, the corresponding limit is not enforced; the gap is reported as an assumption | Consider requiring explicit supervisor acknowledgment, or excluding receivers with unknown capacity from automatic balancing |
| Per-person SLA and volume metrics | Exist in the Team view, employee drawer and exports, with low-sample flags and no ranking | Keep them supervisory; add assignment-mix context before any expansion; never feed them into automated decisions |
| Break policy | No break policy is stored; capacity is labeled "paid shift minutes" | A hotel-configurable break policy, reviewed against applicable law, before break-aware planning |
| Forward staffing visibility | Future-day demand is `unknown` because the current OPERA sync pulls arrivals for today and tomorrow only and does not refresh cancellations | Improve the reservation feed through PatelRep Connect ([05](05-integration-strategy.md)) so shortages can be shown earlier |

## 7. Legal and policy alignment

This policy is a product standard, not legal advice. Features that touch scheduling, overtime, breaks, leave, pay,
monitoring or employee records must be reviewed against applicable federal, state and local employment law and any
collective agreements by qualified counsel before release (external dependency ED-10). Where law sets a stricter rule
than this policy, the law wins.

## 8. Governance

* **Owner:** the founder (product), with security review for any feature that changes personnel or pay-affecting data.
* **Where it applies:** every Strategy Fit Record (item 9) and every pilot ([12 §6](12-customer-pilot-strategy.md#6-employee-experience-and-protection)).
* **Incidents:** a feature that produces a prohibited outcome is treated as a production incident: disable it through
  its flag, notify the affected hotel, fix, and record the lesson.
* **Review:** this policy is reviewed at least once a year and after every pilot.
