---
phase: 05-guest-recovery-and-management-roi
verified: 2026-07-25T05:10:00Z
status: human_needed
score: 17/17 decision contracts verified in code (60/60 plan truths code-verified)
overrides_applied: 0
human_verification:
  - test: "Live Twilio SMS round-trip: send an outbound guest message, receive an inbound reply, trigger a STOP/opt-out (error 21610)."
    expected: "Outbound send reaches the guest; inbound reply appends to the correct request thread; an opted-out recipient disables the reply box and records contact_opted_out_at."
    why_human: "No Twilio credentials exist locally (D-01, accepted per project CLAUDE.md). Code is complete and unit-tested against a fake client; live delivery is unverifiable without real credentials."
  - test: "Browser click-through of the Management ROI dashboard (/management-roi) as the GM test account, then as a non-GM role."
    expected: "GM sees the four theme sections populated (or explicit 'not configured'/'not computable' messages, never fabricated zeros); a non-GM sees the 'available to the general manager' refusal screen and no partial data; the sidebar entry is absent for non-GM."
    why_human: "Visual layout, metric rendering, and role-based nav gating are runtime/visual behaviors not fully verifiable by static analysis."
  - test: "Set an Average Daily Rate in Settings > General, reload, then clear it and reload."
    expected: "The ADR persists across reload; clearing it (blank field) writes null and the downtime-revenue card then reports 'not configured'."
    why_human: "Persistence + clear round-trip (WR-01 fix spans frontend null-send and backend re-inclusion) needs a live form submit to confirm end-to-end."
  - test: "Open a guest-request drawer: view the message thread, send a reply, and (on a resolved/verified request) use the resolution-confirmation template and record a satisfaction score."
    expected: "Thread shows inbound/outbound messages with delivery-status pills; reply box is gated by role and opt-out; the confirmation prompt prefills the reply textarea without auto-sending; a 1-5 satisfaction score records once and cannot be overwritten."
    why_human: "Interactive drawer flow, delivery-status pill rendering, and human-in-the-loop confirmation (D-17) require real user interaction to confirm."
  - test: "Settings > Guest Requests SLA rules and Settings > Rooms Accessibility Features tab as GM/housekeeping_supervisor."
    expected: "SLA rule create/list/delete works with confirmation copy; a new rule changes a matching new request's due date; the accessibility tab records a feature and its operational status persists; both surfaces are hidden from unauthorized roles."
    why_human: "Settings CRUD flows, nav visibility, and cross-effect on SLA resolution need interactive confirmation against the dev server."
  - test: "Lost & Found disposition review queue as gm / housekeeping_supervisor / front_desk, and as engineer / housekeeper."
    expected: "The disposition-due filter lists only past-retention items; Approve Disposition is visible to the three authorized roles and hidden from engineer/housekeeper; approving records a permanent custody event and disposes nothing automatically."
    why_human: "Role-gated control visibility and the custody-event write flow are UI/interaction behaviors."
---

# Phase 5: Guest recovery and management ROI — Verification Report

**Phase Goal:** Close guest service loops and quantify hotel operational value.
**Verified:** 2026-07-25T05:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This is a brownfield phase. Commit `fea45b29` shipped the Phase 5 data layer (migration 072,
`services/guest_recovery/contracts.py`, `routers/guest_requests.py`, `routers/lost_found.py`,
9-status kanban) before the phase began. The 12 plans extend those in place. Scope authority is
`HOTEL_STANDARDS_EXECUTION_PLAN.md` §Phase 5 + `05-CONTEXT.md` decisions D-01…D-17 (no formal
REQ-XXX IDs). Every decision was checked against the actual code, not against SUMMARY claims.

**All 17 decision contracts are implemented and wired in the codebase.** The only unverified
surfaces are (a) live Twilio SMS delivery — correctly deferred, no local credentials (D-01), and
(b) live browser click-through of the new UI — deferred by executors for the same no-credentials
reason. These are legitimate human-verification items, so the status is `human_needed` rather than
`passed`; no gaps or blockers were found.

