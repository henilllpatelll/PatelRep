# 02 — Product Constitution

> **Status:** The bold decision statement of each article (FD-01 to FD-15), the capability domains in §3 (FD-34) and
> experience principles 1–5 and 7 in §4 (FD-33, FD-14) are founder-approved
> ([decision register](15-strategic-decision-register.md#1-founder-approved-decisions)). The feature test in §1, each
> article's "Not:" interpretation, experience principle 6 and the truthfulness principles' wording in §5 were proposed
> as PA-18 and are **founder-approved** since 2026-11-26 (FD-43). "Today:" notes record repository facts at the baseline.
> Changing a founder-approved item requires a reviewed decision-register change approved by the founder.
> **Baseline:** `origin/main` @ `41995dcb` (2026-11-26). **Revised** at `839144cd` (2026-11-26, Phase 0.1, #259): FD-43
> status (this header, §1 and experience principle 6) and the §1 adoption note only; "Today:" notes were not
> re-verified.
> **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

## 1. The test every feature must pass

Founder-approved (FD-43, formerly PA-18; approved 2026-11-26):

> **Does this measurably give someone in hospitality time back, or measurably improve guest experience, quality,
> safety, profitability or employee well-being — without adding needless complexity, and without costing safety,
> quality, privacy, employee well-being or the truth?**

The test covers all six balanced outcomes (FD-19), so features whose value is safety or quality — such as surfacing
a staffing shortage or one-step safety reporting — pass even when they add a step. It generalizes the repository's
former code decision filter ("Every feature must save a housekeeper or engineer time on the floor — not add
complexity to their phone") from two roles to everyone PatelRep serves. `CLAUDE.md` adopted it as its feature decision
filter in Phase 0.1 (#259, adoption step A1), resolving the instruction-level part of
[CF-03](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions). Security, reliability,
accessibility, compliance, correctness and maintenance work remains valid without an immediate measurable time saving
(FD-44).

## 2. The permanent product decisions

Each article states the decision, what it requires, what it does **not** mean, and where the repository stands today.

**Article 1 — One unified PatelRep platform (FD-01).** One product, one account and identity model, one data model per
property. *Not:* a suite of separately deployed products with separate logins. *Today:* one repository with an API
(`apps/api`), web (`apps/web`) and mobile (`apps/mobile`) client on one backend and tenant model.

**Article 2 — One role-adaptive application (FD-02).** Every employee, manager and owner uses the same application,
which adapts to their role, with mobile and web experiences suited to the work. *Not:* a different app per department.
*Today:* six canonical roles (`apps/api/core/roles.py`), one role and one hotel per session; role-specific mobile tabs
for every role; the web app serves managers, supervisors and front desk, while housekeepers and engineers are
mobile-only (`apps/web/lib/utils/routeGuard.ts`). Owner, corporate, accounting and HR roles do not exist yet
([CF-21](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)).

**Article 3 — One all-inclusive subscription (FD-03).** Customers buy PatelRep, not modules. *Not:* a decision on exact
prices, allowances or overage, which remain open ([11](11-commercial-strategy.md)). *Today:* the documented plan is
"$99/mo + $0.02/AI credit, cap $2.50/room/month" (`CLAUDE.md`), with H4 controlled overage implemented but disabled;
active billing contracts stay unchanged until a reviewed commercial decision ([CF-02](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)).

**Article 4 — Maximum practical AI autonomy within strict risk-based boundaries (FD-04).** Automate as much as can be
done safely, proven step by step. *Not:* permission to loosen any Customer Agent Harness policy (FD-24). *Today:* the
highest executable level is human-approved, the harness is default-disabled and no worker is deployed
([06 §3](06-ai-and-autonomy-strategy.md#3-autonomy-model-and-current-ceilings)).

**Article 5 — Comprehensive workforce management with payroll integrations (FD-05).** Scheduling, coverage,
availability, leave, onboarding, training and self-service, connected to the hotel's payroll provider. *Not:* PatelRep
becoming a payroll processor. *Today:* scheduling, availability and time off, coverage gaps, employee self-service and
a same-day housekeeping staffing forecast exist; time clock covers housekeeping only, and its shift-session table is
deliberately not linked to scheduling or payroll (migration 056); no payroll, timekeeping or HR-system integration
exists.

**Article 6 — Integrate guest-facing platforms; do not build competing ones (FD-06).** Guest messaging, reviews, CRM and
booking stay with the platforms hotels already use; PatelRep coordinates the operational work behind them. *Not:* a
ban on small operational touchpoints a feature genuinely needs. *Today:* there is no guest-facing app or portal;
guest requests, feedback, lost and found and late checkout are staff-side workflows; staff-initiated guest SMS through
Twilio exists for guest requests (consent required, credentials required, replies accepted within a window). Its
future relative to guest platforms is recorded in [CF-13](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions).

**Article 7 — An intelligence and operations layer, not a replacement for systems of record (FD-07).** PMS,
accounting, payroll, revenue management and other authoritative software stay authoritative. *Not:* refusing to write
to them when a reviewed, authorized integration makes that useful. *Today:* the OPERA integration is a feature-flagged
pilot (`tenants.opera_pilot_enabled`, default false) that reads arrivals; a room-status write-back function exists but
nothing calls it, and two-way sync hardening is deferred (`CLAUDE.md` A4).

**Article 8 — Native operational functionality where useful (FD-08).** Especially for hotels without equivalent
software. *Not:* rebuilding a PMS or accounting system. *Today:* extensive native housekeeping, engineering, tasks,
logbook, scheduling, safety, evidence, lost and found and reporting capabilities.

**Article 9 — Never force customers to replace their stack (FD-09).** PatelRep works with what a hotel has.
*Not:* supporting every product at once; connectors are prioritized by customer need. *Today:* the app must function
standalone first (`CLAUDE.md` A4).

**Article 10 — Financial and ownership intelligence on authorized financial integrations (FD-10).** Owner-level
numbers come from the hotel's own authorized accounting and financial sources. *Not:* estimating financials and
presenting them as actuals. *Today:* no accounting integration exists; the only financial figure in the reporting
registry is downtime revenue exposure, explicitly labeled an estimate (`services/reporting/definitions.py`).

**Article 11 — Universal conversational intelligence (FD-11).** Ask PatelRep is available to every authorized user
([06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep)). *Not:* forcing conversation where a button is faster
(§4, FD-33). *Today:* an AI Copilot and a housekeeper assistant exist for some roles and flows.

**Article 12 — Delegation, authorized execution, monitoring and proactive coordination (FD-12).** PatelRep does work,
not just answers. *Not:* actions without authorization. *Today:* AI previews require confirmation before anything is
created; agent writes require human approval and are inactive.

**Article 13 — Measure customer impact and find improvement opportunities (FD-13).** Every claim of value is measured
([09](09-performance-and-impact-engine.md)). *Not:* marketing numbers. *Today:* a metric definition registry with 22
operational definitions exists; Hours Returned is not yet measured.

**Article 14 — Adapt to each hotel's software, data, permissions and capabilities (FD-14).** One consistent product
whose capabilities light up as authorized data arrives ([07](07-adaptive-intelligence.md)). *Not:* new authority from
new data. *Today:* precedents such as null-not-zero metrics and fail-closed flags exist; no shared readiness layer.

**Article 15 — Safety, quality, privacy, employee protection and truthful information come first (FD-15).** When they
conflict with speed, cost or convenience, they win. *Today:* see [10](10-employee-protection-policy.md) and
[13](13-security-privacy-and-governance.md) for the precedents and boundaries already in code.

## 3. Capability domains (FD-34)

The platform is organized into six capability domains. **They are not separately purchased products**; they organize
the roadmap, ownership and agent design.

| Domain | Scope | Agent product family in code |
|---|---|---|
| **Operations** | Housekeeping, engineering, maintenance, assets, inspections, tasks, inventory, compliance, cross-department coordination | `operations` |
| **People** | Workforce management, scheduling, coverage, onboarding, training, employee self-service, payroll integration | none yet ([CF-04](15-strategic-decision-register.md#9-conflicts-and-recommended-resolutions)) |
| **Guest** | Coordination with existing guest platforms, requests, service recovery, experience intelligence | `guest` |
| **Growth** | Revenue intelligence, demand analysis, reputation, sales and commercial coordination | `growth` |
| **Owner** | Financial intelligence, property performance, portfolio oversight, asset economics, executive assistance | `owner` |
| **Connect** | Integration infrastructure and external software connectivity | `connect` |

The agent product families are defined in `apps/api/services/agent_harness/vocabulary.py` (`ProductFamily`). Whether
People becomes its own agent family is a proposal for the H8 design (PA-10).

## 4. Experience principles (PatelRep Workspace, FD-33)

1. **Simple work queues.** Each person sees what needs them next, in order, with the context to act.
2. **Actionable notifications.** A notification exists only if someone can act on it; urgency is reserved for urgent
   work; preferences and schedules are respected.
3. **Contextual assistance.** Help appears where the work is (a room, a work order, a shift), not in a separate place.
4. **Exception-driven management.** Managers see what is off-track, not everything that is on-track.
5. **Ordinary interfaces first (FD-33).** Do not force users into an AI conversation when an ordinary interface
   is faster. Conversation is an option on every screen, never a toll gate in front of it.
6. **Built for the floor (FD-43).** Phone-first for floor roles, one-handed, English and Spanish at parity,
   tolerant of poor connectivity, and never slower than the paper or radio it replaces.
7. **Consistent everywhere (FD-14).** The same product at every property; differences come from readiness states, not
   from different apps ([07](07-adaptive-intelligence.md)).

## 5. Truthfulness principles

* Never fabricate data, outcomes, partnerships or capabilities.
* Missing data is never zero; unknown is shown as unknown.
* Partial answers say what is missing; stale data shows its age.
* Estimates are labeled estimates; financial savings are claimed only when realized
  ([09 §3](09-performance-and-impact-engine.md#3-evidence-classes)).
* Status claims use the vocabulary implemented ≠ tested ≠ merged ≠ enabled ≠ exercised ≠ production-verified
  ([14 §4](14-development-and-acceptance-standards.md#4-status-vocabulary-for-every-claim)).

## 6. Amendments

An article changes only through a reviewed pull request that updates the
[decision register](15-strategic-decision-register.md#10-change-process) and is approved by the founder. Executable
contracts that implement an article change through their own reviewed process.
