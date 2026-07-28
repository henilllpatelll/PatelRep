---
phase: 6
slug: pms-and-ai-expansion
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-28
---

# Phase 6 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Auditor stance:** Adversarial (assume absent until proven present). Independent code verification was performed for every threat declared in 06-01-PLAN.md through 06-05-PLAN.md `<threat_model>` blocks — not a documentation review. Live grep/read evidence was collected in the implementation files cited by each mitigation plan. The full API test suite (496 tests, including all 55 Phase 6 tests) was re-run directly in the audit session (not taken on faith from SUMMARY.md claims) and passed with zero failures.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client → /ai/copilot/chat | Authenticated staff input crosses into LLM parsing + credit deduction | Task/request text, credit-cost computation |
| API → credit_ledger / ai_interactions (DB) | Server-computed credit + audit writes; must be accurate and single-sourced | Billing amounts, audit log entries |
| API → Stripe monthly true-up | credit_ledger.credits_used is the billing basis | Aggregate credit usage |
| client (GM/staff) → /integrations/opera/* | Authenticated request crosses into an external-system integration control surface | OHIP credentials, sync state |
| API → external Oracle OHIP | Only pilot-enrolled hotels should reach this boundary | Reservation/room data, OHIP credentials |
| API → opera_credentials / integration_sync_conflicts (DB) | Per-tenant secrets + conflict data; must be tenant-isolated | Encrypted OHIP secrets, sync conflicts |
| client → /ai/* role-gated endpoints | GM-insight/recommendation surfaces must exclude floor roles | Operational insights/recommendations |
| client → /ai/*/confirm | Any authenticated staff may create tasks/WOs/requests (by design); input must be validated | Task/WO/guest-request payloads |
| API → tasks/work_orders/guest_requests (DB) | Confirm writes must be scoped to the caller's own hotel | Created records |
| Oracle OHIP → POST /webhooks/opera | Public, unauthenticated network path; signature verification is the ONLY trust boundary | Reservation/room-status push events |
| webhook → room_status / room_status_history (DB) | Push updates must be tenant-scoped and pilot-gated | Room status changes |
| GM browser → web app → API | Live authenticated exercise of the hardened AI + Opera surfaces | End-to-end request/response |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-06-01 | Tampering | credit_ledger accuracy (flat cost) | mitigate | `apps/api/middleware/credits.py:19-55` — `compute_credits()` derives credits from real `prompt_tokens`/`completion_tokens` via `MODEL_RATES`; `CREDIT_COSTS` retained as floor (line 54) | closed |
| T-06-02 | Repudiation/Info Disclosure | ai_interactions audit integrity (double-log) | mitigate | `sop_rag.py::query_sop()` returns tokens only, no internal write; `ai_copilot.py:433` single log; `sop.py:231,245` — second caller (found during Task 3 blast-radius check) now self-logs | closed |
| T-06-04 | Denial of Service | credit-cap bypass via reordered deduction | mitigate | `credits.py:111-127` — cap check fires before RPC deduction, using the token-derived amount | closed |
| T-06-05 | Elevation of Privilege | Ungated Opera access (no pilot flag existed) | mitigate | `integrations.py:17-22` guard called at all 7 handlers (lines 35,80,107,124,143,187,204 — 7/7 verified by direct count); `services/opera/sync.py:176-178` same guard inside `sync_reservations()`, the single function called by both the cron (bypasses integrations.py) and the manual `/opera/sync` handler. Migration 085 (`tenants.opera_pilot_enabled`) applied to the live Supabase DB by the orchestrator 2026-07-28, verified via `information_schema.columns` and a live 403 test. | closed |
| T-06-06 | Information Disclosure | Cross-tenant Opera credential/conflict read | mitigate | `test_opera_routes.py` tenant-isolation tests pass; `.eq("tenant_id", current_user.hotel_id)` filters present at `integrations.py:83,127,146,164,171,213` | closed |
| T-06-07 | Elevation of Privilege | Missing per-role gate on Opera mutations | mitigate | `require_role("gm")` on connect/sync/test/disconnect (28,104,184,201); `require_role("gm","chief_engineer")` on conflicts list/resolve (121,140); `get_current_user` only on status (77) — matched by 7 passing RBAC tests | closed |
| T-06-08 | Spoofing | Forged pilot state via tenants PK confusion | mitigate | `integrations.py:19-20` keys `.eq("id", current_user.hotel_id)` against `tenants.id`, same PK used by every other tenant-scoping call in the file | closed |
| T-06-10 | Elevation of Privilege | Role gate on /ai/insights, /ai/recommendations, /ai/recommendations/metrics | mitigate | `ai_copilot.py:710,724` role-gates `/recommendations` + `/recommendations/metrics`. `/ai/insights` (GET, line 679) is intentionally ungated — documented, tested deviation (06-03-SUMMARY) from a self-contradictory plan interface block; no POST variant exists in code. RBAC matrix covers exactly the two role-gated GETs that exist. | closed (documented scope correction) |
| T-06-11 | Information Disclosure | Cross-tenant confirm write | mitigate | `ai_copilot.py:525` insert uses server-resolved `current_user.hotel_id`; room ownership re-checked at 515-520 | closed |
| T-06-12 | Denial of Service/Tampering | confirm_tasks untyped list[dict] → 500 on KeyError | mitigate | `ai_copilot.py:497` signature is `list[TaskPreview]`; `models/requests.py:998-1006` typed with field constraints; attribute access confirmed, no raw dict access remains | closed |
| T-06-14 | Spoofing/Tampering | Forged webhook accepted (wrong HMAC secret) | mitigate | `webhooks.py:40-59` `_verify_opera_signature` keyed on `webhook_secret` directly (no `cron_secret` reference for Opera keying anywhere in file), fails closed on missing header/secret | closed |
| T-06-15 | Elevation of Privilege | Non-pilot hotel webhook processed | mitigate | `webhooks.py:98-101` silent no-op gate on `tenants.opera_pilot_enabled` before signature check/dispatch | closed |
| T-06-16 | Denial of Service | Malformed/unknown webhook crashes handler | mitigate | `webhooks.py:118-124` dispatch wrapped in try/except, always returns 200; unknown event type no-ops | closed |
| T-06-18 | Information Disclosure | Cross-tenant room update via webhook | mitigate | `services/opera/webhooks.py` — every handler resolves room within tenant before write; `room_status_history` tagged `change_source="opera_webhook"` | closed |
| T-06-19 | Tampering | Wire-contract mismatch (TaskPreview vs AICopilotBubble payload) | mitigate | Live Playwright walkthrough (06-05-SUMMARY, independently re-verified by orchestrator): `POST /ai/tasks/confirm` returns 200, not 422; `TaskPreview` field set matches the frontend `ParsedTask` contract | closed |
| T-06-20 | Elevation of Privilege | Pilot gate not enforced end-to-end at UI | mitigate | Commit `df9317f9` verified present and live in `integrations/page.tsx:348` (`!statusQuery.isError` guard) — closes a real bug the live walkthrough found (misleading connect form shown alongside a 403 error) | closed |
| T-06-03 | Tampering | Client-controlled AI cost | accept | `credits_charged` is always server-computed (`compute_credits()` takes no client-supplied cost parameter) — verified, not merely asserted | closed |
| T-06-09 | Info Disclosure | Opera error leaking OHIP creds | accept | `test_integrations_security.py::test_opera_connect_returns_safe_error_for_unreachable_ohip` exists and passes | closed |
| T-06-13 | Elevation of Privilege | Over-restricting open confirm endpoints (regression risk) | accept | No `require_role` on `/ai/tasks/confirm`, `/ai/work-orders/confirm`, `/ai/guest-requests/confirm` (intentional, matches sibling non-AI create endpoints); regression-guarded by `test_open_endpoints_accept_any_role` | closed |
| T-06-17 | Tampering | OHIP scheme mismatch could silently bypass verification | accept (documented) | Code comment at `webhooks.py:48-53` documents the gap; the actual fix (correct secret source, fail-closed) is real and verified (T-06-14) — this is a residual, unverified-against-live-Oracle precision gap, not a bypass | closed |
| T-06-21 | Info Disclosure | OHIP/LLM credential-dependent paths unverifiable locally | accept | 06-05-SUMMARY's "Accepted Deferrals" section documents both un-exercised live LLM responses and the un-exercised OHIP round-trip, consistent with CLAUDE.md's Current Scope (no local AI/OHIP credentials) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-06-01 | T-06-03 | Credit cost is always server-computed from real token counts, never client-supplied — verified in `middleware/credits.py` | gsd-security-auditor | 2026-07-28 |
| R-06-02 | T-06-09 | Opera connect errors already return safe, non-leaking messages — covered by an existing passing test | gsd-security-auditor | 2026-07-28 |
| R-06-03 | T-06-13 | Confirm endpoints are intentionally ungated by design (matches sibling non-AI create endpoints), regression-tested to stay that way | gsd-security-auditor | 2026-07-28 |
| R-06-04 | T-06-17 | Oracle OHIP's exact webhook signing scheme can't be verified without a live sandbox; the fix guarantees correct secret sourcing and fail-closed behavior regardless | gsd-security-auditor | 2026-07-28 |
| R-06-05 | T-06-21 | No local LLM/OHIP credentials exist to exercise these paths end-to-end (CLAUDE.md Current Scope) — documented deferral, not a silent gap | gsd-security-auditor | 2026-07-28 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-28 | 21 | 21 | 0 | gsd-security-auditor (sonnet) |