### Observable Truths (by decision contract)

| #    | Truth / Decision | Status | Evidence |
| ---- | ---------------- | ------ | -------- |
| D-01 | Twilio SDK pinned; send wrapper; fake client for credential-free tests | ✓ VERIFIED (live delivery → human) | `requirements.txt:12` twilio==9.10.9; `services/sms/twilio_client.py` send_sms/is_configured/error classes; `tests/smoke/fake_twilio_client.py`; 92 phase-5 tests pass |
| D-02 | Inbound SMS reply-only match; unknown number creates nothing | ✓ VERIFIED | `webhooks.py:203-213` outbound+recipient match, `no_matching_outbound` returns ignored, never inserts a request |
| D-03 | Reactive opt-out on Twilio error 21610; later sends refused | ✓ VERIFIED | `twilio_client.py:61-62` raises SmsOptedOutError; `guest_requests.py:258-261` stamps contact_opted_out_at; send path checks opt-out |
| D-04 | Persisted guest_phone; auto-fills outbound recipient | ✓ VERIFIED | `migration 084:3`; `guest_requests.py:112` persist, `:226` SMS uses guest_phone only |
| D-05 | Message thread panel, per-message delivery status, role-gated reply | ✓ VERIFIED (visual → human) | `guest_requests.py:295-324` GET /messages with effective_delivery_status; `GuestRequestDrawer.tsx:58,240,269` gated reply + status pills |
| D-06 | Unified GM-only Management ROI page; non-GM refused | ✓ VERIFIED (visual → human) | `management_roi.py` 7 require_role("gm") endpoints; `management-roi/page.tsx:187-200` refusal screen; `Sidebar.tsx:50` GM-only nav |
| D-07 | GM-configured ADR; revenue = downtime hrs × ADR/24; 'not configured' state | ✓ VERIFIED | `migration 084:5-7` ADR cents; `contracts.py:247-264` configured/None branch; `settings/general/page.tsx` + `hotels.py:139-144` (WR-01 clear) |
| D-08 | Repeat failure = 2+ WOs in trailing 90-day window | ✓ VERIFIED | `contracts.py:135` calculate_repeat_failures; `management_roi.py:128` /repeat-failures 90-day default + explicit dates |
| D-09 | 7-day rooms-to-clean/labor forecast, no Opera dependency | ✓ VERIFIED | `contracts.py:450` project_seven_day_labor_forecast; `management_roi.py:283` /forecast-7day from trailing history |
| D-10 | Fixed 90-day retention clock at intake, backfilled | ✓ VERIFIED | `lost_found.py:22,73` RETENTION_PERIOD_DAYS=90; `migration 084:11` backfill of existing rows |
| D-11 | Retention pass flags for review only; human-authorized disposition | ✓ VERIFIED | `internal.py:676-695` flag-only (disposition_flagged_at, status untouched); `lost_found.py:203-205` disposition custody event |
| D-12 | Disposition RBAC = gm + housekeeping_supervisor + front_desk | ✓ VERIFIED | `lost_found.py:170` role set; `lost-found/page.tsx:327` canApproveDisposition includes front_desk |
| D-13 | Settings > Guest Requests SLA CRUD; gm + housekeeping_supervisor only | ✓ VERIFIED (visual → human) | `guest_requests.py:40,423-485` SLA_POLICY_ROLES CRUD; `settings/guest-requests/page.tsx:24`; `settings/layout.tsx:44` nav roles |
| D-14 | Accessibility features on a Settings > Rooms tab, not a new page | ✓ VERIFIED (visual → human) | `settings/rooms/page.tsx:191` rooms/accessibility tab strip; `:159` upsertAccessibleRoomFeature |
| D-15 | Accessibility request shows suitable rooms + live status (info only) | ✓ VERIFIED | `guest_requests.py:399-419` room_status enrichment; `GuestRequestDrawer.tsx:79` listAccessibleRoomFeatures for accessibility category |
| D-16 | 1-5 satisfaction on resolved/verified only; single-capture; event trail | ✓ VERIFIED | `guest_requests.py:327-360` role+status+single-capture gates + event; `GuestRequestDrawer.tsx:105` recordSatisfaction |
| D-17 | Human-in-loop resolution confirmation; no auto-send | ✓ VERIFIED | `GuestRequestDrawer.tsx:131,262` prefills reply textarea via setReply(template), no direct send call |

