# 15 — Strategic Decision Register

> **Status:** The register of record for PatelRep's strategic decisions. Entries in §1 are founder-approved; every other
> section records proposals, open decisions, dependencies, implementation status or conflicts, as labeled.
> **Baseline:** `origin/main` @ `41995dcb` (2026-11-26). **Authority:** [README § Authority and precedence](README.md#authority-and-precedence).

Identifier prefixes: **FD** founder-approved decision · **PA** proposed architecture · **OC** open commercial decision
· **TD** technical decision deferred to implementation · **ED** external dependency · **IF** existing implemented
functionality · **IN** inactive functionality · **FF** future functionality · **CF** conflict. Identifiers are never
reused; a superseded entry is marked, not deleted.

## 1. Founder-approved decisions

Recorded 2026-11-26 from the founder's Phase 0 brief.

| Id | Decision | Home |
|---|---|---|
| FD-01 | One unified PatelRep platform | [02](02-product-constitution.md) |
| FD-02 | One role-adaptive application for every employee, manager and owner, with appropriate mobile and web experiences | [02](02-product-constitution.md), [04 §6](04-platform-architecture.md#6-patelrep-workspace-and-roles) |
| FD-03 | One all-inclusive subscription rather than separately purchased capability modules | [11](11-commercial-strategy.md) |
| FD-04 | Maximum practical customer AI autonomy within strict risk-based authorization boundaries | [06](06-ai-and-autonomy-strategy.md) |
| FD-05 | Comprehensive workforce management with payroll integrations | [03 W10](03-master-product-roadmap.md#w10--expand-workforce-and-staffing-intelligence) |
| FD-06 | Integrate existing guest-facing platforms rather than build competing ones | [05](05-integration-strategy.md) |
| FD-07 | Remain an intelligence and operations layer; do not intentionally replace PMS, accounting, payroll, revenue management or other authoritative software | [05](05-integration-strategy.md) |
| FD-08 | Maintain native operational functionality where useful, particularly for hotels without equivalent software | [02](02-product-constitution.md) |
| FD-09 | Never force customers to replace their existing technology stack | [05](05-integration-strategy.md) |
| FD-10 | Build financial and ownership intelligence on authorized accounting and financial integrations | [03 W12](03-master-product-roadmap.md#w12--develop-owner-and-financial-intelligence) |
| FD-11 | Universal conversational intelligence for every authorized user | [06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep) |
| FD-12 | Task delegation, authorized execution, monitoring and proactive coordination — not merely chatbot responses | [06 §6](06-ai-and-autonomy-strategy.md#6-delegation-monitoring-and-proactive-coordination) |
| FD-13 | Measure customer impact and continuously identify improvement opportunities | [09](09-performance-and-impact-engine.md) |
| FD-14 | Adapt dynamically to each hotel's available software, data, permissions and capabilities | [07](07-adaptive-intelligence.md) |
| FD-15 | Prioritize safety, quality, privacy, employee protection and truthful information | [02](02-product-constitution.md) |
| FD-16 | Mission: give everyone in hospitality their time back | [01](01-company-vision.md) |
| FD-17 | Brand promise: "More time for hospitality." | [01](01-company-vision.md) |
| FD-18 | PatelRep is an intelligent hospitality operations and coordination platform connecting employees, supervisors, managers, corporate teams, owners and their existing software | [01](01-company-vision.md) |
| FD-19 | Balance time savings, guest experience, profitability, operational quality, safety and employee well-being | [01 §6](01-company-vision.md#6-the-balance-patelrep-keeps) |
| FD-20 | Address short staffing by eliminating waste; never by unsafe workloads, sacrificed quality, pressure on employees or concealed shortages | [01 §7](01-company-vision.md#7-our-stance-on-short-staffing), [10](10-employee-protection-policy.md) |
| FD-21 | Sell measurable results, not AI technology | [01 §8](01-company-vision.md#8-what-patelrep-sells) |
| FD-22 | Initial market: 50–150-room hotels; long-term: all hotel types, sizes and ownership structures | [01 §9](01-company-vision.md#9-who-patelrep-serves) |
| FD-23 | Keep the restrictions against autonomous phone calls and autonomous vendor communications unless a future reviewed decision changes them | [06 §4.2](06-ai-and-autonomy-strategy.md#42-founder-restrictions-carried-forward-fd-23) |
| FD-24 | The autonomy goal is not permission to loosen current Customer Agent Harness security policies | [06 §2](06-ai-and-autonomy-strategy.md#2-what-this-strategy-does-not-change) |
| FD-25 | Platform foundations are logical responsibilities; none is assumed to require a separate service | [04 §1](04-platform-architecture.md#1-architectural-principles) |
| FD-26 | Developer Harness V3 keeps its existing roadmap, isolation requirements, authority model and activation gates, stays subject to its implementation and activation requirements, and V2 is authoritative until V3 is formally activated; existing Customer Agent Harness H0–H8 contracts and risk boundaries are preserved | [04 §3](04-platform-architecture.md#3-foundations-and-where-they-live-today), [13 §3](13-security-privacy-and-governance.md#3-boundaries-preserved-unchanged) |
| FD-27 | Provider access only through authorized developer accounts, commercial partnerships, customer consent and applicable certification; never bypass third-party access restrictions | [05 §2](05-integration-strategy.md#2-principles) |
| FD-28 | The founder handles commercial agreements, payments and authorizations; development work assists with research, implementation, testing and maintenance | [05 §2](05-integration-strategy.md#2-principles) |
| FD-29 | Customer data access does not imply ownership or unrestricted secondary use; no automatic model training or cross-customer benchmarking; use existing infrastructure until scale justifies more | [08](08-data-intelligence-strategy.md) |
| FD-30 | Capability readiness: every agent, metric, workflow, prediction and automation declares required and optional data, permissions, integration capabilities, minimum quality and freshness, minimum history, supported actions, fallback and activation requirements; seven states (full, partial, stale, insufficient history, restricted, unavailable, inactive); deterministic checks before model invocation; missing data never zero or fabricated; only affected capabilities disabled; more data never grants execution authority | [07](07-adaptive-intelligence.md) |
| FD-31 | Hours Returned is the North Star; the metric families, a registry with formulas, provenance, reporting periods, permissions, validation and freshness; measured, estimated, financially realized and potential-opportunity value distinguished; no double counting or unsupported attribution; time recovered is not payroll savings; the measure–detect–investigate–recommend–execute–validate–improve cycle | [09](09-performance-and-impact-engine.md) |
| FD-32 | Ask PatelRep: a universal conversational interface for all authorized users with the long-term capability set in 06 §5.3; users need not understand underlying agents, APIs or providers; permissions enforced before sensitive information reaches a model; truthful partial answers; deterministic tools where appropriate | [06 §5](06-ai-and-autonomy-strategy.md#5-ask-patelrep) |
| FD-33 | PatelRep Workspace: one role-adaptive experience; never force an AI conversation when an ordinary interface is faster | [02 §4](02-product-constitution.md#4-experience-principles-patelrep-workspace-fd-33) |
| FD-34 | Six capability domains (Operations, People, Guest, Growth, Owner, Connect), not separately purchased | [02 §3](02-product-constitution.md#3-capability-domains-fd-34) |
| FD-35 | The employee protection requirements | [10](10-employee-protection-policy.md) |
| FD-36 | Preserve existing billing safeguards and controlled-overage contracts; record conflicting pricing statements without silently rewriting active billing contracts | [11](11-commercial-strategy.md) |
| FD-37 | The sixteen roadmap workstreams, dependency-aware rather than strictly sequential; partner applications, authorized research, baselines and pilot preparation may begin early | [03](03-master-product-roadmap.md) |
| FD-38 | An authorized pilot at the founder's hotel, subject to property approval, prioritizing shift handovers, voice-based issue reporting, cross-department coordination, housekeeping and front-desk room readiness, staffing coverage assistance, conversational hotel knowledge and management briefings; baselines first; accounting for occupancy, staffing, service levels, seasonality and comparable conditions; measuring employee feedback, guest outcomes, quality, safety and realized value; evidence-based expansion and rollback criteria; these documents authorize no data collection, paid model calls, external integrations or production activation | [12](12-customer-pilot-strategy.md) |
| FD-39 | The strategy is authoritative for long-term product intent and does not override executable security policies, technical contracts, deployment requirements or authority controls | [README](README.md#authority-and-precedence) |
| FD-40 | PatelRep Connect's responsibilities: connector SDK, official APIs and business events, unified integration providers, scheduled reports, secure file transfer and document imports, credential management, provider and capability registries, canonical models and provider extensions, identity mapping, synchronization and conflict resolution, source-of-truth selection, health monitoring, external action authorization, usage metering and cost governance, self-service onboarding, lifecycle and compatibility testing | [05 §4](05-integration-strategy.md#4-connect-core-components) |
| FD-41 | Data Intelligence's responsibilities: authorized ingestion, normalization, operational history, knowledge retrieval, provenance, data quality, analytics, predictive modeling, benchmarking and evidence-based improvement | [08](08-data-intelligence-strategy.md) |
| FD-42 | Every future product implementation should identify its customer problem, roles, expected outcomes, required data and capabilities, fallback, permission and risk boundaries, AI-ready domain operations, integration compatibility, employee protection implications, testing and evaluation, measurement instrumentation, cost, and rollout and rollback; adoption into instructions and automated governance is a separate reviewed follow-up | [14](14-development-and-acceptance-standards.md) |

## 2. Proposed architecture

| Id | Proposal | Home |
|---|---|---|
| PA-01 | Layered logical architecture and the foundation-to-code mapping | [04 §2](04-platform-architecture.md#2-logical-architecture) |
| PA-02 | Capability readiness declaration, states and precedence | [07 §3](07-adaptive-intelligence.md#3-the-capability-readiness-declaration) |
| PA-03 | Metric registry extension fields | [09 §7](09-performance-and-impact-engine.md#7-metric-registry-architecture-proposed-pa-03) |
| PA-04 | Connect Core component model | [05 §4](05-integration-strategy.md#4-connect-core-components) |
| PA-05 | Canonical hotel data model scope | [05 §5](05-integration-strategy.md#5-canonical-hotel-data-model-proposed-scope) |
| PA-06 | Ask PatelRep answer and action pipeline | [06 §5.2](06-ai-and-autonomy-strategy.md#52-answer-and-action-pipeline-proposed-pa-06) |
| PA-07 | Permission-scoped memory model | [06 §5.4](06-ai-and-autonomy-strategy.md#54-memory-proposed-pa-07) |
| PA-08 | Provenance and quality envelope | [08 §4](08-data-intelligence-strategy.md#4-provenance-and-quality-proposed-pa-08) |
| PA-09 | Impact attribution method: activity taxonomy, workload-driver normalization, staff-time-only counting, desired-volume rule (baselines and comparable conditions themselves are required by FD-31 and FD-38) | [09 §2](09-performance-and-impact-engine.md#2-hours-returned-the-north-star), [09 §4](09-performance-and-impact-engine.md#4-measurement-integrity-rules) |
| PA-10 | Decide a `people` agent product family in H8 design, or map People capabilities explicitly | [02 §3](02-product-constitution.md#3-capability-domains-fd-34) |
| PA-11 | Organization and portfolio tenancy above `hotel_id` | [04 §6](04-platform-architecture.md#6-patelrep-workspace-and-roles) |
| PA-12 | Role expansion through explicit capability grants | [04 §6](04-platform-architecture.md#6-patelrep-workspace-and-roles) |
| PA-13 | Integration usage and cost metering per property | [05 §7](05-integration-strategy.md#7-usage-metering-and-cost-governance) |
| PA-14 | Strategy Fit Record as the vehicle for FD-42's thirteen items, with the acceptance, evaluation and rollout standards | [14 §3](14-development-and-acceptance-standards.md#3-the-strategy-fit-record) |
| PA-15 | Authorized benchmarking: opt-in, aggregated, minimum cohorts | [08 §7](08-data-intelligence-strategy.md#7-customer-data-use-boundaries) |
| PA-16 | Planning risk floors per capability domain | [06 §4.3](06-ai-and-autonomy-strategy.md#43-proposed-risk-floors-for-the-capability-domains-pa-16) |
| PA-17 | Roadmap waves, milestone identifiers and dependency map | [03](03-master-product-roadmap.md) |
| PA-18 | The product test, article interpretations and experience principle 6 of the constitution (pending founder confirmation) | [02 §1](02-product-constitution.md#1-the-test-every-feature-must-pass) |
| PA-19 | Product interpretations of the employee protection requirements: analytics rules, minimum group size, review checklist, review items | [10](10-employee-protection-policy.md) |
| PA-20 | Pilot phases, measurement methods and draft expansion and rollback thresholds | [12](12-customer-pilot-strategy.md) |

## 3. Open commercial decisions

OC-01 price structure and levels · OC-02 included AI allowances and fair use · OC-03 exceptional overage and its
consent model · OC-04 third-party integration fees · OC-05 transition terms for existing customers · OC-06 pilot
commercial terms · OC-07 agent usage allowance, markup and credit price (H4) · OC-08 cancellation billing (H4 F5) ·
OC-09 consent terms and versioning (H4) · OC-10 onboarding fees · OC-11 portfolio pricing · OC-12 contract length,
billing frequency and service commitments. Details: [11 §10](11-commercial-strategy.md#10-open-commercial-decisions).

## 4. Technical decisions deferred to implementation

| Id | Decision |
|---|---|
| TD-01 | Where Connect adapters run (API process or a separate worker) |
| TD-02 | Sync mechanics and conflict policy per provider and field |
| TD-03 | Credential storage, rotation and vault choice |
| TD-04 | Analytics storage beyond operational Postgres |
| TD-05 | Vector retrieval beyond pgvector |
| TD-06 | Voice capture beyond on-device recognition (web, other roles) |
| TD-07 | Realtime scope beyond the surfaces in `CLAUDE.md` A2 |
| TD-08 | Portfolio tenancy implementation and RLS changes |
| TD-09 | New roles and JWT claim changes |
| TD-10 | Converging legacy copilot model routing with the H3 catalog |
| TD-11 | Memory storage, retention and deletion |
| TD-12 | Readiness declaration storage and evaluator placement |
| TD-13 | Metric computation scheduling and storage |
| TD-14 | Delegation beyond depth 0 (H8) |
| TD-15 | Step-up authentication (deferred by H7) |
| TD-16 | Mobile AI Control Center surface (H6 product decision) |
| TD-17 | V3 suite in protected CI (G-V3-CI control-plane PR) |
| TD-18 | Moving legacy AI action paths onto the harness (one operation, two callers) |
| TD-19 | Canonical model storage (views, tables or a separate schema) |
| TD-20 | Event taxonomy and event storage |
| TD-21 | Allocation of infrastructure cost per property |

## 5. External dependencies

| Id | Dependency |
|---|---|
| ED-01 | Oracle OPERA Cloud / OHIP developer access, applicable certification and customer consent |
| ED-02 | Payroll, timekeeping and HR provider access and agreements |
| ED-03 | Accounting and financial platform access |
| ED-04 | Guest messaging, reputation and CRM platform access |
| ED-05 | Revenue management, channel and reservation-system access |
| ED-06 | Unified integration provider evaluation and terms |
| ED-07 | AI model provider terms, data handling, pricing and availability |
| ED-08 | Platform and service providers: Supabase, Railway, Vercel, Expo/EAS, GitHub, Stripe, Twilio, Resend |
| ED-09 | Property approval for the pilot |
| ED-10 | Qualified legal and compliance advice (employment, privacy, consumer, contracts) |
| ED-11 | Developer-tool provider eligibility for V3 (gate G-PROVIDER-AUTH) |

## 6. Existing implemented functionality

Active on `main` where deployed; scheduled jobs run only in production.

| Id | Functionality | Principal evidence |
|---|---|---|
| IF-01 | Housekeeping: room board, status rules, assignments and batch publish, Smart Balance, clean sessions, inspections, checklists, linen, DND and welfare escalation | `routers/housekeeping.py`, `routers/clean_sessions.py`, `services/smart_balance.py` |
| IF-02 | Engineering: work orders, preventive maintenance, assets, spare-parts inventory, vendor engagement records, insights | `routers/work_orders.py`, `routers/assets.py`, `routers/pm_management.py`, `routers/inventory.py`, `routers/vendors.py` |
| IF-03 | Tasks and recurring tasks, logbook and AI shift summaries, lost and found, safety, evidence, programs, late checkout, guest requests with SLAs, room discrepancies | Corresponding routers |
| IF-04 | Notifications and escalation ladder | `services/notify.py`, `routers/internal.py` |
| IF-05 | People: staff, custom roles, team scheduling, availability, time off, swaps, offers, coverage, same-day staffing forecast, housekeeping time clock, self-service | Scheduling routers and services |
| IF-06 | Reporting: 22-definition registry, views, exports, scheduled delivery, Management ROI and Intelligence (GM), daily GM summary (needs Resend) | `services/reporting/`, `routers/management_roi.py` |
| IF-07 | AI: copilot intents, cited SOP answers, rule-first task parsing, briefings, recap, on-device voice input, actual-usage credits with cap pre-check | `routers/ai_copilot.py`, `services/ai/`, `middleware/credits.py` |
| IF-08 | Legacy billing: base fee, trial, included credits, overage, whole-bill cap, durable monthly true-up | [11 §3](11-commercial-strategy.md#3-what-is-implemented-today) |
| IF-09 | Predictions: rule-based room readiness (every 30 minutes) and nightly asset-failure predictions | `services/ai/predictions.py`, `services/ai/failure_predictions.py` |
| IF-10 | OPERA PDF import; Expo push | `services/opera_pdf.py`, `services/notify.py` |
| IF-11 | Platform: Design System V2 as the permanent default, EN/ES parity, tenant feature flags with Feature Rollout | [DESIGN_V2_ACTIVATION.md](../DESIGN_V2_ACTIVATION.md), [FEATURE_FLAGS.md](../FEATURE_FLAGS.md) |
| IF-12 | Delivery: CI Gate, Staging Candidate and Gate, Production Release, rollback and recovery workflows, Release Engineer, Deploy Health Check | [RELEASE_PROCESS.md](../RELEASE_PROCESS.md) |
| IF-13 | Developer Harness V2: policy hook, bypass scopes, roles, smart testing, CI suites | [developer-harness-v2/](../developer-harness-v2/02-architecture-contract.md) |

## 7. Inactive functionality

| Id | Functionality | Why inactive |
|---|---|---|
| IN-01 | H1 durable execution | Worker not deployed |
| IN-02 | H2 Tool Gateway (reads, work-order assignment) | Default-disabled; production refused in code |
| IN-03 | H3 orchestrator and provider adapters | Paid calls never enabled |
| IN-04 | H4 customer billing and controlled overage | `disabled`; Stripe test mode only |
| IN-05 | H5 Engineering and Housekeeping specialists | `/agent-specialists` returns 404 unless gates are on |
| IN-06 | H6 AI Control Center and `agent_worker` identity | `ai_control_center` off; no worker credential issued |
| IN-07 | H7 P2 verified-human identity (migration 262) | Probe: process flag off and no route; decide v2: no EXECUTE grant; legacy paths remain the active ones |
| IN-08 | AI flags `hk_ai_assistant`, `hk_ai_photo_analysis`, `hk_ai_task_translation`, `eng_ai_repair_assist`, `ai_agents` | Default off |
| IN-09 | OPERA OHIP sync, webhooks and SFTP ingestion; room-status write-back | `opera_pilot_enabled` false; write-back uncalled |
| IN-10 | Guest SMS, Stripe and Resend paths without credentials | Environment-dependent |
| IN-11 | Developer Harness V3 D3.2–D3.5 | 28 activation gates, none closed; D3.4–D3.5 simulated |
| IN-12 | Dependency Orchestrator | Paused (per the V3 verification register) |
| IN-13 | Autonomous Feature Builder and Feature Orchestrator | Optional, dispatch-only path |
| IN-14 | `tenant_groups` schema | Not read by application code |

## 8. Future functionality

FF-01 V3 D3.6–D3.9 (W1) · FF-02 H7 P3–P8 (W2) · FF-03 H8 (W3) · FF-04 Connect Core (W4) · FF-05 Data Intelligence
foundation (W5) · FF-06 capability readiness layer (W6) · FF-07 Hours Returned and impact views (W7) · FF-08 universal
Ask PatelRep (W8) · FF-09 room-ready notification and handover improvements (W9) · FF-10 payroll and timekeeping
integration, forward staffing forecast (W10) · FF-11 department-head views and exception queue (W11) · FF-12 owner,
corporate, accounting and HR roles, portfolio tenancy, financial intelligence (W12) · FF-13 guest and commercial
integrations (W13) · FF-14 validated predictions and opt-in benchmarking (W14) · FF-15 continuous optimization and
coordinated autonomy (W15) · FF-16 all-inclusive pricing and scaling (W16).

## 9. Conflicts and recommended resolutions

None of these is changed by this PR. "Docs PR", "instruction PR" and "fix PR" mean separate reviewed work.

| Id | Conflict | Evidence | Recommended resolution |
|---|---|---|---|
| CF-01 | AI-first positioning ("AI Staff Copilot", "Quore-style simplicity with AI-powered predictions") versus FD-16, FD-18, FD-21 | `CLAUDE.md`, `README.md`, `.planning/PROJECT.md`, `apps/web/app/page.tsx` and its e2e assertion | Instruction and docs PRs to adopt the mission framing; public-site copy and its test change together |
| CF-02 | Usage-priced AI and inconsistent pricing statements versus FD-03 | [11 §4](11-commercial-strategy.md#4-conflicts-with-the-all-inclusive-direction) | No change to live billing until OC-01–OC-05 are decided; then one reviewed change set. The onboarding-prompt credit wording is a copy fix. The small-property cap is a defect in an existing billing safeguard: FD-36 keeps its behavior unchanged until it is decided in the OC-01/OC-02 package. Onboarding 1–39-room hotels is possible today, so until then do not onboard properties under 40 rooms for AI features |
| CF-03 | Code decision filter limited to housekeepers and engineers | `CLAUDE.md`, `ai-ready-feature-standard.md`, `.planning/PROJECT.md` | After the founder confirms PA-18, generalize per [02 §1](02-product-constitution.md#1-the-test-every-feature-must-pass) ([14 §10](14-development-and-acceptance-standards.md#10-adoption-plan-recommended-follow-up-not-performed-in-this-pr) A1) |
| CF-04 | `ProductFamily` has no People family | `services/agent_harness/vocabulary.py` | PA-10 in H8 design (W3-M1) |
| CF-05 | Segment narrowing ("Texas", "independent", "limited/select-service"); Texas-framed safety content | `CLAUDE.md`, `README.md`, planning and audit docs, `routers/safety.py` | Treat as initial go-to-market context; make jurisdiction-specific content configurable before expansion (W16-S5) |
| CF-06 | README is outdated: "14 spec files" (one exists), missing `spec/07_deployment.md`, Next.js 14 (actual 16.x), no `apps/mobile` | `README.md`, `spec/`, `apps/web/package.json` | Docs PR |
| CF-07 | `CLAUDE.md` factual drift: Python 3.13 (image is 3.12); JWT claims `hotel_id` + `role` (the app role moved to `user_role` in migration 053); migrations "001–041" (192 files to 262, more prefix collisions); "21 domain files" (57 routers); retired web `/ai`; `middleware.ts` (now `proxy.ts`); true-up schedule; cron table missing jobs; logbook "hard-delete" (the job archives); Vercel's role; stale `.planning` pointers | `CLAUDE.md` versus code | Instruction PR with human approval |
| CF-08 | AI routing statements name `claude-sonnet-3.5` and model-based readiness predictions, and describe per-hotel routing as general | `CLAUDE.md`, `MOBILE_HOUSEKEEPER_AI.md` §5; code uses `claude-sonnet-4-6`, a rule-based readiness heuristic, and hard-coded model IDs except for two purposes | Include in the CF-07 instruction PR and a docs PR |
| CF-09 | "Connect" means both the integration foundation and an H8 agent family | `vocabulary.py`, `agent-harness/roadmap.md` | Use the [README glossary](README.md#glossary); H8 says "Connect agents" |
| CF-10 | Overlapping, stale planning and status: `.planning` roadmap and milestones stop in August 2026 (`STATE.md` was last edited 2026-09-16); plans marked unexecuted were executed; an unevidenced "two pilot hotels" gate; H7 P2 shown pending though merged; V3 docs call D3.2 "this PR"; pre-H6 doc says "not merged"; migration inventory stale; at least nine "phase" numbering schemes | `.planning/`, root plans, component docs | Master roadmap sequences workstreams; component docs get status refreshes in their own PRs; superseded plans marked historical in a docs PR |
| CF-11 | FD-23 restrictions are not encoded in any contract | `risk-model-h7.md`, `specialists-engineering.md` | Explicit prohibited rows plus a contract test in the next reviewed risk-model revision |
| CF-12 | Two AI action paths: legacy copilot confirm routes and the Customer Agent Harness | `routers/ai_copilot.py`, `services/agent_*` | TD-18; new agent-accessible writes use the harness |
| CF-13 | Native staff-initiated guest SMS versus FD-06 | `services/sms/`, `routers/guest_requests.py` | Keep as a minimal fallback for hotels without a messaging platform (FD-08); never grow it into a guest platform; prefer integration (W13-G1) |
| CF-14 | "AI Copilot as Primary Staff Interface" plan versus FD-33 | `.planning/ai-copilot-primary-interface.md` | The copilot is an optional accelerator; ordinary screens stay first-class; evaluations compare AI and UI paths |
| CF-15 | V3 README contains invalid UTF-8 bytes | `docs/developer-harness-v3/README.md` | V3-scoped docs PR, respecting V3 pins |
| CF-16 | ADR-0001 assumes a "$99/mo plan" and "five product families" | `agent-harness/adr-0001-initial-agent-stack.md` | Accepted ADRs stay unchanged as history; future ADRs cite this strategy |
| CF-17 | Per-person metrics exist (with safeguards) | `services/reporting/team.py` | Review per [10 §6](10-employee-protection-policy.md#6-existing-functionality-to-review-recommendations-not-findings-of-harm) |
| CF-18 | Unmerged `docs/pivot-plan` branch proposes PatelRep as "the brain and source of truth" and OPERA UI automation | `origin/docs/pivot-plan` | Owner decides whether to archive the branch; never adopt UI automation without provider authorization (FD-27) |
| CF-19 | Two housekeeping labor forecasts with different evidence rules | `routers/management_roi.py` versus `services/staffing_forecast.py` | Reconcile in the registry; label the trailing-average forecast as an estimate |
| CF-20 | "One application" versus two clients with different role access | `apps/web/lib/utils/routeGuard.ts` | Clarification only: one product, two clients; no change required |
| CF-21 | No owner, corporate, accounting, HR or department-head roles; a mobile-only `inspector` label the database and API reject | `core/roles.py`, `apps/mobile/lib/supabase.ts` | PA-12 role expansion; reconcile `inspector` in a fix PR |
| CF-22 | One hotel per session and an unused `tenant_groups` table versus portfolio oversight | migrations 002, 053 | PA-11 design with security review (W12-O1) |
| CF-23 | Several AI calls are not metered through the credit path | `services/ai/`, `routers/` | Fix PR metering them for internal cost tracking ([11 §6](11-commercial-strategy.md#6-cost-tracking-per-property)) without debiting customer credits; any customer charge for them is decided in OC-02, with notice ([11 §5](11-commercial-strategy.md#5-transition-principles)) |
| CF-24 | `hk_ai_assistant` is registered as UI-only but one route enforces it | `core/feature_registry.py`, `routers/ai_copilot.py` | Fix PR aligning registry metadata and behavior |
| CF-25 | Diverging PMS direction: harden two-way sync, defer it, or automate the UI | `HOTEL_STANDARDS_EXECUTION_PLAN.md`, `CLAUDE.md` A4, `risk-model-h7.md`, pivot branch | [05](05-integration-strategy.md): read first; writes only through reviewed, authorized operations; never by agents under H7 |
| CF-26 | Retention gaps and descriptions that overstate deletion | [13 §5](13-security-privacy-and-governance.md#5-privacy-principles) | Retention catalog (W5-D5); correct descriptions in the CF-07 instruction PR |
| CF-27 | Registry definitions and calculators disagree (PM compliance, cleaning-minutes denominator); several ROI rates return `0.0` on an empty denominator; no measured baseline exists | `services/reporting/definitions.py`, `services/guest_recovery/contracts.py` | Registry-to-calculator tests in W7-I1; fix PRs for the disagreements |
| CF-28 | The reservation-sync job records success when every hotel was skipped, and health reports it as the PMS last sync | `routers/internal.py`, `main.py` | Fix PR recording skipped runs honestly (readiness rule, [07](07-adaptive-intelligence.md)) |
| CF-29 | Schema comments and code docstrings describe data as inputs to AI training or cold-start | migration 004, `services/opera/sync.py` | No training without an explicit decision (FD-29); update comments only through new forward-only work, never by editing history |

## 10. Change process

1. Propose the change in a pull request that edits this register and the affected home document.
2. Founder-approved decisions (§1) change only with the founder's approval recorded in the PR; the old entry is marked
   superseded with the date and the new identifier.
3. A conflict (§9) is closed by the reviewed PR that resolves it; the row records the PR number.
4. Executable contracts change through their own processes; this register never substitutes for them.
5. Re-verify repository facts against `main` and update the baseline line of each revised document.
