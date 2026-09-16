# PatelRep — Open-Source Ecosystem Intelligence

*Research only. No code changed. Goal: what the open-source world already knows how to do that PatelRep should learn from, what PatelRep can combine in a hotel-native way that generic tools can't, what to build next, and what to deliberately not build.*

**Product filter applied throughout:** every recommendation is judged against *"does this save a housekeeper/engineer time or improve operations without adding complexity to their phone?"*

---

## 0. Read this first — the licensing lens (it governs everything below)

PatelRep is commercial SaaS. The single most important distinction is **can we copy/adapt code, or only study it / integrate over an API?**

| License | What it is | Safe to copy code into PatelRep SaaS? | Examples in this report |
|---|---|---|---|
| **MIT / BSD-2 / BSD-3 / ISC** | Permissive | ✅ Yes, freely | InvenTree, Novu, BookStack, Grocy, WatermelonDB, PyOD, Prophet, Merlion, sktime, LangGraph, LlamaIndex, Kanboard, Wekan, Rocket.Chat core, Chatwoot core, Vanna, Node-RED, Redash, VROOM |
| **Apache-2.0** | Permissive + patent grant | ✅ Yes (best-in-class for SaaS) | Timefold Solver (Community), Google OR-Tools, ThingsBoard (core), Home Assistant, Superset, Zulip, Haystack, WrenAI (core), StatsForecast, Appsmith, ElectricSQL, RxDB (core) |
| **LGPL** | Weak copyleft | ⚠️ OK if used as a *separate library* (don't fork/modify the lib itself) | Most OCA/Odoo hotel modules (per-module LGPL-3) |
| **GPL-2 / GPL-3** | Strong copyleft | 🚫 Do **not** link into our proprietary backend/app. Study patterns, replicate clean-room, or run as a separate self-hosted service | ERPNext, Frappe HR, Atlas/Grash CMMS, GLPI, osTicket, Budibase, LimeSurvey |
| **AGPL-3** | Strong copyleft + **network clause** (SaaS triggers disclosure) | 🚫🚫 Highest risk. Never incorporate code. Study only, or self-host unmodified behind an API boundary | Snipe-IT, Metabase, Grafana, Wiki.js, Zammad, Twenty, Plane, Vikunja, Formbricks, NocoDB, ToolJet, Windmill, OpenRemote, Kamra PMS |
| **OSL-3.0 / AFL** | Copyleft (PrestaShop family) | 🚫 Study only | QloApps |
| **fair-code / source-available** (e.g. n8n Sustainable Use License) | Not OSI open source; "internal business use" OK, embedding-as-a-feature not | 🚫 for embedding; ⚠️ internal automation only | n8n |

**Practical rule for the whole report:** the biggest, most polished hotel/CMMS/CRM systems (Snipe-IT, Metabase, Atlas CMMS, ERPNext, Twenty, QloApps, Kamra) are almost all **GPL/AGPL/OSL** — so they are *pattern & data-model teachers*, not code donors. The reusable **code** lives in the permissive algorithm/infra layer (OR-Tools, Timefold, PyOD, Nixtla, Novu, WatermelonDB, InvenTree, LlamaIndex). Plan accordingly: **borrow schemas & UX from the copyleft apps; borrow code from the permissive libraries.**

---

## OUTPUT 1 — Master Open-Source Landscape

Maturity key: **A** production-grade · **B** promising/worth studying · **C** early/experimental · **D** legacy-but-useful.
Action key: **Study** (patterns only) · **Adapt** (clean-room replicate) · **Library** (use as dependency) · **Integrate** (run alongside / API) · **Avoid-code** (license blocks copying).

| Domain | Project | URL | Maturity | License | SaaS-safe code? | Recommended action |
|---|---|---|---|---|---|---|
| **CMMS / Engineering / WO / PM** | Atlas CMMS (Grash) | github.com/Grashjs/cmms | A | GPL-3 | 🚫 | **Study/Adapt** — closest analog to our engineering module; steal data model + mobile WO UX |
| CMMS/EAM | openMAINT (CMDBuild) | openmaint.org · github.com/CMDBuild | A | AGPL | 🚫 | Study — asset hierarchy, meter/reading model |
| IT asset (adjacent) | Snipe-IT | github.com/snipe/snipe-it | A | AGPL-3 | 🚫 | Study — asset lifecycle, custom fieldsets, audit trail, QR/asset-tag UX |
| Field service | OCA `field_service` (Odoo) | github.com/OCA/field-service | A | LGPL-3 (per module) | ⚠️ lib-only | **Study/Integrate** — recurring orders, routes, service agreements, skills, stock-on-vehicle |
| Parts/inventory | **InvenTree** | github.com/inventree/InvenTree | A | **MIT** | ✅ | **Library/Adapt** — spare-parts stock, suppliers, reorder, stock movements, barcode. Best permissive parts model |
| Household/par-level inv | Grocy | github.com/grocy/grocy | A | **MIT** | ✅ | Adapt — par-level/min-stock + consumption + expiry logic (maps to amenities/linen) |
| Scheduling optimizer | **Timefold Solver** (OptaPlanner fork) | github.com/TimefoldAI/timefold-solver | A | **Apache-2.0** (Community) | ✅ | **Library** — employee rostering + task assignment constraint solver |
| Routing/assignment | **Google OR-Tools** | github.com/google/or-tools | A | **Apache-2.0** | ✅ | **Library** — CP-SAT + routing; housekeeper→room assignment, floor-walk minimization |
| Routing engine | VROOM | github.com/VROOM-Project/vroom | A | BSD-2 | ✅ | Library (heavier; OR-Tools usually enough) |
| Forecasting | **Nixtla StatsForecast / MLForecast** | github.com/Nixtla/statsforecast | A | **Apache-2.0** | ✅ | **Library** — occupancy→labor, consumption forecasting (AutoARIMA/ETS/MSTL) |
| Forecasting (legacy) | Prophet | github.com/facebook/prophet | A | MIT | ✅ | Library (simpler; Nixtla faster/better) |
| Anomaly detection | **PyOD** | github.com/yzhao062/pyod | A | BSD-2 | ✅ | **Library** — recurring-issue & operational anomaly detection (60+ detectors) |
| TS anomaly/RUL | Merlion | github.com/salesforce/Merlion | B | BSD-3 | ✅ | Library — asset failure/RUL, forecasting+AD in one |
| ML time-series | sktime | github.com/sktime/sktime | A | BSD-3 | ✅ | Library — unified TS API |
| Notifications | **Novu** | github.com/novuhq/novu | A | **MIT** | ✅ | **Library/Integrate** — multichannel (push/email/SMS/in-app) + preferences + digest + snooze |
| Knowledge/SOP | BookStack | github.com/BookStackApp/BookStack | A | **MIT** | ✅ | **Study/Adapt** — books→chapters→pages IA, permissions, WYSIWYG |
| Knowledge/SOP | Wiki.js | github.com/requarks/wiki | A | AGPL-3 | 🚫 | Study — versioning, pluggable search |
| Helpdesk (guest req) | Zammad | github.com/zammad/zammad | A | AGPL-3 | 🚫 | Study — SLA policies, triggers, escalation, macros, text modules |
| Helpdesk (omnichannel) | Chatwoot | github.com/chatwoot/chatwoot | A | **MIT** (core) | ✅ | **Study/Adapt** — shared inbox, canned responses, guest conversation model, WhatsApp/SMS |
| Helpdesk | osTicket | github.com/osTicket/osTicket | A(legacy) | GPL-2 | 🚫 | Study — SLA plans, help topics |
| Tasks/recurring | Vikunja | github.com/go-vikunja/vikunja | A | AGPL-3 | 🚫 | Study — recurrence, reminders, saved filters, multiple views |
| Tasks/PM | Plane | github.com/makeplane/plane | A | AGPL-3 | 🚫 | Study — cycles, modules, states, workload views |
| Kanban | Kanboard | github.com/kanboard/kanboard | D | MIT | ✅ | Adapt — automatic actions engine (rule → action) is a gem, but low activity |
| BI/analytics | Metabase | github.com/metabase/metabase | A | AGPL-3 (open core) | 🚫 | Study/Integrate — question/dashboard model, pulses, embedded analytics |
| BI/analytics | Apache Superset | github.com/apache/superset | A | **Apache-2.0** | ✅ | **Integrate/Adapt** — self-host for GM analytics; permissive |
| BI/analytics | Redash | github.com/getredash/redash | D | BSD-2 | ✅ | Study (maintenance mode since Databricks) |
| NL→SQL (analytics AI) | WrenAI | github.com/Canner/WrenAI | B | **Apache-2.0** (core) | ✅ | **Study/Library** — governed text-to-SQL "semantic layer" for GM NL querying |
| NL→SQL | Vanna | github.com/vanna-ai/vanna | B | MIT | ✅ (archived Mar 2026) | Study — RAG-on-schema NL2SQL pattern |
| IoT platform | ThingsBoard | github.com/thingsboard/thingsboard | A | Apache-2.0 (core) | ✅ | **Integrate** — telemetry ingest, rule chains, device mgmt for sensors |
| Building automation | OpenRemote | github.com/openremote/openremote | A | AGPL-3 | 🚫 | Study/self-host — smart-building + energy asset model |
| IoT/home | Home Assistant | github.com/home-assistant/core | A | Apache-2.0 | ✅ | Study — device integration breadth, automation UX |
| Flow automation | Node-RED | github.com/node-red/node-red | A | Apache-2.0 | ✅ | Integrate — event/sensor→action edge automation |
| AI orchestration | LangGraph | github.com/langchain-ai/langgraph | A | MIT | ✅ | **Library** — stateful multi-step agent graphs |
| RAG/data agents | LlamaIndex | github.com/run-llama/llama_index | A | MIT | ✅ | **Library** — retrieval, doc parsing (SOP RAG deepening) |
| RAG/search | Haystack | github.com/deepset-ai/haystack | A | Apache-2.0 | ✅ | Library — production RAG pipelines + eval |
| Offline-first (mobile) | **WatermelonDB** | github.com/Nozbe/WatermelonDB | A | **MIT** | ✅ | **Library** — offline SQLite + sync for Expo (housekeeper/engineer phones) |
| Offline sync (PG) | ElectricSQL | github.com/electric-sql/electric | B | Apache-2.0 | ✅ | Study/Library — Postgres→local sync (we're on Supabase/PG) |
| Offline sync | PowerSync | github.com/powersync-ja | B | mixed (some paid) | ⚠️ | Study — managed PG sync, conflict handling |
| Survey/feedback | Formbricks | github.com/formbricks/formbricks | A | AGPL-3 | 🚫 | Study — in-context micro-surveys, behavior triggers |
| Survey/feedback | LimeSurvey | github.com/LimeSurvey/LimeSurvey | A | GPL-2+ | 🚫 | Study — question logic depth |
| HR/attendance | Frappe HR | github.com/frappe/hrms | A | GPL-3 | 🚫 | Study — shift types, auto-attendance from check-in, roster, leave ledger |
| CRM (patterns) | Twenty | github.com/twentyhq/twenty | A | AGPL-3 | 🚫 | Study — modern object/field metadata engine, timeline UX |
| Chat/comms | Zulip | github.com/zulip/zulip | A | Apache-2.0 | ✅ | Study/Integrate — topic-threaded messaging (great for shift handover) |
| Chat/comms | Mattermost | github.com/mattermost/mattermost | A | AGPL-3 | 🚫 | Study — playbooks (runbook automation) |
| Hotel PMS | QloApps | github.com/Qloapps/QloApps | A | OSL-3.0 | 🚫 | Study — booking/room-type/rate data model |
| Hotel PMS | Kamra | kamrapms.com | B/C | AGPL-3 | 🚫 | Study — modern hotel+housekeeping+POS breadth |
| Hotel PMS | HotelDruid | hoteldruid.com | D | AGPL | 🚫 | Study only (dated) |
| Low-code (internal tools) | Appsmith | github.com/appsmithorg/appsmith | A | Apache-2.0 | ✅ | Integrate — build GM ops admin tools fast |
| Low-code | Budibase / ToolJet | github.com/Budibase · github.com/ToolJet | A | GPL-3 / AGPL-3 | 🚫 | Study/self-host |
| Restaurant POS | TastyIgniter | github.com/tastyigniter/TastyIgniter | B | MIT | ✅ | Study/Adapt — F&B POS/order model if hotel has restaurant |

---

## OUTPUT 2 — PatelRep Feature Gap Analysis (per module)

Format: **Have → best OSS reference → missing → recommended improvement → priority.**
Priorities: **P0** near-term high value · **P1** strong · **P2** later · **P3** interesting-not-now.

### Housekeeping / room assignment / prioritization
- **Have:** room_assignments, room_status, housekeeper rolling-avg clean time per room-type, readiness predictions (cron), breakout board with realtime, clean sessions with offline replay.
- **Best OSS refs:** OR-Tools / Timefold (assignment as optimization), AMIS housekeeping-scheduling research (metaheuristics), OCA hotel_housekeeping (history model).
- **Missing:** *optimized* assignment (today likely manual/heuristic drag-drop), travel/floor-walk minimization, credit/point-based workload balancing, checkout-priority sequencing driven by arrivals, cross-trained skill matching.
- **Recommend:** **P0** Add an "auto-assign / rebalance" button backed by OR-Tools CP-SAT (rooms × housekeepers with clean-time estimates, floor/section, checkouts-due-first, fairness). Keep it *one tap, human-overridable*. **P1** sequence a housekeeper's rooms to minimize floor changes and hit early-arrival checkouts first.

### Cleaning sessions & inspections
- **Have:** clean_sessions, cleaning_checklists, offline idempotent start/replay.
- **Best OSS refs:** OpenInspection (offline PWA inspection + photo + e-sign + report), SafetyCulture-style form model, Snipe-IT audit trail.
- **Missing:** structured **inspection scoring** (supervisor QA pass/fail %), photo-evidence per checklist item, rejection→re-clean loop with reason codes, room-condition history timeline.
- **Recommend:** **P0** supervisor inspection with per-item pass/fail + photo + auto re-open on fail; **P1** rolling "clean quality score" per housekeeper feeding coaching.

### Engineering / work orders
- **Have:** work_orders (transitions), escalation ladder + SLA, asset link, realtime board, downtime→revenue (management_roi), warranty field.
- **Best OSS refs:** Atlas CMMS, openMAINT, OCA field_service, Zammad (SLA/trigger engine).
- **Missing:** **spare-parts consumption on WO**, labor time capture, WO cost roll-up, failure/problem/cause codes, MTTR/MTBF, recurring-failure detection, vendor/contractor assignment on WO.
- **Recommend:** **P0** parts + labor + cost on the WO close screen (needs inventory, below). **P1** failure-code taxonomy → recurring-issue detection (PyOD/simple counts). **P1** MTTR/MTBF per asset in analytics.

### Asset management
- **Have:** assets.py with warranty_expires; failure predictions service.
- **Best OSS refs:** openMAINT (asset hierarchy + meters), Snipe-IT (asset tags/QR, custom fields, audit), InvenTree (stock/asset crossover).
- **Missing:** **asset hierarchy/location tree**, **meter readings** (runtime hours, filter cycles), maintenance history rollup, QR asset tags, criticality ranking, downtime-per-asset.
- **Recommend:** **P0** QR asset tag → scan on phone opens asset (history + "log issue"). **P1** meter readings to drive usage-based PM. **P2** parent/child asset hierarchy.

### Preventive maintenance
- **Have:** pm.check-due cron.
- **Best OSS refs:** Atlas CMMS PM templates, OCA field_service recurring orders.
- **Missing:** **PM templates/plans** (task lists per asset class), calendar *and* meter-based triggers, PM compliance % KPI, auto-generated WOs from PM plan.
- **Recommend:** **P0** PM template library + auto-WO generation; **P1** meter-triggered PM; **P1** PM-compliance dashboard for GM.

### Predictive maintenance
- **Have:** ai.failure-predictions cron (asset failure predictions).
- **Best OSS refs:** Merlion, PyOD, NASA C-MAPSS RUL repos (patterns), LangGraph PdM agent examples.
- **Missing:** sensor/telemetry ingest (no IoT), model transparency ("why flagged"), tie prediction→auto-PM-WO.
- **Recommend:** **P1** turn a prediction into a proposed WO with one tap; **P2** optional ThingsBoard sensor ingest for HVAC/boilers (pilot). Don't over-engineer ML without data volume.

### Tasks & recurring tasks
- **Have:** tasks.py, NL→task parsing (gpt-4o-mini).
- **Best OSS refs:** Vikunja (recurrence/reminders/filters), Kanboard (automatic-actions rules engine).
- **Missing:** robust **recurrence rules**, task templates, dependency/blocking, saved smart filters, rules engine (event→auto-create task).
- **Recommend:** **P0** recurrence + templates; **P1** a lightweight rules engine ("on checkout status X → create task Y") — study Kanboard's action model.

### SLA / escalation
- **Have:** escalations.check ladder (WO/task SLA + DND welfare), escalation_level (migration 041).
- **Best OSS refs:** Zammad SLA policies + trigger/scheduler engine, osTicket SLA plans, Mattermost Playbooks.
- **Missing:** **configurable per-type SLA policies** (business hours/calendars), pause-on-hold, breach analytics, multi-tier notify targets.
- **Recommend:** **P1** GM-configurable SLA matrix (type × priority → response/resolve targets, business calendar). **P2** breach analytics.

### Staff / scheduling / attendance
- **Have:** staff.py, shifts.py, scheduling.py, staff_role_schedules (027), custom_roles.
- **Best OSS refs:** Frappe HR (auto-attendance from check-in, shift types, roster, leave ledger), Timefold (roster optimization).
- **Missing:** **attendance / clock-in-out**, labor-hours vs budget, availability & time-off, occupancy-driven labor forecasting, auto-roster generation.
- **Recommend:** **P0** simple mobile clock-in/out + hours; **P1** occupancy→labor forecast (Nixtla) → suggested staffing; **P2** Timefold auto-roster.

### Guest requests / service recovery
- **Have:** guest_requests.py (kanban spec), guest_recovery/contracts.py, realtime service-recovery alerts, late_checkout.
- **Best OSS refs:** Chatwoot (omnichannel inbox, canned responses), Zammad (triggers/SLA), Formbricks (post-stay micro-survey).
- **Missing:** **two-way guest messaging** (SMS/WhatsApp) linked to request, canned/AI-suggested replies, guest-request→WO auto-bridge, satisfaction capture at close.
- **Recommend:** **P0** guest request → engineering WO one-tap bridge (see cross-module flow); **P1** SMS/WhatsApp updates to guest via Novu/Twilio; **P1** AI-suggested reply from SOP.

### SOP / knowledge management
- **Have:** sop.py + RAG (match_sop_chunks, claude-sonnet), ai_copilot.
- **Best OSS refs:** BookStack (IA + permissions), LlamaIndex/Haystack (better retrieval+eval), Wiki.js (versioning).
- **Missing:** structured SOP authoring (versioning, approval, acknowledgment), citation-grounded answers with links, retrieval eval, multilingual SOP.
- **Recommend:** **P1** cited answers (link back to SOP page/section); **P1** SOP versioning + acknowledgment (ties to evidence/training); **P2** upgrade retrieval with LlamaIndex hybrid + reranking.

### Training
- **Have:** safety.training-assignments cron.
- **Best OSS refs:** Frappe HR training, evidence/acknowledgment patterns.
- **Missing:** micro-training tied to SOP, quiz/attestation, completion tracking, role-based curricula.
- **Recommend:** **P2** SOP→micro-lesson→attest, completion dashboard.

### Safety / compliance / evidence / document control
- **Have:** safety.py, evidence.py (controlled-doc ack, reminders), drill follow-up, escalation.
- **Best OSS refs:** Snipe-IT audit trail, OpenInspection e-sign reports, SafetyCulture corrective-action model.
- **Missing:** corrective-action (CAPA) tracking, immutable audit export, inspection→corrective-task loop, compliance calendar.
- **Recommend:** **P1** CAPA loop (finding→task→verify→close with evidence); **P2** compliance calendar + export pack.

### Logbook / shift handover
- **Have:** logbook.py, logbook.shift-summary cron (AI summaries), cleanup/retention.
- **Best OSS refs:** Zulip (topic threads), Mattermost Playbooks, Zammad text-modules.
- **Missing:** structured handover template (open WOs, VIPs, pending), acknowledgment of handover, pass-down continuity across shifts.
- **Recommend:** **P1** AI shift-handover brief auto-composed from open WOs/tasks/guest issues + next-shift acknowledgment. (Strong AI-native win.)

### Lost & found
- **Have:** lost_found.py, retention-check cron, contact (033).
- **Best OSS refs:** general inventory + Chatwoot (guest comms).
- **Missing:** photo capture, guest-claim matching, shipping/disposition workflow, QR bin labels.
- **Recommend:** **P2** photo + claim-match + disposition; low complexity, guest-delight.

### Guest feedback
- **Have:** feedback.py.
- **Best OSS refs:** Formbricks (triggered micro-surveys), LimeSurvey (logic).
- **Missing:** post-stay/post-request trigger, sentiment tagging, feedback→service-recovery auto-alert, trend analytics.
- **Recommend:** **P1** negative feedback → auto service-recovery alert + task; sentiment via AI.

### Inventory / purchasing / linen & laundry / parts / vendor  ← **biggest structural gap**
- **Have:** *nothing dedicated* (no inventory/parts/procurement/linen/vendor router).
- **Best OSS refs:** **InvenTree (MIT — copyable)**, Grocy (MIT — par-level/consumption), OCA purchase/stock, Snipe-IT (consumables).
- **Missing:** everything — stock items, par/min levels, consumption logging, reorder alerts, purchase orders, vendor records, linen-par & laundry cycle, spare-parts tied to WOs.
- **Recommend:** **P0** minimal inventory core adapted from InvenTree/Grocy patterns: items, par level, consume-on-use, low-stock alert (Novu). **P1** parts↔WO consumption. **P1** vendor records reused by WO + PO. **P2** linen par + laundry loop. **P2** lightweight PO/approval.

### Reporting / operational analytics / management dashboards
- **Have:** reports.py, management_roi (downtime→revenue), daily GM summary email.
- **Best OSS refs:** Metabase/Superset (dashboards), WrenAI (NL analytics), Grafana (ops monitoring).
- **Missing:** self-serve exploration, NL querying of ops data, benchmark trends, mobile GM "one-glance" brief.
- **Recommend:** **P0** AI-generated daily/shift GM brief (what happened, exceptions, what needs you) — extend existing summary; **P1** NL analytics ("how many AC WOs on floor 3 last month?") via WrenAI semantic layer; **P2** self-host Superset for power users.

### Multi-property management
- **Have:** multi-tenant (hotel_id scoping) but single-property operator focus.
- **Best OSS refs:** ERPNext multi-company, OCA multi-company.
- **Missing:** portfolio roll-up dashboard, cross-property benchmarking, shared vendor/SOP libraries, group roles.
- **Recommend:** **P2** portfolio view for small owner groups (Texas hotel owners often run 2–5 properties) — strong differentiation for the target market.

### Integrations — PMS / POS / IoT / energy
- **Have:** Opera Cloud (feature-flagged), integrations.py, OHIP reference.
- **Best OSS refs:** ThingsBoard/Node-RED (IoT), Home Assistant, OpenRemote (energy).
- **Missing:** POS integration, IoT/BMS ingest, energy metering, generic PMS webhook layer beyond Opera.
- **Recommend:** **P1** occupancy/arrivals feed from PMS drives assignment+labor (works with Opera flag off using our own data). **P2** IoT pilot (ThingsBoard) for HVAC. **P3** energy management.

### QR/barcode · offline · notifications · comms
- **Have:** partial offline (clean sessions replay), notifications.py (push/in-app).
- **Best OSS refs:** Snipe-IT (asset QR), WatermelonDB (offline), Novu (notifications), Zulip (comms).
- **Missing:** pervasive QR (room/asset/bin scan → context), full offline write-queue on mobile, notification preferences/digest/snooze, structured internal comms/handover.
- **Recommend:** **P0** QR-everywhere (room door, asset, closet) → phone opens the right screen; **P0** harden offline write-queue via WatermelonDB; **P1** Novu-style preferences/digest; **P1** topic-threaded internal comms.

### AI copilot / RAG / agents / forecasting / optimization / CV / voice
- **Have:** NL→task (gpt-4o-mini), SOP RAG (claude-sonnet), readiness + failure predictions, AI shift summaries, credit accounting.
- **Best OSS refs:** LangGraph (agents), LlamaIndex/Haystack (RAG+eval), Nixtla (forecast), OR-Tools/Timefold (optimize), PyOD (anomaly), WrenAI (NL analytics).
- **Missing:** *proactive* agents (not just Q&A), optimization-backed suggestions, NL analytics, cited RAG, anomaly-driven alerts, (later) photo CV for room checks, voice input for hands-busy staff.
- **Recommend:** **P0** proactive "morning brief" + exception alerts (agentic); **P0** assignment/labor optimization surfaced as suggestions; **P1** NL ops querying; **P1** cited SOP answers; **P2** voice-to-task for housekeepers; **P3** CV room-photo QA.

---

## Cross-module opportunities — where PatelRep beats every generic tool

Generic OSS gives you *one* silo well (a CMMS, a helpdesk, an inventory app). PatelRep's unfair advantage is **stitching them into one hotel-native flow on one phone.** These are the highest-differentiation bets:

**1. The "guest AC complaint" superflow (your example — build it end-to-end).**
Guest request → auto-identify room+guest (from PMS/room map) → one-tap create engineering WO → SLA clock starts → asset auto-linked → repair history + last parts shown to engineer → part consumed decrements inventory → room readiness recalculated → front desk + guest notified (Novu/SMS) → if VIP or repeat issue, service-recovery risk flag to manager → analytics logs total downtime, MTTR, parts cost, revenue impact.
*No single OSS project does this. Snipe-IT+Zammad+InvenTree+Metabase would each own a fragment; PatelRep owns the whole loop.* **P0.**

**2. Occupancy-driven operations autopilot.**
Tonight's arrivals/checkouts (PMS or our data) → Nixtla forecast of tomorrow's cleaning load → OR-Tools/Timefold suggests housekeeper assignment + count → labor-hours vs budget shown → low-stock amenities auto-flagged for reorder. One screen, one "approve" tap. **P0/P1.**

**3. Recurring-issue radar.**
Every WO/guest-request/failure-code streamed into PyOD/simple frequency detection → "Room 214 AC: 3rd WO in 30 days — replace vs repair?" → proposes capital task + shows cost history. Turns reactive maintenance into a data-driven decision. **P1.**

**4. AI shift-handover + morning brief.**
At shift change, auto-compose: open WOs, rooms not ready, VIP arrivals, pending guest issues, low stock, SLA breaches — next shift acknowledges. GM gets the same as a 30-second morning brief. Extends your existing logbook AI summary into the single most-used AI surface. **P0.**

**5. QR as the universal entry point.**
One sticker system: door QR → room status/checklist; asset QR → history/log-issue; closet QR → inventory count. Removes typing/searching on the phone — the purest expression of your product principle. **P0.**

---

## OUTPUT 3 — Top 50 Opportunities (ranked)

Ranked by staff-time saved / ops impact, not tech novelty. Complexity: **S** small · **M** medium · **L** large.

| # | Feature | Problem solved | Role helped | OSS inspiration | Complexity | Hotel value | Differentiation | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | Guest-request→WO one-tap bridge | Duplicate entry, dropped issues | Front desk, engineer | Zammad triggers | M | Very high | High | P0 |
| 2 | AI shift-handover + GM morning brief | Info lost at shift change | All + GM | Mattermost Playbooks, Zulip | M | Very high | High | P0 |
| 3 | QR-everywhere entry points | Typing/searching on phone | HK, engineer | Snipe-IT asset tags | M | Very high | Med | P0 |
| 4 | Inventory core (items/par/consume/low-stock) | No supply visibility, stockouts | HK, engineer, GM | InvenTree (MIT), Grocy (MIT) | L | Very high | Med | P0 |
| 5 | One-tap auto-assign/rebalance rooms | Manual assignment guesswork | Supervisor | OR-Tools, Timefold | M | Very high | High | P0 |
| 6 | Supervisor inspection w/ photo + re-clean loop | No QA accountability | Supervisor, HK | OpenInspection, SafetyCulture | M | High | Med | P0 |
| 7 | Parts + labor + cost on WO close | No maintenance cost visibility | Engineer, GM | Atlas CMMS, InvenTree | M | High | Med | P0 |
| 8 | Occupancy→labor forecast + staffing suggestion | Over/under-staffing | GM, supervisor | Nixtla StatsForecast | M | Very high | High | P0/P1 |
| 9 | Proactive exception alerts (agentic) | GM digging through reports | GM | LangGraph | M | High | High | P0 |
| 10 | Mobile clock-in/out + hours vs budget | No labor tracking | GM, supervisor | Frappe HR | M | High | Med | P0 |
| 11 | Recurring-failure detection | Repeat breakdowns unnoticed | Engineer, GM | PyOD, Merlion | S | High | High | P1 |
| 12 | PM templates + auto-WO generation | Manual PM, missed service | Engineer | Atlas CMMS, OCA field_service | M | High | Med | P1 |
| 13 | Failure/cause code taxonomy on WO | No root-cause data | Engineer | openMAINT | S | Med | Med | P1 |
| 14 | MTTR/MTBF + downtime-per-asset analytics | No reliability metrics | GM | CMMS standard | S | Med | Med | P1 |
| 15 | Two-way guest SMS/WhatsApp on request | Manual calls, no updates | Front desk | Chatwoot, Novu | M | High | Med | P1 |
| 16 | AI-suggested guest replies from SOP | Slow/inconsistent responses | Front desk | Chatwoot + LlamaIndex | M | Med | Med | P1 |
| 17 | Cited SOP answers (link to source) | Trust/verification of AI | All | LlamaIndex/Haystack | S | Med | Med | P1 |
| 18 | Recurrence rules + task templates | Manual recurring tasks | All | Vikunja | S | High | Low | P0/P1 |
| 19 | Event→task rules engine | Manual task creation | Supervisor | Kanboard actions | M | Med | Med | P1 |
| 20 | Configurable SLA matrix + business calendar | One-size SLA | GM | Zammad, osTicket | M | Med | Med | P1 |
| 21 | Room sequencing (floor-walk minimization) | Wasted HK walking | HK | OR-Tools routing | M | Med | High | P1 |
| 22 | Negative feedback→auto service recovery | Complaints slip away | GM, front desk | Formbricks | S | High | Med | P1 |
| 23 | Vendor records reused by WO + PO | Scattered contacts | Engineer, GM | OCA purchase | S | Med | Low | P1 |
| 24 | Meter readings→usage-based PM | Time-only PM wastes effort | Engineer | openMAINT | M | Med | Med | P1 |
| 25 | NL analytics ("how many AC WOs floor 3?") | Reports too slow | GM | WrenAI (Apache) | L | High | High | P1 |
| 26 | Hardened offline write-queue (mobile) | Dead zones lose data | HK, engineer | WatermelonDB | L | High | Med | P1 |
| 27 | Notification preferences/digest/snooze | Alert fatigue | All | Novu | M | Med | Low | P1 |
| 28 | Prediction→proposed WO one tap | Predictions ignored | Engineer | — (internal) | S | Med | Med | P1 |
| 29 | Topic-threaded internal comms | Scattered chatter | All | Zulip | M | Med | Med | P1 |
| 30 | CAPA loop (finding→task→verify→close) | Compliance gaps | GM, safety | SafetyCulture | M | Med | Med | P1 |
| 31 | SOP versioning + acknowledgment | Stale/unread SOPs | GM, staff | BookStack, Wiki.js | M | Med | Med | P1 |
| 32 | Room-condition history timeline | No damage/issue history | HK, engineer | Snipe-IT audit | S | Med | Med | P2 |
| 33 | Linen par + laundry cycle tracking | Linen shortages/loss | HK, laundry | Grocy | M | Med | Med | P2 |
| 34 | Lightweight PO + approval | Uncontrolled spend | GM | OCA purchase | M | Med | Low | P2 |
| 35 | Asset hierarchy / location tree | Poor asset organization | Engineer | openMAINT | M | Low | Low | P2 |
| 36 | Portfolio/multi-property roll-up | Owner-group blind spots | Owner/GM | ERPNext multi-company | L | High | High | P2 |
| 37 | Voice-to-task for hands-busy HK | Typing infeasible mid-task | HK | Whisper (MIT) | M | Med | High | P2 |
| 38 | PM compliance % dashboard | No PM adherence view | GM | CMMS standard | S | Med | Low | P2 |
| 39 | Lost&found photo + claim match | Slow guest resolution | Front desk | inventory + CV | S | Med | Med | P2 |
| 40 | Post-stay micro-survey triggers | Low feedback volume | GM | Formbricks | S | Med | Low | P2 |
| 41 | Self-host Superset for power analytics | Ad-hoc deep analysis | GM/analyst | Superset (Apache) | M | Med | Low | P2 |
| 42 | IoT HVAC sensor pilot | Reactive HVAC failures | Engineer | ThingsBoard | L | Med | High | P2 |
| 43 | Skill/cross-training matching in assign | Wrong person, rework | Supervisor | OCA skills, Timefold | M | Med | Med | P2 |
| 44 | Micro-training SOP→attest | Onboarding/compliance | GM, staff | Frappe HR | M | Low | Low | P2 |
| 45 | Consumables reorder automation | Manual reordering | HK, GM | Grocy min-stock | S | Med | Low | P2 |
| 46 | POS integration (F&B charges/tasks) | Restaurant ops siloed | GM | TastyIgniter | L | Low | Med | P3 |
| 47 | Energy management dashboard | Utility cost blind | GM | OpenRemote | L | Low | Med | P3 |
| 48 | CV room-photo QA | Automated clean check | Supervisor | vision models | L | Low | High | P3 |
| 49 | Predictive RUL models (sensor-based) | Advanced PdM | Engineer | Merlion, C-MAPSS | L | Low (no data yet) | High | P3 |
| 50 | Guest-facing request portal/app | Self-service requests | Guest/front desk | Chatwoot widget | L | Med | Med | P3 |

---

## OUTPUT 4 — Recommended Research / Implementation Roadmap (opinionated)

### Top 10 projects to dissect FIRST (and why)
1. **InvenTree (MIT)** — your single biggest gap is inventory/parts; this is the best *copyable* data model (items, stock, suppliers, reorder, barcode). Study its schema before designing yours.
2. **Atlas CMMS / Grash (GPL-3, study-only)** — the closest full analog to your engineering module; mine its WO/PM/asset UX and mobile flow, then clean-room it.
3. **Google OR-Tools (Apache-2.0)** — the engine for room assignment + labor + sequencing; prototype CP-SAT on your real room/housekeeper data.
4. **Timefold Solver (Apache-2.0)** — if OR-Tools modeling gets heavy, Timefold's employee-rostering quickstart is a faster on-ramp; both are permissive.
5. **Nixtla StatsForecast (Apache-2.0)** — occupancy→labor and consumption forecasting with almost no ML overhead; fast, accurate, permissive.
6. **Novu (MIT)** — replace/augment ad-hoc notifications with a real multichannel + preferences + digest engine; directly usable.
7. **WatermelonDB (MIT)** — the offline-first backbone your housekeeper/engineer phones need in hotel dead zones.
8. **Chatwoot (MIT core)** — the guest-conversation + canned-response + shared-inbox model to adapt for guest requests/service recovery.
9. **Zammad (AGPL, study-only)** — the best SLA-policy + trigger + escalation engine to learn from for your escalation module.
10. **WrenAI (Apache-2.0 core)** — the governed NL-to-SQL "semantic layer" pattern for GM natural-language analytics without hallucinated SQL.

### Top 10 features to prototype (fastest path to value)
1. Guest-request → engineering WO one-tap bridge (cross-module flow #1).
2. AI shift-handover brief + GM morning brief (extend logbook AI summary).
3. QR entry points for room + asset (open right screen on scan).
4. Inventory MVP: items + par level + consume-on-use + low-stock alert.
5. One-tap auto-assign/rebalance rooms (OR-Tools, human-overridable).
6. Parts + labor + cost capture on WO close.
7. Occupancy→labor forecast with a suggested staffing number.
8. Recurring-failure radar ("3rd WO in 30 days" nudge).
9. Recurrence rules + task templates for tasks.
10. Negative-feedback → auto service-recovery alert + task.

### Top 10 longer-term bets
1. NL analytics for GMs (WrenAI semantic layer over ops data).
2. Full offline-first mobile write-queue (WatermelonDB) across all mobile flows.
3. Portfolio/multi-property roll-up for small owner groups (Texas-market differentiator).
4. Meter-based + template-driven PM program with compliance KPI.
5. IoT HVAC/boiler sensor pilot (ThingsBoard) feeding real predictive maintenance.
6. Timefold auto-roster generation from availability + demand.
7. Voice-to-task for hands-busy housekeepers (Whisper).
8. Vendor + PO + approval layer reused across engineering & inventory.
9. Linen par + laundry-cycle management.
10. CAPA/compliance program with immutable evidence export.

### Top 10 things to DELIBERATELY NOT build (avoid bloat)
1. **A full PMS / booking engine / channel manager** — QloApps/Kamra own this; integrate, don't rebuild. You are the *ops copilot*, not the reservation system.
2. **A general-purpose ERP / accounting** — ERPNext territory; out of scope for the phone-first floor worker.
3. **A generic project-management suite** (Gantt, sprints, portfolios) — Plane/Vikunja territory; hotel staff need "do this room," not epics.
4. **A full omnichannel CRM** — Twenty/Chatwoot territory; only the thin guest-conversation slice you need.
5. **A standalone BI studio** with dashboard-builder UI — don't out-Metabase Metabase in-app; embed/self-host Superset for the rare power user, keep AI briefs for everyone else.
6. **A general workflow-automation canvas** (n8n/Node-RED-style visual builder) exposed to hotel staff — too complex for the phone; keep automation opinionated and hotel-specific.
7. **Heavy predictive ML before you have sensor/volume data** — a 50–150 room hotel won't feed RUL models; use simple frequency/anomaly nudges until IoT exists.
8. **A full LMS** — training should be micro-lessons tied to SOPs, not a course platform.
9. **Deep multi-language SOP authoring/translation memory tooling** — use LLM translation on read, don't build a localization CMS.
10. **Guest-facing super-app / loyalty / marketing** — stay on the *staff-time / operations* side of your product principle; guest touchpoints only where they close an ops loop (status update, feedback).

---

## Skeptic's notes (so you can trust/verify this)
- The polished hotel/CMMS/CRM systems are overwhelmingly **GPL/AGPL/OSL** — treat them as *design references*, and verify each module's license in its own manifest (OCA modules vary per-module even inside an AGPL repo).
- I excluded the sea of student "hotel management system" repos; none added unique capability over the projects listed.
- **License spot-checks to do before any code reuse:** confirm VROOM (BSD-2), InvenTree (MIT), Novu (MIT), WatermelonDB (MIT), OR-Tools/Timefold-Community/Superset/StatsForecast/ThingsBoard-core/Haystack/WrenAI-core (Apache-2.0), PyOD/Merlion (BSD). These are the ones you'd actually link into the product — re-verify the LICENSE file at integration time.
- Vanna is archived (Mar 2026) and Redash is in maintenance mode — study, don't depend.
- n8n is **fair-code, not OSI open source** — fine for internal automation, not for embedding as a product feature.

### Key source links
- CMMS/eng: [Atlas/Grash CMMS](https://github.com/Grashjs/cmms) · [openMAINT](https://www.openmaint.org/) · [Snipe-IT](https://github.com/snipe/snipe-it) · [OCA field-service](https://github.com/OCA/field-service) · [OCA vertical-hotel](https://github.com/OCA/vertical-hotel)
- Inventory: [InvenTree](https://github.com/inventree/InvenTree) · [Grocy](https://github.com/grocy/grocy)
- Optimization: [Timefold Solver](https://github.com/TimefoldAI/timefold-solver) · [OR-Tools](https://github.com/google/or-tools) · [VROOM](https://github.com/VROOM-Project/vroom) · [housekeeping scheduling paper (AMIS)](https://www.sciencedirect.com/science/article/pii/S2199853125000228)
- Forecast/anomaly: [Nixtla StatsForecast](https://github.com/Nixtla/statsforecast) · [Prophet](https://github.com/facebook/prophet) · [PyOD](https://github.com/yzhao062/pyod) · [Merlion](https://github.com/salesforce/Merlion) · [sktime](https://github.com/sktime/sktime)
- Notifications/comms: [Novu](https://github.com/novuhq/novu) · [Zulip](https://github.com/zulip/zulip) · [Mattermost](https://github.com/mattermost/mattermost)
- Helpdesk/guest: [Chatwoot](https://github.com/chatwoot/chatwoot) · [Zammad](https://github.com/zammad/zammad) · [osTicket](https://github.com/osTicket/osTicket) · [Formbricks](https://github.com/formbricks/formbricks)
- Knowledge/SOP: [BookStack](https://github.com/BookStackApp/BookStack) · [Wiki.js](https://github.com/requarks/wiki)
- Tasks: [Vikunja](https://github.com/go-vikunja/vikunja) · [Plane](https://github.com/makeplane/plane) · [Kanboard](https://github.com/kanboard/kanboard)
- HR/attendance: [Frappe HR](https://github.com/frappe/hrms)
- BI/NL analytics: [Metabase](https://github.com/metabase/metabase) · [Superset](https://github.com/apache/superset) · [Redash](https://github.com/getredash/redash) · [WrenAI](https://github.com/Canner/WrenAI) · [Vanna](https://github.com/vanna-ai/vanna)
- IoT/energy: [ThingsBoard](https://github.com/thingsboard/thingsboard) · [OpenRemote](https://github.com/openremote/openremote) · [Home Assistant](https://github.com/home-assistant/core) · [Node-RED](https://github.com/node-red/node-red)
- AI/RAG/agents: [LangGraph](https://github.com/langchain-ai/langgraph) · [LlamaIndex](https://github.com/run-llama/llama_index) · [Haystack](https://github.com/deepset-ai/haystack)
- Offline: [WatermelonDB](https://github.com/Nozbe/WatermelonDB) · [ElectricSQL](https://github.com/electric-sql/electric)
- Inspection: [OpenInspection](https://github.com/InspectorHub/OpenInspection)
- Hotel PMS: [QloApps](https://github.com/Qloapps/QloApps) · [Kamra](https://kamrapms.com/) · [HotelDruid](https://www.hoteldruid.com/)
- CRM/low-code: [Twenty](https://github.com/twentyhq/twenty) · [Appsmith](https://github.com/appsmithorg/appsmith) · [Budibase](https://github.com/Budibase/budibase) · [ToolJet](https://github.com/ToolJet/ToolJet)