**Verification method notes:**
- Full test suite re-run independently in the audit session (not trusting SUMMARY claims): 496/496 passed, including 55/55 Phase 6-specific tests.
- T-06-05/T-06-07: counted `_require_opera_pilot()` call sites individually against all 7 declared endpoints rather than accepting a single grep match.
- T-06-10: found a genuine discrepancy between the threat register's stated mitigation text and the live code (`/ai/insights` GET has no role gate) — traced to 06-03-SUMMARY's own documented, tested correction of a self-contradictory plan interface block, not silently accepted.
- Migration 085's live-DB precondition (T-06-05) was verified by the orchestrator via `information_schema.columns` and a live 403 test (this auditor session had no direct Supabase MCP access) — treated as trusted evidence per explicit handoff context, not re-verified blind.
- Noted for completeness (not a mitigation-plan commitment this phase made): `_verify_opera_signature` is only invoked when `settings.app_env == "production"`, mirroring the pre-existing Twilio pattern in the same file — a pre-existing conditional-verification design, out of this phase's scope to change.
- No `## Threat Flags` sections exist in any SUMMARY.md; new attack surface discovered mid-implementation (second `query_sop` caller, second Opera-UI bug) was retroactively mapped to T-06-02 and T-06-20 respectively, not left dangling.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-28
