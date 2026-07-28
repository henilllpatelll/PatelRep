# Phase 6: PMS and AI expansion - Research

**Researched:** 2026-07-28
**Domain:** Audit-first verification/hardening of already-shipped AI copilot expansion (FastAPI + GPT-4o-mini/Claude Sonnet) and Opera PMS/OHIP integration (FastAPI + Oracle OHIP REST + webhooks), against existing PatelRep RBAC/tenant-isolation/credit-accounting conventions.
**Confidence:** HIGH (all core findings verified by direct code read of the actual shipped implementation, not from the backlog docs)

## Summary

This is not a build phase — it is an audit of code already live in production since commit `e4ac615a` (2026-05-22). Direct reads of every canonical-ref file surfaced concrete, code-verified findings that go beyond what 06-CONTEXT.md anticipated:

1. **D-02's suspicion is confirmed and precisely located.** `apps/api/middleware/credits.py::check_and_deduct_credits()` charges a **flat, per-interaction-type cost** (`CREDIT_COSTS` dict, e.g. `task_creation: 1.0`, `sop_query: 2.0`) that is completely disconnected from the real `prompt_tokens`/`completion_tokens` the LLM call actually used. Real token counts ARE captured and passed around (`parse_work_orders`, `parse_nl_tasks`, `query_sop`, `generate_gm_insights` all return real usage) and ARE written to `ai_interactions.prompt_tokens`/`completion_tokens` — but the **billable credit amount** never derives from them. This is the literal violation of CLAUDE.md A3 ("log actual token usage from API responses — never fixed costs") and it is the mechanism the Stripe monthly true-up (`credit_ledger.credits_used`, incremented by the fixed amount via `increment_credits_used` RPC) is built on.
2. **A second, independent bug in the same code path**: `services/ai/sop_rag.py::query_sop()` unconditionally writes its own `ai_interactions` row (hardcoded `credits_charged=2.0`) at the end of every call, and `ai_copilot.py`'s `sop_query` branch in `/copilot/chat` **also** writes a second `ai_interactions` row after calling `check_and_deduct_credits()`. Every SOP question asked through the copilot chat UI therefore double-writes the audit trail. Confirmed this does **not** double-bill Stripe (billing reads `credit_ledger.credits_used`, not `ai_interactions`), but it does corrupt anything that aggregates `ai_interactions` — including the GM-facing "AI credits used (7d)" insight stat in `services/ai/insights.py`.
3. **Opera webhook signature verification is verifying the wrong secret.** `apps/api/routers/webhooks.py::_verify_opera_signature()` derives its HMAC key from `CRON_SECRET + hotel_id` — an internal secret never shared with Oracle. The schema (`opera_credentials.webhook_secret`, migration 002) already has a dedicated per-hotel column explicitly commented `"HMAC secret for validating Opera webhooks"` that the verification code does not use. As implemented, this check can never validate an authentic Oracle-signed payload; it can only validate payloads forged by someone who also knows `CRON_SECRET`. This is a real, code-verified security/architecture defect matching the class of bug D-05 requires fixing in-phase.
4. **No pilot-flag mechanism exists anywhere in the schema.** `tenants` (migration 002) has no pilot/beta/enrollment column, and no `pilot_features`-style table exists. D-03 must be built from scratch; the codebase's own boolean-flag convention (`tenants.is_active`, `opera_credentials.is_connected`) points toward a single `tenants.opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE` column as the lowest-friction, most-consistent option (see Architecture Patterns).
5. **Test coverage is not zero — it is narrow.** Contrary to 06-CONTEXT.md's blanket "zero test coverage" framing, four existing test files already cover slices of this surface: `test_integrations_security.py` (opera_connect encryption + error handling), `test_sop_security.py` (SOP upload validation, a `routers/sop.py` file adjacent to but outside D-01's audit scope), `test_ai_assignment_confirm.py` (confirm_assignments happy paths), `test_ai_provider_configuration.py` (missing-API-key safe errors). None of the four cover RBAC (403 per role), tenant isolation (cross-hotel 404 + zero writes), or credit-accounting/audit-reconstruction — which is exactly the D-06 gap. The planner should extend, not duplicate, these four files, and follow their established test pattern (see Architecture Patterns).