**Score:** 17/17 decision contracts verified in code (60/60 plan must-have truths code-verified). Visual/interactive and live-SMS confirmation routed to human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/084_...sql` | guest_phone, ADR cents, disposition flag, retention backfill, delivery-events table | ✓ VERIFIED | Append-only trigger + RLS + rollback all present |
| `apps/api/services/sms/twilio_client.py` | send_sms, is_configured, error classes | ✓ VERIFIED | All exports present; PII-safe logging |
| `apps/api/routers/webhooks.py` | twilio-sms + twilio-status webhooks | ✓ VERIFIED | Signature validation (prod), reply-only, 72h window |
| `apps/api/services/guest_recovery/contracts.py` | 8 new ROI calculators | ✓ VERIFIED | 8 pure functions, no network; WR-02 union dedup present |
| `apps/api/routers/management_roi.py` | 7 GM-only /reports/roi endpoints | ✓ VERIFIED | 361 lines; registered in `main.py:238` under /v1 |
| `apps/api/routers/lost_found.py` | 90-day retention + disposition_due filter | ✓ VERIFIED | RBAC role set correct |
| `apps/api/routers/internal.py` | retention-check cron, cron-secret guarded | ✓ VERIFIED | `:676-695`; WR-06 base_plan_price_cents at `:248` |
| `apps/web/app/(dashboard)/management-roi/page.tsx` | GM-only 4-theme dashboard | ✓ VERIFIED | 494 lines; non-GM refusal |
| `apps/web/app/(dashboard)/settings/guest-requests/page.tsx` | SLA rules UI | ✓ VERIFIED | 167 lines |
| `apps/web/components/settings/SlaPolicyForm.tsx` | SLA card/form components | ✓ VERIFIED | 198 lines; exports present |
| `apps/web/components/guest-requests/GuestRequestDrawer.tsx` | thread + satisfaction + confirmation | ✓ VERIFIED | Message thread, gated reply, satisfaction, D-17 prefill |
| `apps/web/components/guest-requests/NewRequestModal.tsx` | phone/consent/category/urgent-lock | ✓ VERIFIED | Accessibility urgent-lock at `:34-35,237` |
| `apps/web/app/(dashboard)/lost-found/page.tsx` | retention/custody/disposition UI | ✓ VERIFIED | Approve Disposition, disposition_due filter, custody history |
| `apps/web/lib/api/*` (guest_requests, managementRoi, lost_found, hotels) | typed clients | ✓ VERIFIED | All required methods present |

### Key Link Verification

| From | To | Status | Details |
| ---- | -- | ------ | ------- |
| `guest_requests.py` send_guest_message | `services.sms.twilio_client.send_sms` | ✓ WIRED | Outbound send after insert, error-branch handling |
| `webhooks.py` inbound | `guest_messages` (outbound reply-only) | ✓ WIRED | `.eq("direction","outbound")` + 72h window |
| `management_roi.py` | `services.guest_recovery.contracts` | ✓ WIRED | Every metric delegates to a pure calculator |
| `management_roi.py` | `tenants.average_daily_rate_cents` | ✓ WIRED | Tenant-scoped ADR feeds revenue calc |
| `main.py` | `management_roi.router` | ✓ WIRED | `include_router(..., prefix=PREFIX)` |
| `cron-jobs.yml` | `/v1/internal/lost-found/retention-check` | ✓ WIRED | Fired in the daily-6am group |
| `GuestRequestDrawer.tsx` | `listMessages` / `listAccessibleRoomFeatures` / `recordSatisfaction` | ✓ WIRED | useQuery/useMutation keyed on request id |
| `settings/layout.tsx` | `/settings/guest-requests` | ✓ WIRED | Nav entry roles gm + housekeeping_supervisor |
| `settings/rooms/page.tsx` | `upsertAccessibleRoomFeature` | ✓ WIRED | Accessibility tab save handler |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase 5 API tests pass | `pytest tests/test_twilio_sms.py test_management_roi.py test_lost_found_retention.py test_guest_recovery.py -q` | 92 passed | ✓ PASS |
| SMS signature / reply-only / opt-out covered | (in test_twilio_sms.py, 450 lines) | included in 92 | ✓ PASS |
| ROI calculators fixture-reconcilable | (in test_management_roi.py, 736 lines) | included in 92 | ✓ PASS |
| Lost&found flag-not-dispose + RBAC | (in test_lost_found_retention.py, 300 lines) | included in 92 | ✓ PASS |
| Full API suite (per lead) | `pytest tests/ -q` | 427 passed (reported) | ✓ PASS (reported) |
| Web type-check + prod build (per lead) | build 43 routes | clean (reported) | ? SKIP (not re-run; trusted) |

### Review-Fix Verification (05-REVIEW-FIX.md)

| Finding | Fix Claim | In Code? |
| ------- | --------- | -------- |
| CR-01 | SMS always uses on-file guest_phone, never caller recipient | ✓ `guest_requests.py:224-228` |
| CR-02 | status/resolved_at/resolved_by removed from UPDATE_COLUMNS | ✓ `guest_requests.py:28-35` |
| WR-01 | ADR clearable (frontend null + backend re-include) | ✓ `settings/general/page.tsx:144` + `hotels.py:143-144` |
| WR-02 | total_repeat_work_orders is distinct-WO union | ✓ `contracts.py:179-184` |
| WR-03 | prior-state seeding for cross-boundary intervals | ✓ `management_roi.py:27,105,163,200,309` |
| WR-04 | inbound match bounded to 72h window | ✓ `webhooks.py:26,204-208` |
| WR-05 | auto-task failure surfaced as meta.degraded | ✓ `guest_requests.py:167-172` |
| WR-06 | base fee reads settings.base_plan_price_cents | ✓ `internal.py:248` + `config.py:40` |

All 8 fixes are present in the code, not merely claimed.

### Anti-Patterns Found

No blocking anti-patterns. Spot-scanned the phase's new/modified files: no orphaned stubs, no
hardcoded-empty renders, no `return null`/placeholder handlers in the new surfaces. The webhook
signature check is intentionally gated to `app_env == "production"` (documented, allows local
testing without Twilio) — noted as informational, not a defect.

### Human Verification Required

See the `human_verification` frontmatter block. Six items, all runtime/visual or live-credential
dependent: (1) live Twilio SMS round-trip, (2) ROI dashboard browser click-through + role gating,
(3) ADR set/clear persistence, (4) drawer thread + satisfaction + resolution confirmation flow,
(5) SLA + accessibility settings CRUD, (6) lost&found disposition review role-gated flow.

### Gaps Summary

No gaps and no blockers. Every decision D-01 through D-17 is implemented, wired, and (where testable
without credentials) covered by passing tests. D-01 live SMS delivery is correctly deferred per
project CLAUDE.md (no local Twilio credentials) and is not a failure. The phase goal — closing guest
service loops and quantifying operational value — is achieved in code. Remaining work is human
confirmation of visual/interactive surfaces and eventual live-credential SMS verification.

---

_Verified: 2026-07-25T05:10:00Z_
_Verifier: Claude (gsd-verifier)_