**Primary recommendation:** Structure the phase as two audit slices (AI copilot, Opera) each opening with a Phase-4-04-01-style S0 foundation task — stand up/extend the route-test harness first (RED state encoding the correct RBAC/tenant/credit contracts), then land the fixes for the four concrete findings above, then prove them GREEN, then add the pilot-flag mechanism as a focused Opera-only slice.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Audit scope = AI copilot expansion intents (task_creation, work_order_creation, guest_request_creation, task_assignment, ambiguous, sop_query) in `apps/api/routers/ai_copilot.py` + their parsers in `apps/api/services/ai/` + the frontend `AICopilotBubble.tsx`, **plus** the adjacent `insight_query`/`generate_gm_insights` endpoints (same router, same credit-deduction middleware, same RBAC surface — cheap to include, closes a real gap) **plus** all 7 Opera endpoints in `apps/api/routers/integrations.py` + `apps/api/services/opera/`.
- **D-02:** `apps/api/middleware/credits.py` (the AI credit-gate middleware) is explicitly in scope for its own audit pass — verify it satisfies CLAUDE.md's A3 contract (logs actual token usage from API responses, never fixed cost estimates) rather than only being exercised incidentally through the copilot/insights endpoints.
- **D-03:** Opera PMS integration gets a **real hotel-level pilot flag** (new column/table, e.g. on `tenants` or a dedicated `pilot_features` table — pattern TBD by planner) scoping Opera connect/sync/webhooks to explicitly enrolled pilot hotels only. This directly resolves CLAUDE.md's stale "feature-flagged for pilot" claim by making it true.
- **D-04:** AI copilot expansion (work orders/guest requests/assignments/fast-path/SOP Q&A/insights) stays **ungated** — no new flag. It is self-contained within a tenant's own data (doesn't touch an external system), so the audit's job is to verify RBAC/tenant-isolation/credit-cap correctness for its current all-hotels-live state, not to gate it further.
- **D-05:** Any real bug found during the audit (security, tenant-isolation, RBAC gap — the class of issue Phase 2 hit with the SECURITY DEFINER grant fix in migration 079, or Phase 3's bug-449 maybe_single() None-handling fix) is **fixed immediately within this same phase**, atomically with the audit that found it. Do not file-and-defer to a follow-up phase.
- **D-06:** Full Phase 1–5 rigor is the bar for **both** surfaces: RBAC tests (per-role 403 checks), tenant-isolation tests (cross-hotel access returns 404/empty, zero cross-tenant writes), audit-reconstruction/credit-accounting tests (verify `ai_interactions` logs real token counts per CLAUDE.md A3), and a live authenticated E2E browser walkthrough on localhost per the Self-Verification Policy in CLAUDE.md. This is a deliberate step up from Phase 4's narrower "lighter smoke pass" option — the user explicitly chose full rigor for both AI copilot and Opera rather than a tiered approach, since currently there is zero coverage for either.

### Claude's Discretion

- Exact shape of the pilot-flag mechanism (single boolean column vs. richer `pilot_features` table vs. reuse of an existing settings pattern) — planner/researcher to decide based on codebase conventions. **Researcher's recommendation: single `tenants.opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE` column — see Architecture Patterns.**
- Whether audit findings warrant new migrations vs. code-only fixes — depends on what's actually found. **This research found one migration-worthy item (pilot flag column) and multiple code-only fixes (credit accounting, double-logging, webhook signature) — see Common Pitfalls and Don't Hand-Roll.**
- Ordering of AI-copilot-audit vs. Opera-audit within the phase's wave structure.

### Deferred Ideas (OUT OF SCOPE)

- New AI/PMS capabilities beyond what's shipped — explicitly deferred by the user's "audit-first" scope choice.
- Mobile voice input parity/testing — already code-complete (`expo-speech-recognition` in `apps/mobile`) but mobile work remains parked project-wide.
- Formal "two successful pilot hotels" business criteria — this phase builds the *mechanism* (Opera pilot flag) but does not define or track the business-side pilot success metrics themselves.

## Project Constraints (from CLAUDE.md)

- **Multi-tenancy:** every Supabase query must scope `.eq("hotel_id"/"tenant_id", user.hotel_id)`. RLS is a second layer, not a substitute — confirmed the backend Supabase client always authenticates as `service_role` (`apps/api/core/database.py`), so RLS never actually applies to backend-issued queries; the in-handler `.eq(...)` filter is the *only* real tenant boundary for this code.
- **AI credit accounting (A3):** "log actual token usage from API responses — never fixed costs." **Currently violated** — see Summary finding 1.
- **Opera Cloud (A4):** "App must function standalone first. Two-way sync hardening deferred." More is already built than this note suggests (conflict list/resolve endpoints exist); this phase resolves the pilot-gating half.
- **Services layer depth (A1):** keep business logic in domain routers; `services/ai/` and `services/opera/` are pre-approved exceptions since they're shared across 2+ call sites (router + cron in the Opera case, multiple intents in the AI case) — any fixes should stay within this existing layering, not introduce new abstraction.
- **Non-Regression Policy:** identify shared code paths before changing them. `credits.py::check_and_deduct_credits` and `log_ai_interaction` are called from `ai_copilot.py` (6 call sites), `sop_rag.py` (internal duplicate call), and indirectly gate all AI spend — any fix here touches every intent branch; regression-test all of them, not just the one that surfaced the bug.
- **Self-Verification Policy:** must exercise the live dev server + browser for confirmation, not just pytest. No live `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` locally (per "Current Scope" in CLAUDE.md) — AI-provider-dependent paths (actual GPT-4o-mini/Claude calls) cannot be exercised end-to-end; only the rule-engine fast-path (`try_fast_path`, zero-credit, no LLM call) can be walked through live without credentials. Flag this explicitly to the planner: RBAC/tenant-isolation/credit-cap-gate logic can and must be proven live; actual LLM response quality cannot be.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| AI intent detection & routing (`detect_intent`) | API/Backend | — | Pure server-side heuristic in `ai_copilot.py`; no client trust needed |
| LLM parsing calls (task/WO/guest-request/assignment parsers, SOP RAG) | API/Backend | External Service (OpenAI/Anthropic) | `services/ai/*` — server holds provider keys, never exposed client-side |
| Credit gate & accounting | API/Backend | Database (`credit_ledger`, `ai_interactions`) | `middleware/credits.py` — must be authoritative and tamper-proof from client |
| Client-side "fast path" quick replies | Browser/Client | — | `apps/web/lib/ai/clientFastPath.ts` — zero-cost UX shortcuts before hitting the API; must never bypass server-side credit/RBAC checks for anything that writes data |
| Opera OAuth/token lifecycle | API/Backend | External Service (Oracle OHIP) | `services/opera/auth.py` — password/client_credentials grant, refresh, all server-side |
| Opera credential storage | Database | API/Backend (encrypt/decrypt) | `opera_credentials` table + `services/opera/crypto.py` (Fernet envelope encryption) |
| Opera reservation sync (poll) | API/Backend | Database (`opera_reservations`, `integration_sync_conflicts`) | `services/opera/sync.py` — pull-based, triggered by cron or manual `/opera/sync` |
| Opera webhook ingestion (push) | API/Backend | External Service boundary (Oracle → PatelRep, unauthenticated network path) | `routers/webhooks.py` + `services/opera/webhooks.py` — public endpoint, signature verification is the only trust boundary |
| Opera pilot-flag enforcement | Database (flag storage) | API/Backend (enforcement in `integrations.py` + `webhooks.py`) | New column on `tenants`; every Opera-touching endpoint and the webhook dispatcher must check it |
| AI Copilot chat UI | Browser/Client | — | `AICopilotBubble.tsx` — renders preview/confirm cards, never itself calls LLM providers |

## Standard Stack

This phase adds no new libraries — it audits and hardens what is already installed. Confirmed current versions in the working environment:

| Library | Version (verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pytest | 9.1.1 | Test runner | `[VERIFIED: python -m pytest --version]` — already the project's sole test framework |
| Python | 3.13.7 | Runtime | `[VERIFIED: python --version]` |
| FastAPI | (see requirements.txt) | API framework | Already in use across all 21 routers |
| supabase-py | (see requirements.txt) | DB client | Already in use; backend always authenticates as `service_role` `[VERIFIED: core/database.py]` |
| cryptography (Fernet) | (see requirements.txt) | Opera credential envelope encryption | Already in use in `services/opera/crypto.py` |
| pytest-asyncio | (implied by existing `@pytest.mark.asyncio` tests) | Async test support | Already the pattern in every existing router-function test |

**No new installs required.** If the planner decides a per-model credit-rate table is the fix for finding 1, it can live as a plain Python dict (mirroring `CREDIT_COSTS`'s existing shape) — no new dependency needed.

## Architecture Patterns

### System Architecture Diagram — AI Copilot request flow

```
Browser (AICopilotBubble.tsx)
  │  user types message
  ▼
clientFastPath() ──match?──▶ render locally, NO network call (zero credits, zero LLM)
  │ no match
  ▼
POST /ai/copilot/chat  (apps/api/routers/ai_copilot.py::copilot_chat)
  │
  ▼
detect_intent(message) ──▶ {task_creation | work_order_creation | guest_request_creation |
                             task_assignment | ambiguous | insight_query | sop_query | general}
  │
  ├─ task_creation ──▶ try_fast_path() ──match?──▶ 0-credit rule-engine response
  │                        │ no match
  │                        ▼
  │                    parse_nl_tasks() [OpenAI gpt-4o-mini] ──▶ real prompt/completion tokens
  │
  ├─ work_order_creation ──▶ parse_work_orders() [OpenAI]
  ├─ guest_request_creation ──▶ parse_guest_requests() [OpenAI]
  ├─ task_assignment ──▶ parse_assignments() [OpenAI]
  ├─ insight_query ──▶ generate_gm_insights() [Claude] ← reads 7-day stats incl. SUM(ai_interactions.credits_charged)
  └─ sop_query ──▶ query_sop() [OpenAI embed + Supabase RPC match_sop_chunks + Claude]
                        │  (internally ALSO calls _log_ai_interaction — see Pitfall 2)
                        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ check_and_deduct_credits(hotel_id, interaction_type)     │  ← FLAT CREDIT_COSTS lookup, NOT token-based (Pitfall 1)
  │   → credit_ledger row created/read → cap check → RPC     │
  │     increment_credits_used (real ledger mutation)        │
  └─────────────────────────────────────────────────────────┘
                        │
                        ▼
  log_ai_interaction(... prompt_tokens, completion_tokens, credits_charged ...)
                        │  (writes ai_interactions row — 2nd write for sop_query path)
                        ▼
  response_payload ──▶ Browser renders preview card ──▶ user confirms
                        │
                        ▼
  POST /ai/{tasks|work-orders|guest-requests|assignments}/confirm ──▶ INSERT into
  tasks/work_orders/guest_requests/room_assignments, tenant-scoped via
  current_user.hotel_id (server-resolved, not client-trusted for room_id/staff_id)
```

### System Architecture Diagram — Opera integration flow

```
GM (require_role gm) ──▶ POST /integrations/opera/connect
                              │
                              ▼
                    acquire_new_token() [Oracle OHIP OAuth password/client_credentials grant]
                              │
                              ▼
                    encrypt_opera_secrets() [Fernet envelope] ──▶ UPSERT opera_credentials
                              │
                              ▼
                    bootstrap_opera_data() ──▶ 90-day historical reservation pull (best-effort, errors logged not raised)

Manual sync: GM ──▶ POST /integrations/opera/sync ──▶ sync_reservations()
Cron sync (GitHub Actions, /v1/internal/opera/sync-reservations, */30 * * * *)
                              │
                              ▼
                    ohip_request() [Bearer token, auto-refresh via get_valid_access_token()]
                              │
                              ▼
                    upsert_opera_reservation() ──▶ conflict? ──▶ integration_sync_conflicts (open)
                                                 └─ no conflict ──▶ room_status UPDATE

Oracle → PatelRep (push, unauthenticated network path):
POST /webhooks/opera  (no auth dependency — public endpoint)
  │  resolve opera_hotel_id → tenant_id via opera_credentials.is_connected lookup
  │  IF app_env == production: _verify_opera_signature(payload, x-oracle-signature header, hotel_id)
  │     └─ signs with HMAC(CRON_SECRET + hotel_id) ← WRONG SECRET, see Pitfall 3
  ▼
dispatch by eventType → handle_checkout/checkin/reservation_modified/dnd/make_up_room
  (services/opera/webhooks.py — each handler tenant-scopes the room lookup, then
   updates room_status by room_id only, no redundant tenant_id filter on the UPDATE)
```

### Recommended Test Structure (extend, don't replace)

```
apps/api/tests/
├── smoke/
│   ├── test_integrations_security.py   # EXISTS — extend with RBAC + tenant-isolation + all 7 endpoints
│   ├── test_sop_security.py            # EXISTS — upload validation, adjacent to D-01 scope (routers/sop.py)
│   ├── test_ai_assignment_confirm.py   # EXISTS — extend with RBAC (non-supervisor 403) + cross-tenant
│   └── fake_supabase.py                # EXISTS — shared FakeDB harness; reuse, do not reinvent
├── test_ai_provider_configuration.py   # EXISTS — leave as-is, covers missing-key paths
├── test_ai_copilot_rbac.py             # NEW — per-role 403/200 matrix for /copilot/chat intents + insight_query + sop_query
├── test_ai_copilot_credits.py          # NEW — D-02: proves credits_charged derives from real token counts, not CREDIT_COSTS flat lookup; proves no double-log on sop_query path
├── test_opera_routes.py                # NEW — RBAC + tenant isolation for all 7 /integrations/opera/* endpoints
├── test_opera_webhooks.py              # NEW — signature verification uses opera_credentials.webhook_secret (post-fix), cross-tenant room resolution, unknown-event-type no-op
└── test_opera_pilot_gate.py            # NEW — D-03: non-pilot hotel cannot connect/sync/receive webhooks; pilot hotel can
```

### Pattern 1: Router-function direct-invocation test harness (established, do not deviate)

**What:** The project's actual test pattern for router logic is NOT `TestClient` + `dependency_overrides`. It is direct `await` of the router's async handler function, with `supabase` monkeypatched to a `FakeDB`/`FakeQuery` object, and a hand-built `CurrentUser` dataclass instance passed as the `current_user` kwarg. RBAC gates are tested by pulling the dependency callable off the route object directly.

**When to use:** All new tests for this phase — this is the only pattern with precedent in this codebase (`test_ai_assignment_confirm.py`, `test_evidence_foundation.py`, `04-01-PLAN.md`'s Task 1).

**Example:**
```python
# Source: apps/api/tests/test_evidence_foundation.py (verified in this session)
from middleware.auth import CurrentUser
from routers import evidence as evidence_router

route = next(r for r in evidence_router.router.routes
             if r.path == "/evidence/applicability" and "PUT" in r.methods)
role_check = route.dependant.dependencies[0].call
with pytest.raises(HTTPException, match="not authorized"):
    await role_check(CurrentUser(user_id="staff-1", hotel_id="hotel-1", role="housekeeper"))

response = await evidence_router.update_property_applicability(
    UpdatePropertyApplicabilityRequest(facilities=["pool"], services=["breakfast"]),
    CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm"),
)
```

```python
# Source: apps/api/tests/smoke/test_ai_assignment_confirm.py (verified in this session)
db = FakeDB({"rooms": [...], "user_roles": [...], "room_assignments": []})
monkeypatch.setattr(ai_copilot, "supabase", db)
response = await ai_copilot.confirm_assignments([AssignmentPreview(...)], current_user=SUPERVISOR)
```

### Pattern 2: Fixed-credit-cost dict → per-model token-rate table (fix for Pitfall 1)

**What:** Replace (or supplement) `CREDIT_COSTS[interaction_type]` flat lookup with a computation from real `prompt_tokens`/`completion_tokens` × a per-model rate table, mirroring how `log_ai_interaction` already receives and stores real token counts.

**When to use:** In `check_and_deduct_credits`, once token counts are known (currently the function is called with only `interaction_type`, before the caller has tokens in some branches — the call order in `ai_copilot.py` needs to move `check_and_deduct_credits` to AFTER the parse call returns tokens, not before, for every branch. Verify this ordering per-branch; some branches already call parse before credit deduction — e.g. `task_creation`'s AI-path and `work_order_creation` already have `result` with tokens available before `check_and_deduct_credits` is called, so the fix is mechanical there).

### Pattern 3: Pilot-flag column + shared dependency

**What:** Add `tenants.opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE` (migration, following the exact style of `002_tenants.sql`'s `is_active`), then add a single reusable check (e.g. `require_opera_pilot_enabled` dependency or an explicit guard called at the top of every `/integrations/opera/*` handler and at the top of the webhook dispatcher after tenant resolution) that raises `403` (API) / silently no-ops with a logged reason (webhook, since Oracle can't be redirected to an error page — mirror the existing "hotel not found or not connected" silent-ignore pattern already in `opera_webhook()`).

**When to use:** This is the D-03 mechanism. Single boolean column is recommended over a `pilot_features` table because: (a) only one integration needs gating right now (AI copilot is explicitly ungated per D-04), so a general-purpose multi-feature table is premature abstraction; (b) it matches the existing `is_active`/`is_connected` boolean-flag idiom already used twice in the exact same table family (`tenants.is_active`, `opera_credentials.is_connected`); (c) it requires one migration + one `.eq()`/`if` check per endpoint, versus a join for every check with a separate table. If a second pilot-gated feature appears in a future phase, promoting to a `pilot_features` table at that point is a cheap, well-understood refactor — YAGNI applies now.

```sql
-- Follows the exact style of supabase/migrations/002_tenants.sql
ALTER TABLE tenants ADD COLUMN opera_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN tenants.opera_pilot_enabled IS
  'Gates Opera Cloud/OHIP connect, sync, and webhook processing to explicitly enrolled pilot hotels (Phase 6 D-03).';
```

### Anti-Patterns to Avoid

- **Do not add pilot-gating to AI copilot code paths.** D-04 explicitly excludes this — any task that touches `ai_copilot.py`'s RBAC should NOT introduce a new flag dependency there.
- **Do not build a new test harness (TestClient-based or otherwise).** Every existing test file in this domain uses direct router-function invocation — introducing a second pattern mid-phase fragments the suite and contradicts Phase 4's explicit precedent of reusing `test_evidence_foundation.py`'s style.
- **Do not "fix" the webhook signature check by simply making it always pass in production.** The correct fix is to use `opera_credentials.webhook_secret` (already provisioned in schema, unused in code) as the HMAC key, matching what the column comment says it's for. If Oracle's actual signing mechanism/header name differs from `x-oracle-signature` (unverified against official OHIP docs in this session — see Open Questions), that must be resolved, not bypassed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credit/token cost calculation | A new billing microservice or generic "pricing engine" | A plain per-model rate dict in `middleware/credits.py`, same shape as existing `CREDIT_COSTS` | Matches existing simplicity level; this is an accounting fix, not a new subsystem — CLAUDE.md A1 (flat architecture) applies |
| HMAC webhook verification | A new signature-verification library/abstraction | Reuse the exact `hmac.compare_digest` pattern already correct in `_verify_twilio_signature` (same file, `routers/webhooks.py`) — only the secret source needs to change | The codebase already has one correct HMAC implementation right next to the broken one; copy the pattern, fix the key |
| Pilot enrollment | A generic feature-flag service/table | One boolean column (Pattern 3 above) | Single integration needs gating; premature generality is waste |
| Route-level RBAC/tenant test harness | TestClient + dependency_overrides scaffolding | Direct async handler invocation + `FakeDB` (Pattern 1 above) | Zero setup cost, already proven across 5+ existing test files |

**Key insight:** Every "don't hand-roll" item in this phase resolves to "reuse a pattern that already exists elsewhere in this exact codebase" — this is a hardening pass on a small, already-coherent system, not a greenfield integration decision.

## Common Pitfalls

### Pitfall 1: Flat per-interaction-type credit cost, not token-based (D-02 core finding)
**What goes wrong:** `CREDIT_COSTS` in `middleware/credits.py` charges the same credits regardless of how many tokens the LLM call actually consumed. A short "Room 412 needs towels" and a long multi-paragraph SOP question both cost the SOP-query intent 2.0 credits flat.
**Why it happens:** The middleware was written before/independent of the per-call token accounting that `services/ai/*` already returns; nobody wired the two together.
**How to avoid:** Compute `credits_charged` from `(prompt_tokens * rate_in + completion_tokens * rate_out) / credits_per_dollar`-style formula using real per-model provider pricing, call `check_and_deduct_credits` (or a renamed/refactored version) AFTER the parse call returns real usage, in every branch of `copilot_chat` and in `get_gm_insights`.
**Warning signs:** Any test asserting `credits_used == CREDIT_COSTS[intent]` regardless of message length is testing the bug, not the fix — the fix should make credit charged vary with token count.

### Pitfall 2: Double `ai_interactions` write on the sop_query path (D-02/D-06)
**What goes wrong:** `services/ai/sop_rag.py::query_sop()` and `routers/ai_copilot.py::copilot_chat()`'s post-intent logging both write to `ai_interactions` for the same user-facing request when the intent is `sop_query` reached via `/copilot/chat`. (Note: `sop_rag.py`'s internal log always uses `interaction_type="sop_query"`; the direct SOP query path, if one exists outside `/copilot/chat`, is unaffected by the second write — verify whether any other caller of `query_sop()` exists before assuming this is copilot-chat-only.)
**Why it happens:** `query_sop()` was written as a self-contained service that logs its own outcome (including provider-error paths), but the router ALSO logs unconditionally at the end of `copilot_chat`, unaware the callee already logged.
**How to avoid:** Pick one owner of the log write — recommend the router (it has the real, ledger-deducted `credits` value; `sop_rag.py`'s hardcoded `2.0` is always wrong once Pitfall 1 is fixed) — and remove the internal `_log_ai_interaction` call from `query_sop()`, or have `query_sop()` return enough info for the router to skip its own second write when the callee already logged.
**Warning signs:** `SELECT COUNT(*) FROM ai_interactions WHERE interaction_type='sop_query'` should equal the number of SOP questions asked, not 2x that number.

### Pitfall 3: Opera webhook signature verified against an internally-derived secret, not Oracle's shared secret
**What goes wrong:** `_verify_opera_signature()` in `routers/webhooks.py` computes `HMAC(CRON_SECRET + hotel_id, payload)` and compares against the `x-oracle-signature` header. Oracle does not know `CRON_SECRET`, so it cannot produce a signature this check would accept — meaning either (a) genuine Oracle webhooks always fail this check in production (silently swallowed as `401`, breaking real-time checkout/checkin/DND sync for any pilot hotel), or (b) the check is effectively decorative and something else is relied on. `opera_credentials.webhook_secret` (schema column, unused) was clearly intended to be the real per-hotel shared secret.
**Why it happens:** Likely an MVP shortcut noted in the function's own docstring ("secret is derived from CRON_SECRET + hotel_id for MVP") that was never revisited once the `webhook_secret` column was added to the schema.
**How to avoid:** Switch `_verify_opera_signature` to read `opera_credentials.webhook_secret` for the resolved `hotel_id` and use that as the HMAC key. Confirm (via Oracle OHIP Business Events documentation, not assumed) the actual header name and hash algorithm Oracle uses — this session could not verify OHIP-specific webhook signing conventions (only generic Oracle Commerce Cloud HMAC-SHA1 conventions were found via web search, which is a different Oracle product and not authoritative for OHIP). Flag this as an Open Question for the planner/user to resolve, possibly by checking actual Oracle OHIP integration docs or Oracle support during implementation.
**Warning signs:** Any pilot hotel reporting checkout/checkin webhooks "not updating room status in real time" while manual `/opera/sync` works fine — that's this bug in production, not a room-lookup or mapping issue.

### Pitfall 4: `maybe_single()` → `None` guard (bug-449 class) present in `_get_hotel_context`, `opera_status`, and other reads
**What goes wrong:** Several reads in `ai_copilot.py` and `integrations.py` already correctly guard with `if not result or not result.data:` or `(hotel.data or {}) if hotel else {}` — but this must be re-verified for every `.maybe_single()` call touched during this phase's fixes, since Phase 3's bug-449 (STATE.md) proved this exact codebase has shipped the wrong guard (`if result.data:` alone, which raises `AttributeError` when `result` itself is `None`) before, and the existing test suite did not catch it because the fake harness didn't return a bare `None`.
**Why it happens:** `supabase-py`'s `maybe_single().execute()` returns `None` (not an object with `.data=None`) when zero rows match — this is non-obvious and easy to get backwards.
**How to avoid:** Any new or touched `.maybe_single()` call must use `if not result or not result.data:`. Any new `FakeQuery`/`FakeDB` test double for this phase must be able to return a bare `None` from `.execute()` on `maybe_single()` (not `SimpleNamespace(data=None)`) to actually exercise this guard, per 04-01-PLAN.md's Task 1 approach.
**Warning signs:** A fake-DB test harness that always returns `SimpleNamespace(data=...)` even for "no match" cases will hide this bug, exactly as it did in bug-449.

### Pitfall 5: `confirm_tasks` accepts untyped `list[dict]`, not a Pydantic model
**What goes wrong:** Every other AI copilot confirm endpoint (`confirm_work_orders`, `confirm_guest_requests`, `confirm_assignments`) takes a typed Pydantic list (`WorkOrderPreview`, `GuestRequestPreview`, `AssignmentPreview` — all `SanitizedBaseModel` subclasses in `models/requests.py`). `confirm_tasks` takes a raw `list[dict]`, so `task["title"]` (no `.get()`) will raise an uncaught `KeyError` → 500 if the client omits it, and no length/sanitization limits apply.
**Why it happens:** Likely written before the `SanitizedBaseModel` pattern was established for the other three confirm endpoints, or an oversight during a later addition.
**How to avoid:** Not necessarily a security bug (any authenticated user can already POST arbitrary JSON to this endpoint per the existing no-RBAC convention shared with `create_work_order`/`create_guest_request` — see below), but is a robustness/consistency gap worth fixing in-phase per D-05's "found → fix" mandate, and directly affects testability (a route test asserting 422 on malformed input needs a Pydantic model to get that behavior for free).
**Warning signs:** A malformed `/ai/tasks/confirm` request currently returns 500 (unhandled exception) instead of 422 (validation error) — that's the tell.

### Pitfall 6 (confirmed NOT a bug — noted to save planner time): confirm_work_orders/confirm_guest_requests have no RBAC role restriction
**What goes wrong (or doesn't):** `confirm_work_orders`, `confirm_guest_requests`, and `confirm_tasks` only require `get_current_user` (any authenticated role), not `require_role(...)`.
**Verified as consistent, not a gap:** The equivalent direct-creation endpoints `POST /work-orders` (`create_work_order`) and `POST /guest-requests` (`create_guest_request`) in the non-AI routers **also** only require `get_current_user` — confirmed by direct grep of `routers/work_orders.py` and `routers/guest_requests.py` in this session. Any staff member can already create a work order or guest request directly; the AI confirm endpoints matching that convention is correct, not a gap. Do not "fix" this into a role restriction — that would be a regression against established project convention, not a security fix.
**Contrast:** `confirm_assignments` DOES use `require_role("housekeeping_supervisor", "engineer", "gm")` — correctly excluding `housekeeper`, matching the sensitivity of reassigning other staff's work.

## Code Examples

### Verified: real token usage IS already returned from every parser (the raw material for fixing Pitfall 1 already exists)
```python
# Source: apps/api/services/ai/work_order_parser.py (verified in this session)
return {
    "work_orders": raw,
    "prompt_tokens": response.usage.prompt_tokens,
    "completion_tokens": response.usage.completion_tokens,
}
```

### Verified: the correct HMAC pattern already exists in the same file as the broken one
```python
# Source: apps/api/routers/webhooks.py (verified in this session) — this Twilio check is correct;
# the Opera check two functions below it uses the wrong secret (see Pitfall 3)
def _verify_twilio_signature(request: Request, params: dict) -> bool:
    signature = request.headers.get("x-twilio-signature", "")
    if not signature or not settings.twilio_auth_token:
        return False
    ...
    return RequestValidator(settings.twilio_auth_token).validate(url, params, signature)
```

### Verified: bug-449-safe guard already used correctly elsewhere in this exact surface
```python
# Source: apps/api/routers/integrations.py::opera_status (verified in this session — this one is correct)
result = supabase.table("opera_credentials")\
    .select(...).eq("tenant_id", current_user.hotel_id).maybe_single().execute()
if not result or not result.data or not result.data.get("is_connected"):
    return {"data": {"connected": False}}
```

## State of the Art

| Old Approach (per stale docs) | Current Approach (per actual code, verified this session) | When Changed | Impact |
|--------------------------------|------------------------------------------------------------|--------------|--------|
| CLAUDE.md A4: "two-way sync hardening deferred" | Conflict detection (`has_reservation_conflict`) and human-resolution endpoints (`/opera/conflicts`, `/opera/conflicts/{id}/resolve`) already fully implemented, with append-only `integration_sync_conflict_events` audit trail (migration 073) | commit `e4ac615a`, 2026-05-22 | This phase's job is to verify/harden this existing mechanism, not build it |
| ROADMAP.md: AI copilot backlog docs describe future work | `.planning/ai-copilot-primary-interface.md` and `.planning/sop-voice-fastpath.md` are fully implemented specs-as-built, not specs-to-build | commit `e4ac615a`, 2026-05-22 | Read these docs as "what SHOULD exist, verify against reality" per 06-CONTEXT.md's own instruction, not as a build checklist |
| "Opera feature-flagged for pilot" (CLAUDE.md, stale) | No flag exists anywhere; Opera is live for every hotel today | N/A — this is the gap D-03 closes | Confirmed by grep across all migrations for pilot/feature_flag/enrolled — zero matches on `tenants` or any dedicated table |

**Deprecated/outdated:** None of the audited code is deprecated — it's all live and current. The *documentation about* it (CLAUDE.md's A4 note, ROADMAP.md's Phase 6 framing) is what's stale, and this phase's deliverable partially corrects that staleness (the pilot-flag half; the "hardening" half was already mostly done).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Oracle OHIP Business Events webhooks use header `x-oracle-signature` with an HMAC-SHA256 scheme compatible with `hmac.compare_digest(f"sha256={expected}", signature_header)` | Pitfall 3 / Open Questions | If the actual OHIP scheme differs (different header name, different hash algo, different payload-to-sign construction), the "fix" of swapping in `opera_credentials.webhook_secret` alone is necessary but not sufficient — the whole verification function may need reconstruction against real Oracle docs or a real pilot hotel's webhook traffic |
| A2 | A single `tenants.opera_pilot_enabled` boolean is sufficient for D-03 and no hotel will need per-feature (vs. per-integration) granularity within Opera itself (e.g., "sync yes, webhooks no") | Architecture Patterns, Pattern 3 | If the business wants finer-grained pilot control (e.g., enable connect/sync but not automated webhook writes) mid-pilot, a boolean is too coarse and would need to become an enum or small settings JSONB column instead — low risk since D-03's own text says "scoping Opera connect/sync/webhooks" as one unit |
| A3 | GPT-4o-mini and Claude Sonnet 4.6 per-token pricing (needed to build the rate table for Pitfall 1's fix) — this research did not fetch current OpenAI/Anthropic pricing pages | Common Pitfalls / Pattern 2 | Planner/executor must fetch current provider pricing before hardcoding a rate table, or credits will still be miscalibrated (just less obviously than a flat per-intent number) — this is explicitly a "verify before asserting" gap this research did not close |
| A4 | `query_sop()` is only ever called from `ai_copilot.py`'s `sop_query` branch (making Pitfall 2's double-log fix safe to apply by editing just those two call sites) | Pitfall 2 | If another caller of `query_sop()` exists elsewhere in the codebase (not found via the reads performed this session, but not exhaustively grepped for all call sites), removing `sop_rag.py`'s internal log without checking that caller could silently stop logging SOP queries reached via that other path |

**Risk mitigation for this table:** every entry above should be a concrete grep/verification step in the planner's Wave 0, not a re-litigated design discussion — these are narrow, checkable facts, not open design decisions.

## Open Questions

1. **What is Oracle OHIP's actual Business Events webhook signing mechanism?**
   - What we know: The codebase currently checks header `x-oracle-signature` with a self-derived HMAC-SHA256 key; this is almost certainly wrong (see Pitfall 3, Assumption A1). Generic Oracle Commerce Cloud (a different product) uses HMAC-SHA1 with header `X-Oracle-CC-WebHook-Signature` and a dedicated, dashboard-managed secret — structurally similar but not proof of OHIP's specific scheme.
   - What's unclear: The exact header name, hash algorithm, and canonicalization Oracle OHIP Business Events actually uses, and whether `opera_credentials.webhook_secret` is even populated anywhere in the current connect flow (grep during this session found the column exists in schema and is referenced in the table comment, but `opera_connect` in `integrations.py` does not currently write to it — it's dead schema, not just an unused-by-verification column).
   - Recommendation: Planner should treat "fix the webhook signature verification" as needing either (a) real OHIP documentation lookup during planning/execution, or (b) explicit scoping-down to "verify the check exists and uses a per-hotel secret sourced from the credentials table" without claiming to have matched Oracle's exact real-world scheme, with a note that full external validation requires a live OHIP sandbox the project does not have credentials for (per CLAUDE.md's "no live API credentials" constraint).

2. **Does the Stripe monthly true-up cron (`POST /v1/internal/billing/monthly-trueup`) or any other consumer read `ai_interactions.credits_charged` anywhere besides `services/ai/insights.py`'s 7-day GM stat?**
   - What we know: `billing.py` and `internal.py`'s trueup handler both read `credit_ledger.credits_used` (confirmed via grep), not `ai_interactions`. `services/ai/insights.py::_get_7day_stats()` is the one confirmed consumer of `ai_interactions.credits_charged` for a display value.
   - What's unclear: Whether `reports.py` (daily GM summary email) or any admin/analytics surface also aggregates `ai_interactions` — not read in this session.
   - Recommendation: Planner should grep `ai_interactions` across `apps/api/routers/reports.py` and `apps/api/routers/billing.py` before finalizing the double-log fix, to confirm the full blast radius of Pitfall 2.

3. **Should the AI-provider-dependent LLM call paths (non-fast-path task_creation, all of work_order/guest_request/assignment parsing, insight_query, sop_query) be tested with real provider calls, mocked provider responses, or left as "logic proven, live LLM output unverified"?**
   - What we know: No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` exists locally (CLAUDE.md "Current Scope"). `test_ai_provider_configuration.py` already tests the missing-key failure path.
   - What's unclear: Whether D-06's "full Phase 1-5 rigor" implies mocking `get_openai_client()`/`get_anthropic_client()` responses to test the credit/logging logic end-to-end (recommended — this is what's needed to test Pitfall 1's fix), versus expecting live-credentialed E2E (not possible per current environment constraints).
   - Recommendation: Mock the provider client response objects (`response.usage.prompt_tokens` etc.) the same way `parse_work_orders`/`parse_nl_tasks` already structure their returns — this fully exercises the credit-calculation fix without needing real API keys, and matches D-06's intent (verify RBAC/tenant/credit correctness) rather than LLM output quality (out of scope, per CLAUDE.md's own environment caveat).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | Test execution | ✓ | 3.13.7 | — |
| pytest | Test execution | ✓ | 9.1.1 | — |
| OPENAI_API_KEY | Live LLM parser calls (task/WO/guest-request/assignment parsing) | ✗ | — | Mock provider client responses in tests (Open Question 3); rely on rule-engine `try_fast_path()` for any live-browser walkthrough of task creation |
| ANTHROPIC_API_KEY | Live LLM calls (SOP RAG, GM insights) | ✗ | — | Same as above — mock in tests; live insight/SOP-query browser walkthrough cannot be fully exercised end-to-end, only the "no SOPs uploaded" / RBAC / credit-cap-rejection paths can be proven live |
| Local Supabase / dev DB | Route-function tests | N/A | — | Existing tests use `FakeDB`, not a real DB connection — no live DB needed for the bulk of this phase's test additions |
| Oracle OHIP sandbox credentials | Full live Opera connect/sync/webhook E2E | ✗ | — | No fallback for a true end-to-end OHIP proof; the pilot-flag gating logic and RBAC/tenant-isolation can be fully proven with `FakeDB`-based tests without real OHIP access |

**Missing dependencies with no fallback:**
- Oracle OHIP sandbox — a genuinely live Opera connect→sync→webhook round trip against real Oracle infrastructure cannot be performed in this environment. This phase must rely on code-level verification (RBAC, tenant isolation, credit-cap, signature-uses-correct-secret) rather than a live OHIP integration proof.

**Missing dependencies with fallback:**
- OpenAI/Anthropic live keys — mocked provider responses in pytest cover the credit-accounting and logging logic fully; only literal LLM output quality is unverifiable, which is out of this audit phase's scope anyway (scope is RBAC/tenant/credit correctness, not prompt engineering).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio (`[VERIFIED: python -m pytest --version]`) |
| Config file | none found as a separate `pytest.ini`/`pyproject.toml` `[tool.pytest.ini_options]` block was not located in this session — treat as a Wave 0 check, not a gap to fix (existing 300+ test suite already runs, so config exists somewhere; confirm exact location before assuming absence) |
| Quick run command | `cd apps/api && python -m pytest tests/smoke/test_integrations_security.py tests/smoke/test_ai_assignment_confirm.py -q` (existing scoped files) |
| Full suite command | `cd apps/api && python -m pytest tests/ -q` |

### Phase Requirements → Test Map

No `REQUIREMENTS.md` entries are linked to this phase (`phase_req_ids` is null). The test map below is derived directly from the locked CONTEXT.md decisions (D-01 through D-06) in place of formal REQ IDs.

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01/D-06 | Non-gm/chief_engineer/housekeeping_supervisor role gets 403 on `/ai/insights`, `/ai/recommendations`, `/ai/recommendations/metrics` etc. where `require_role` is present; correctly-open endpoints (chat, confirm) allow any authenticated role | unit (router-function) | `pytest tests/test_ai_copilot_rbac.py -x` | ❌ Wave 0 |
| D-01/D-06 | Cross-tenant Opera credential/conflict access returns 404/empty and writes zero rows | unit (router-function) | `pytest tests/smoke/test_opera_routes.py -x` | ❌ Wave 0 |
| D-02/D-06 | `credits_charged` varies with `prompt_tokens`/`completion_tokens`, not fixed per `CREDIT_COSTS` | unit | `pytest tests/test_ai_copilot_credits.py -x` | ❌ Wave 0 |
| D-02/D-06 | Exactly one `ai_interactions` row is written per SOP query via `/copilot/chat` | unit | `pytest tests/test_ai_copilot_credits.py -x` | ❌ Wave 0 |
| D-05 | Opera webhook signature check uses `opera_credentials.webhook_secret`, not a CRON_SECRET derivation | unit | `pytest tests/smoke/test_opera_webhooks.py -x` | ❌ Wave 0 |
| D-03 | Non-pilot hotel: `/opera/connect` returns 403; existing-but-now-disabled pilot hotel cannot sync; webhook for non-pilot hotel is a documented no-op | unit | `pytest tests/test_opera_pilot_gate.py -x` | ❌ Wave 0 |
| D-06 | Live authenticated browser walkthrough: AI copilot fast-path task creation, Opera connect/status UI (if one exists — not confirmed in `apps/web` for Opera; verify during planning whether a web settings surface exists for `/integrations/opera/*` beyond the API) | manual (Playwright/browser, per Self-Verification Policy) | manual localhost walkthrough | N/A |

### Sampling Rate
- **Per task commit:** the specific new/modified test file's quick command (e.g. `pytest tests/test_ai_copilot_credits.py -x`)
- **Per wave merge:** `cd apps/api && python -m pytest tests/ -q` (full suite — confirm no regression against the existing 400+ baseline referenced in STATE.md)
- **Phase gate:** full suite green + `cd apps/web && npm run type-check` + live browser walkthrough before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/tests/test_ai_copilot_rbac.py` — new file, RBAC matrix for all `ai_copilot.py` endpoints
- [ ] `apps/api/tests/test_ai_copilot_credits.py` — new file, D-02 credit-accounting + double-log regression tests
- [ ] `apps/api/tests/smoke/test_opera_routes.py` — new file, RBAC + tenant isolation for remaining 6 of 7 Opera endpoints (connect already partially covered by `test_integrations_security.py`)
- [ ] `apps/api/tests/smoke/test_opera_webhooks.py` — new file, webhook signature + dispatch tests (currently zero coverage of `routers/webhooks.py::opera_webhook` or `services/opera/webhooks.py` handlers)
- [ ] `apps/api/tests/test_opera_pilot_gate.py` — new file, D-03 pilot-flag enforcement
- [ ] Confirm whether a web UI surface exists for Opera settings (`apps/web/app/(dashboard)/settings`, per CLAUDE.md's domain map) before scoping browser E2E — not verified in this research session

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing JWT bearer (`middleware/auth.py`) — unchanged by this phase, but Opera integration's OWN OAuth (password/client_credentials grant to Oracle) is a secondary auth boundary this phase audits |
| V3 Session Management | no | Not touched — no session logic in this phase's scope |
| V4 Access Control | yes | `require_role`/`get_current_user` per-endpoint — this phase's primary audit target (RBAC matrix) |
| V5 Input Validation | yes | `SanitizedBaseModel` subclasses (`WorkOrderPreview`, `GuestRequestPreview`, `AssignmentPreview`, `OperaConnectRequest`, `ResolveOperaSyncConflictRequest`) — `confirm_tasks`'s untyped `list[dict]` is the one gap (Pitfall 5) |
| V6 Cryptography | yes | Fernet envelope encryption (`services/opera/crypto.py`) for Opera credentials — already correct (verified: encrypted values distinct from plaintext, `ENVELOPE_PREFIX` marker present, test coverage exists in `test_integrations_security.py`); HMAC webhook signing is the one broken crypto usage (Pitfall 3) |
| V9 Communications | yes | Opera OHIP calls use `httpx` over HTTPS (`ohip_base_url` always expected `https://`); no TLS-pinning or cert-validation override found (good — using default `httpx` verification) |
| V10 Malicious Code | no | Not applicable — no new third-party code execution introduced |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation | Status in this codebase |
|---------|--------|---------------------|---------------------|
| Cross-tenant data read via missing `.eq("tenant_id"/"hotel_id", ...)` filter | Information Disclosure | Every query scoped to `current_user.hotel_id` | Spot-checked across `ai_copilot.py`/`integrations.py`/`sync.py`/`webhooks.py` in this session — filters present on all SELECT/UPDATE/INSERT paths reviewed; needs systematic test coverage (currently absent), not systematic code fixing (no missing filter found in this session's reads) |
| Forged webhook payload accepted as genuine | Spoofing / Tampering | HMAC signature verification with provider-issued shared secret | **Broken** — see Pitfall 3; uses internally-derived secret Oracle never signs with |
| Credential leakage via error messages | Information Disclosure | Generic error responses on 5xx/network failures | Confirmed correct — `test_opera_connect_returns_safe_error_for_unreachable_ohip` proves `httpx.ConnectTimeout`'s message text is NOT leaked to the client |
| Plaintext secret storage | Information Disclosure | Envelope encryption at rest | Confirmed correct for `opera_credentials` (Fernet, `ENVELOPE_PREFIX` versioning) |
| Privilege escalation via missing role gate | Elevation of Privilege | `require_role(...)` on all mutating/sensitive endpoints | `confirm_assignments` correct; `confirm_work_orders`/`confirm_guest_requests`/`confirm_tasks` intentionally open (matches sibling non-AI endpoints — not a gap, see Pitfall 6); `/ai/insights` and `/ai/risk-alerts` are open to any authenticated role — unresolved as bug-or-intentional in this session, flag for planner decision, not a confirmed fix |
| Billing/ledger tampering via client-controlled cost values | Tampering | Server-computed credit cost, never client-supplied | Confirmed correct — `credits_charged` is always server-computed (via flat lookup, not client input); Pitfall 1 is an *accuracy* bug, not a *tamperability* bug |

## Sources

### Primary (HIGH confidence — direct code reads, this session)
- `apps/api/routers/ai_copilot.py` — full file read
- `apps/api/routers/integrations.py` — full file read
- `apps/api/middleware/credits.py` — full file read
- `apps/api/services/opera/auth.py`, `crypto.py`, `sync.py`, `webhooks.py` — full files read
- `apps/api/services/ai/work_order_parser.py`, `guest_request_parser.py`, `assignment_parser.py`, `task_parser.py`, `sop_rag.py`, `insights.py` — full files read
- `apps/api/routers/webhooks.py` — full file read
- `apps/web/components/ai/AICopilotBubble.tsx`, `apps/web/lib/api/ai.ts` — full files read
- `apps/api/models/requests.py` — targeted grep of all relevant request models
- `apps/api/middleware/auth.py` — full file read (RBAC/JWT mechanism)
- `apps/api/tests/smoke/test_integrations_security.py`, `test_sop_security.py`, `test_ai_assignment_confirm.py`, `apps/api/tests/test_ai_provider_configuration.py`, `test_evidence_foundation.py` (partial) — full/partial reads for existing coverage + test-pattern precedent
- `apps/api/core/database.py` — targeted grep confirming `service_role` client usage
- `supabase/migrations/002_tenants.sql`, `073_pms_ai_governance.sql`, `018_match_sop_chunks_fn.sql`, `020_fix_credits_decimal.sql` — full/targeted reads for schema, grants, pilot-flag precedent search
- `apps/api/routers/work_orders.py`, `guest_requests.py`, `billing.py`, `internal.py` — targeted greps for RBAC/billing-consumer comparison
- `.planning/phases/06-pms-and-ai-expansion/06-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json` — full reads
- `.planning/phases/04-maintenance-and-housekeeping-programs/04-01-PLAN.md` — full read (structural template)
- `.planning/phases/02-evidence-foundation/02-VALIDATION.md` — partial read

### Secondary (MEDIUM confidence)
- None — this research relied entirely on direct codebase verification plus one targeted external search (below), not general web claims about this project's own code.

### Tertiary (LOW confidence — flagged, needs validation)
- Oracle webhook HMAC signing conventions — `[CITED: docs.oracle.com/en/cloud/saas/cx-commerce/22b/ccdev/secure-webhooks.html]` — this is Oracle **Commerce Cloud** documentation, a different Oracle product from OHIP/Opera Cloud PMS. Used only to establish the general principle that Oracle's webhook HMAC secrets are dedicated, dashboard-managed, shared secrets — NOT to assert OHIP's exact header/algorithm. See Open Question 1.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new stack, versions confirmed via direct tool invocation (`python --version`, `pytest --version`)
- Architecture: HIGH — every diagram element traced through actually-read source files in this session
- Pitfalls 1, 2, 4, 5, 6: HIGH — each is a direct code-read finding, cross-checked against sibling code in the same repo
- Pitfall 3: HIGH on the code-side defect (mismatched secret confirmed by reading both the verification function and the schema column comment); LOW on "what Oracle actually expects" (Assumption A1, Open Question 1)
- D-03 mechanism recommendation: MEDIUM — reasoned from existing codebase conventions, not from a formal architecture decision record; flagged as Claude's Discretion per CONTEXT.md, so this is a recommendation, not a locked fact

**Research date:** 2026-07-28
**Valid until:** 14 days (this is an audit of live, frequently-touched production code — re-verify findings if significant time passes before planning executes, since `ai_copilot.py`/`integrations.py` could be modified by other work in the interim)
