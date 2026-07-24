# Phase 5: Guest recovery and management ROI - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 20 (net-new + modified)
**Analogs found:** 20 / 20

**Brownfield note:** Most of Phase 5's data layer/backend already exists from commit `fea45b29`
(migration 072, `contracts.py`, `guest_requests.py`, `lost_found.py`, `reports.py`, kanban UI). This
map covers only the genuinely new/modified surfaces per `05-CONTEXT.md`/`05-RESEARCH.md`/`05-UI-SPEC.md`.
Do not re-derive patterns for already-shipped code — extend it in place per the excerpts below.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/routers/webhooks.py` (extend: `twilio_sms_webhook`, `twilio_status_webhook`) | controller (webhook) | event-driven | same file, `opera_webhook` + `_verify_opera_signature` | exact |
| `apps/api/services/sms/twilio_client.py` (new) | service | request-response | `apps/api/services/opera/webhooks.py` (dispatch handlers) + `stripe` SDK usage in `webhooks.py` | role-match |
| `apps/api/services/guest_recovery/contracts.py` (extend: opt-out check, repeat-failure window, revenue-impact, PM-deferral, 7-day forecast) | service (pure functions) | transform | same file, existing `calculate_guest_request_metrics` / `resolve_sla_minutes` | exact |
| `apps/api/routers/guest_requests.py` (extend: `guest_phone` on create; new SLA-policy CRUD endpoints) | controller | CRUD | same file, `upsert_accessible_room_feature` (upsert-style admin CRUD) | exact |
| `apps/api/routers/lost_found.py` (unchanged logic; consumed by new UI) | controller | CRUD | n/a — already complete | exact |
| `apps/api/routers/internal.py` (extend: `/lost-found/retention-check`) | controller (cron) | batch | same file, `check_due_pm` / `cleanup_expired_logbook_entries` | exact |
| `apps/api/routers/reports.py` or new `apps/api/routers/management_roi.py` (new ROI endpoints) | controller | request-response (aggregation) | same file, `get_maintenance_report` / `get_guest_recovery_report` | exact |
| `apps/api/models/requests.py` (extend: `guest_phone`, SLA policy request models) | model | CRUD | same file, `CreateGuestRequestRequest` / `UpsertAccessibleRoomFeatureRequest` | exact |
| `supabase/migrations/084_guest_phone_and_roi_extensions.sql` (new) | migration | CRUD | `supabase/migrations/072_guest_recovery_and_roi.sql` | exact |
| `apps/api/tests/test_twilio_sms.py` (new) | test | event-driven | `apps/api/tests/test_guest_recovery.py` | role-match |
| `apps/api/tests/test_management_roi.py` (new) | test | transform | `apps/api/tests/test_guest_recovery.py` | exact |
| `apps/api/tests/smoke/fake_twilio_client.py` (new, alongside `fake_supabase.py`) | test fixture | request-response | `apps/api/tests/smoke/fake_supabase.py` | role-match |
| `.github/workflows/cron-jobs.yml` (extend: register retention-check under `daily-6am`) | config | batch | same file, `daily-6am` job's `fire pm/check-due` line | exact |
| `apps/api/requirements.txt` (add `twilio==9.10.9`) | config | — | same file, `stripe==15.3.1` pin | exact |
| `apps/web/components/guest-requests/GuestRequestDrawer.tsx` (extend: message thread panel) | component | request-response | same file's own "Add Note" section (lines 71-92) | exact |
| `apps/web/lib/api/guest_requests.ts` (extend: `listMessages`, `guest_phone` field, SLA-policy client methods) | service (typed API client) | request-response | same file | exact |
| `apps/web/app/(dashboard)/settings/guest-requests/page.tsx` (new, D-13) | component (settings page) | CRUD | `apps/web/app/(dashboard)/settings/inspections/page.tsx` | exact |
| `apps/web/lib/api/guest_requests.ts` SLA-policy methods or new `apps/web/lib/api/slaPolicies.ts` | service (typed API client) | CRUD | `apps/web/lib/api/reports.ts` / `guest_requests.ts` shape | role-match |
| `apps/web/app/(dashboard)/settings/rooms/page.tsx` (extend: accessibility tab, D-14) | component (settings page) | CRUD | same file (table/filter chrome) + `GuestRequestsPage.tsx` tab-strip pattern (lines 205-221) | exact |
| `apps/web/app/(dashboard)/lost-found/page.tsx` (extend: custody/retention/disposition UI) | component | CRUD | same file's `ItemCard`/`STATUS_TONE`/claim-form block (lines 29-41, 365-390) | exact |
| `apps/web/lib/api/lost_found.ts` (extend: disposition fields, `disposition_due` filter) | service (typed API client) | CRUD | same file's existing shape (mirrors `guest_requests.ts`) | exact |
| `apps/web/app/(dashboard)/management-roi/page.tsx` (new, D-06) | component (dashboard page) | request-response (aggregation) | `apps/web/app/(dashboard)/reports/page.tsx` (`KpiCard`/`DateRangeSelector`) + `components/ui/primitives.tsx` `Stat` | exact |
| `apps/web/lib/api/managementRoi.ts` (new) | service (typed API client) | request-response | `apps/web/lib/api/reports.ts` | exact |

---

## Pattern Assignments

### `apps/api/routers/webhooks.py` — Twilio inbound SMS + status webhooks (controller, event-driven)

**Analog:** same file, existing `opera_webhook` (lines 36-90) and `_verify_opera_signature` (lines 23-33)

**Imports pattern** (lines 1-16):
```python
import hmac
import hashlib
import json
import logging
from datetime import datetime, timezone as tz, date
from fastapi import APIRouter, Request, HTTPException
import stripe
from core.database import supabase
from core.config import settings
from services.opera.webhooks import (
    handle_checkout, handle_checkin, handle_reservation_modified,
    handle_dnd, handle_make_up_room,
)
```
Add `from twilio.request_validator import RequestValidator` and
`from services.sms.twilio_client import send_sms` (new module) to this same import block.

**Signature verification pattern to mirror** (lines 23-33, `_verify_opera_signature`):
```python
def _verify_opera_signature(payload: bytes, signature_header: str, hotel_id: str) -> bool:
    if not signature_header:
        return False  # If no signature header, accept in dev (fail in prod)
    secret = f"{settings.cron_secret}:{hotel_id}".encode()
    expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)
```
Twilio equivalent (per RESEARCH.md Pattern 1) uses `RequestValidator(settings.twilio_auth_token).validate(url, params, signature)`
with the URL reconstructed from `X-Forwarded-Proto`/`Host` headers (Railway proxy gotcha — see Common Pitfall #2 in RESEARCH.md),
and the same **prod-only enforcement** idiom as `opera_webhook` (line 70): `if settings.app_env == "production" and not ...: raise HTTPException(401, ...)`.

**Dispatch + never-crash pattern** (lines 73-90):
```python
handlers = {
    "RESERVATION.CHECKED_OUT": handle_checkout,
    ...
}
handler = handlers.get(event_type)
if handler:
    try:
        handler(hotel_id, event_payload)
    except Exception as e:
        # Log but never crash — return 200 so Opera doesn't retry
        logger.error("Opera webhook handler error for %s: %s", event_type, e)
return {"status": "ok", "event_type": event_type}
```
Twilio's inbound SMS handler must follow the exact same never-500 idiom (Twilio retries on non-2xx) and tenant
resolution via a lookup table (compare to `creds = supabase.table("opera_credentials").select("tenant_id").eq(...).maybe_single().execute()`
at lines 56-66 — Twilio's equivalent lookup is the reply-only match against `guest_messages` described below, not a
credentials table).

**Reply-only inbound matching (D-02)** — new logic, no direct analog in `webhooks.py`, but follows `guest_requests.py`'s
query style (e.g. `_record_guest_request_event`, lines 38-50):
```python
recent_outbound = supabase.table("guest_messages").select(
    "guest_request_id, tenant_id"
).eq("direction", "outbound").eq("recipient", from_number).order(
    "created_at", desc=True
).limit(1).execute().data
if not recent_outbound:
    # No match — do NOT create a guest_request (D-02). Route to front-desk triage instead.
    ...
```

**Error handling:** Twilio webhooks must return `{"status": "ok"}` (plain JSON, no TwiML needed per RESEARCH.md) even
on internal errors, matching `opera_webhook`'s "log but never crash, return 200" idiom — do not let Twilio retry-storm
on a transient DB error.

---

### `apps/api/services/sms/twilio_client.py` (new) — outbound send wrapper (service, request-response)

**Analog:** No direct prior SMS analog exists (RESEARCH.md: "first SMS integration in the codebase"). Model the
module shape on `services/opera/webhooks.py`'s handler-function style (thin, single-purpose functions) and the
existing vendor-SDK usage pattern already established for Stripe in `webhooks.py` (`import stripe`, direct SDK calls,
no extra abstraction layer).

**Core pattern (from RESEARCH.md, Twilio SDK verified via Context7):**
```python
from twilio.rest import Client

def send_sms(to: str, body: str) -> dict:
    client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    try:
        message = client.messages.create(to=to, from_=settings.twilio_phone_number, body=body)
        return {"sid": message.sid, "status": message.status}
    except Exception as exc:
        # D-03 reactive opt-out: Twilio error code 21610 = "unsubscribed recipient"
        if getattr(exc, "code", None) == 21610:
            # caller (guest_requests.py's send_guest_message) must set contact_opted_out_at
            raise
        raise
```
**Testing:** build a `FakeTwilioClient` test double (RESEARCH.md Wave 0 Gap) that mirrors the structure of
`apps/api/tests/smoke/fake_supabase.py`'s `FakeDB` — same-file location convention (`tests/smoke/`), same
call-recording/assertion style.

---

### `apps/api/services/guest_recovery/contracts.py` (extend in place) — new pure metric formulas

**Analog:** same file, existing `calculate_guest_request_metrics` (lines 86-122) and `resolve_sla_minutes` (lines 46-63)

**Pattern to replicate exactly (pure function, deterministic, dict-in/dict-out, no I/O):**
```python
def calculate_guest_request_metrics(requests: list[dict[str, Any]]) -> dict[str, float | int]:
    total_requests = len(requests)
    if not total_requests:
        return {"total_requests": 0, "verified_resolution_rate_pct": 0.0, ...}
    ...
    return {"total_requests": total_requests, ...}


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _average(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0
```
New functions to add in this exact style: `calculate_repeat_failure_rate` (D-08, 90-day trailing window, list-in/count-out),
`calculate_downtime_revenue_impact` (D-07, `hours * (adr / 24)`), `calculate_pm_deferral_rate`, and
`project_seven_day_labor_forecast` (D-09, per RESEARCH.md Pattern 4 — trailing-average, NOT `services/ai/predictions.py`-derived).
Keep every new formula **free of any Supabase/network calls** — routers pass in pre-fetched lists exactly as
`get_guest_recovery_report` does at `reports.py` lines 21-25.

**Custom exception pattern to replicate** (lines 9-18):
```python
class InvalidGuestRequestTransition(ValueError):
    """Raised when a request skips a required service milestone."""
```
No new exception classes are needed for the new formulas (they're pure calculators, not validators) — but if a new
validator is added (e.g., an opt-out-blocks-send check), follow this exact `ValueError` subclass + docstring shape.

---

### `apps/api/routers/guest_requests.py` (extend) — `guest_phone` field + new SLA-policy CRUD

**Analog:** same file — `create_guest_request` (lines 66-136) for the `guest_phone` field addition; `upsert_accessible_room_feature`
(lines 250-267) as the closest existing "admin CRUD with RBAC gate" template for the new SLA-policy endpoints.

**RBAC gate pattern to copy** (lines 255-256):
```python
if current_user.role not in {"gm", "housekeeping_supervisor", "engineer"}:
    raise HTTPException(status_code=403, detail="Not authorized to manage accessible-room features")
```
For SLA-policy CRUD, RESEARCH.md doesn't lock an explicit role set — default to the same `{"gm", "housekeeping_supervisor"}`-style
gate used for `settings/inspections`-equivalent template management (see `TemplateFormCard` usage: `canManageTemplates = isGM || role === 'housekeeping_supervisor'`
in `settings/inspections/page.tsx` line 23) for consistency between UI gate and API gate.

**Upsert pattern to copy for `POST /guest-requests/sla-policies`** (lines 250-267, full body):
```python
@router.put("/accessibility/features")
async def upsert_accessible_room_feature(
    request: UpsertAccessibleRoomFeatureRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in {"gm", "housekeeping_supervisor", "engineer"}:
        raise HTTPException(status_code=403, detail="Not authorized to manage accessible-room features")
    room = supabase.table("rooms").select("id").eq("id", str(request.room_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    record = supabase.table("accessible_room_features").upsert({
        "tenant_id": current_user.hotel_id,
        **request.model_dump(mode="json"),
        "last_verified_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id,room_id,feature_code").execute().data[0]
    return {"data": record}
```
New endpoints needed (per RESEARCH.md Pitfall #3 — genuinely zero CRUD today): `GET /guest-requests/sla-policies` (list,
mirrors `list_guest_requests` pagination shape at lines 270-291), `POST /guest-requests/sla-policies` (create, mirrors
this upsert shape minus the room lookup), `DELETE /guest-requests/sla-policies/{id}` (mirrors `delete_guest_request`
lines 352-386's tenant-scoped delete).

**`guest_phone` field addition:** add `guest_phone: Optional[str]` to `CreateGuestRequestRequest` (models/requests.py)
and to the `gr_data` dict inside `create_guest_request` (line ~85-100), following the exact same optional-field
insertion style as `guest_name`/`contact_preference` already in that dict.

---

### `apps/api/routers/internal.py` (extend) — `/lost-found/retention-check` cron

**Analog:** same file, `check_due_pm` (lines 160-190) and `cleanup_expired_logbook_entries` (lines 676-689)

**Full pattern to copy:**
```python
@router.post("/pm/check-due")
async def check_due_pm(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    today = date.today()
    overdue_pms = supabase.table("pm_schedules").select("*, assets(tenant_id, name, id)").eq(
        "is_active", True
    ).lte("next_due_at", today.isoformat()).execute()
    created_count = 0
    for pm in (overdue_pms.data or []):
        ...
        created_count += 1
    _record_cron_run("pm.check-due")
    return {"status": "ok", "pm_work_orders_created": created_count}
```
New retention-check endpoint (RESEARCH.md's exact recommended shape, lines 306-321 of RESEARCH.md):
```python
@router.post("/lost-found/retention-check")
async def check_lost_found_retention(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    now = datetime.now(timezone.utc).isoformat()
    due = supabase.table("lost_found_items").select("id, tenant_id").eq(
        "status", "unclaimed"
    ).lt("retention_due_at", now).execute().data or []
    # D-11: flag only — do not auto-dispose. Use a derived/status filter, not the status enum itself.
    _record_cron_run("lost-found.retention-check")
    return {"status": "ok", "flagged": len(due)}
```
**Cron health tracking pattern to reuse verbatim** (`_record_cron_run`, lines 19-34) — every new cron endpoint must
call this at the end (success or failure path), exactly like every existing `/internal/*` handler does.

---

### `.github/workflows/cron-jobs.yml` (extend) — register retention-check

**Analog:** same file, `daily-6am` job (lines 70-90), specifically the `fire pm/check-due || rc=1` line (line 88)

**Pattern:** Add `fire lost-found/retention-check || rc=1` inside the existing `daily-6am` job's `fire()` call chain —
do NOT create a new `on.schedule` cron entry; this fits the existing `0 6 * * *` group exactly as RESEARCH.md recommends
(line 322 of RESEARCH.md: "fits without needing a new cron schedule entry").

---

### `apps/api/routers/reports.py` or new `management_roi.py` — ROI aggregation endpoints

**Analog:** same file, `get_maintenance_report` (lines 236-348) — closest existing multi-metric date-range aggregation

**Pattern to copy exactly (date-range params → tenant-scoped select → Python-side aggregation → `require_role` gate):**
```python
@router.get("/maintenance")
async def get_maintenance_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
    today = date.today()
    s = start_date or (today - timedelta(days=30))
    e = end_date or today
    wo_result = supabase.table("work_orders").select(
        "category, priority, status, due_at, started_at, completed_at, labor_hours, sla_minutes, created_at, guest_reported"
    ).eq("tenant_id", current_user.hotel_id).gte("created_at", s_str).lte("created_at", e_str).execute()
    work_orders = wo_result.data or []
    # ... Python-side aggregation (loops, dict counters) ...
    return {"data": {"period": {"start": s_str, "end": e_str}, ...}}
```
Every new ROI endpoint (`/roi/repeat-failures`, `/roi/downtime-revenue`, `/roi/pm-compliance`, `/roi/training-readiness`,
`/roi/inspection-trends`, `/roi/forecast-7day`) must use `Depends(require_role("gm"))` only (D-06: GM-only page),
`.eq("tenant_id", current_user.hotel_id)` on every query (the single most-repeated convention in this codebase — flagged
as the top cross-tenant-leak risk in RESEARCH.md's Security Domain section), and delegate the actual math to the new
pure functions added in `contracts.py` (never inline aggregation logic directly in the router beyond simple loops, matching
the `calculate_guest_request_metrics` delegation pattern already used in `get_guest_recovery_report`, lines 11-34).

**90-day trailing window default (D-08), copy exactly:**
```python
today = date.today()
start = start_date or (today - timedelta(days=90))  # D-08 default window
end = end_date or today
```

---

### `apps/api/tests/test_guest_recovery.py` / new `test_management_roi.py` / `test_twilio_sms.py`

**Analog:** `test_guest_recovery.py` (full file, 60 lines shown) — pure-function unit test style, no mocking framework,
plain `pytest.raises` for validators and plain `assert` for calculators.

**Pattern to copy exactly:**
```python
from services.guest_recovery.contracts import (
    AccessibilityPriorityError, InvalidGuestRequestTransition,
    MissingCustodyVerificationError, calculate_guest_request_metrics,
    resolve_sla_minutes, validate_guest_request_transition, validate_lost_found_custody_event,
)

def test_sla_policy_prefers_exact_category_priority_and_guest_impact_match():
    policies = [
        {"category": None, "priority": "normal", "guest_impact": None, "sla_minutes": 240},
        {"category": "accessibility", "priority": "urgent", "guest_impact": "high", "sla_minutes": 30},
    ]
    assert resolve_sla_minutes(policies, category="accessibility", priority="urgent", guest_impact="high") == 30
```
`test_management_roi.py` should test the new pure functions the same way (fixture dicts in, deterministic value out —
no Supabase mocking needed since these are pure). `test_twilio_sms.py` is the one file that DOES need a fake client
(signature validation, reply-only matching, send-error 21610 handling) — build `FakeTwilioClient` per RESEARCH.md's
Wave 0 gap, following `tests/smoke/fake_supabase.py`'s existing fixture-file convention.

---

### `apps/web/components/guest-requests/GuestRequestDrawer.tsx` (extend) — message thread panel (D-05)

**Analog:** same file's own "Add Note" section (lines 71-92) — per UI-SPEC.md, this is the exact block to clone, not
a new component pattern.

**Full analog block to extend in place:**
```tsx
const noteMutation = useMutation({
  mutationFn: (notes: string) => guestRequestsApi.updateRequest(request!.id, { notes }),
  onSuccess: () => { setNote(''); setError(null); onNoteAdded() },
  onError: (err: any) => setError(err.message || 'Failed to save note'),
})
...
<div>
  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-2">Add Note</p>
  <textarea
    value={note} onChange={e => setNote(e.target.value)} placeholder="Add an internal note..." rows={3}
    className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2.5 text-sm text-ink placeholder:text-ink4 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none resize-none"
  />
  {error && <p className="mt-1 text-[12px] text-[var(--alert)]">{error}</p>}
  <div className="mt-2 flex justify-end">
    <Button variant="primary" className="text-xs py-1.5" disabled={!note.trim() || noteMutation.isPending}
      onClick={() => noteMutation.mutate(note.trim())}>
      <Send size={13} />
      {noteMutation.isPending ? 'Saving...' : 'Save Note'}
    </Button>
  </div>
</div>
```
New message panel: replace the single "Add Note" textarea+button with (1) a scrollable ordered list of
`guest_messages` (inbound/outbound, `delivery_status` pill using the existing `Pill` primitive from
`components/ui/primitives.tsx`, per UI-SPEC.md's color mapping: `--ready`=delivered, `--info`=sent, `--caution`=queued,
`--alert`=failed, `--blocked`=opted-out) fetched via `useQuery` (same `@tanstack/react-query` import already at line 5),
plus (2) a reply box gated to `MESSAGE_ROLES` (`front_desk`, `housekeeping_supervisor`, `engineer`, `gm` — from
`apps/api/routers/guest_requests.py` line 35) using the exact same `useMutation`/`disabled`/`Button` shape shown above.
Copy CTA label: "Send Reply" per UI-SPEC.md's Copywriting Contract. Header size for any new sub-heading inside this
panel must be 20px per UI-SPEC.md Typography (not the drawer's existing 22px/26px room-number headers, which are
legacy and untouched).

**Empty state copy (per UI-SPEC.md):** Heading "No messages yet" / Body "Outbound texts to the guest and their replies
will appear here in order."

**Opted-out inline state (per UI-SPEC.md, not a confirm dialog):** disable the reply textarea/button and show
"This guest has opted out of SMS. Replies are disabled." — reuse the existing `error`-paragraph styling
(`text-[12px] text-[var(--alert)]`, line 80) for this inline message.

---

### `apps/web/lib/api/guest_requests.ts` (extend) — typed client additions

**Analog:** same file (full file shown, 104 lines) — this IS the pattern; extend it, do not create a parallel client.

**Existing shape to replicate for new methods:**
```typescript
export const guestRequestsApi = {
  sendMessage: (id: string, payload: { body: string; recipient: string; channel?: 'sms' | 'email' }) =>
    apiClient.post(`/guest-requests/${id}/messages`, payload),
  getMetrics: () => apiClient.get('/guest-requests/metrics/summary') as Promise<{ data: GuestRequestMetrics }>,
}
```
Add: `listMessages: (id: string) => apiClient.get(\`/guest-requests/${id}/messages\`) as Promise<{ data: GuestMessage[] }>`
(new endpoint needed alongside the router work above), a `GuestMessage` interface mirroring the `guest_messages` table
columns (`direction`, `channel`, `body`, `recipient`, `delivery_status`, `created_at`), and `guest_phone?: string` added
to the `GuestRequest` interface (line 7-34) and to `createRequest`'s payload type (lines 48-59). Add SLA-policy CRUD
methods (`listSlaPolicies`, `createSlaPolicy`, `deleteSlaPolicy`) in this same file or a sibling `slaPolicies.ts` —
planner's call, both satisfy the one-client-per-domain convention.

---

### `apps/web/app/(dashboard)/settings/guest-requests/page.tsx` (new, D-13) — SLA policy settings page

**Analog:** `apps/web/app/(dashboard)/settings/inspections/page.tsx` (full file, 193 lines) — UI-SPEC.md says clone this
exactly.

**Full page shape to clone:**
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function GuestRequestsSettingsPage() {
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'
  const [formOpen, setFormOpen] = useState<'create' | string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data: policies = [], refetch } = useQuery({
    queryKey: ['sla-policies'],
    queryFn: () => guestRequestsApi.listSlaPolicies(),
    enabled: canManage,
    select: (res: any) => res.data ?? [],
  })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])
  // ... save/delete handlers mirroring saveTemplate/deleteTemplate (lines 46-90) exactly ...
}
```
**Toast pattern to copy verbatim** (lines 94-109):
```tsx
{toast && (
  <div role="alert" className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
    toast.type === 'success'
      ? 'bg-[var(--ready-soft)] border-[var(--ready-line)] text-green-800'
      : 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-red-800'
  }`}>
    <CheckCircle2 size={16} className={toast.type === 'success' ? 'text-[var(--ready)]' : 'text-[var(--alert)]'} />
    {toast.message}
  </div>
)}
```
**Empty state pattern to copy** (lines 145-154, using `Card`): swap icon for something SLA-relevant (e.g. `Clock` from
`lucide-react`, already used elsewhere in this codebase), copy per UI-SPEC.md: Heading "No SLA rules yet" / Body
"Create a rule to override the default 240-minute response time by category, priority, and guest impact." CTA per
UI-SPEC.md Copywriting Contract: "New SLA Rule" (mirrors "New Template" at line 129).
**New form component:** build `SlaPolicyFormCard`/`SlaPolicyCard` as siblings of the existing
`components/settings/TemplateForm.tsx`'s `TemplateCard`/`TemplateFormCard` (imported at lines 11-16) — same
component-pair shape (list card + edit/create card), fields: category, priority, guest_impact, sla_minutes (use
`font-mono` for the numeric minutes value per UI-SPEC.md Typography).

---

### `apps/web/app/(dashboard)/settings/rooms/page.tsx` (extend) — accessibility features tab (D-14)

**Analog:** same file's existing rooms table/filter chrome (lines 39-120+, `RoomsSettingsPage`) for the table reuse,
plus `GuestRequestsPage.tsx`'s tab-strip pattern (lines 205-221) for the new tab UI per UI-SPEC.md.

**Tab strip pattern to copy exactly:**
```tsx
const [activeTab, setActiveTab] = useState<'rooms' | 'accessibility'>('rooms')
...
<div className="flex border-b border-line bg-surface px-6 shrink-0">
  {(['rooms', 'accessibility'] as const).map(tab => (
    <button key={tab} onClick={() => setActiveTab(tab)}
      className={cn(
        'px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors',
        activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-ink3 hover:text-ink'
      )}>
      {tab === 'rooms' ? 'Rooms' : 'Accessibility Features'}
    </button>
  ))}
</div>
```
**Existing room-list state/query pattern to reuse for the new tab's room picker** (lines 51-63): the existing
`useQuery(['rooms'], () => roomsApi.list())` + `allRooms`/`roomFloors` derivation is the exact data source for D-15's
"show rooms with relevant `accessible_room_features`" inline guidance — do not re-fetch rooms separately, filter the
already-loaded list.

**API already exists** (`GET`/`PUT /guest-requests/accessibility/features`) — this tab is UI-only work; wire to
`guestRequestsApi.listAccessibleRoomFeatures`/`upsertAccessibleRoomFeature` (new client methods to add to
`guest_requests.ts`, following the `sendMessage`/`getMetrics` shape shown above).

---

### `apps/web/app/(dashboard)/lost-found/page.tsx` (extend) — custody/retention/disposition UI

**Analog:** same file — `STATUS_TONE`/`STATUS_LABELS` maps (lines 29-41) and the `claimTarget` inline confirm form
(lines 365-390) are the exact patterns UI-SPEC.md says to clone for `disposition_due` + "Approve Disposition".

**Status-tone map to extend (add a new tone, don't restructure):**
```tsx
const STATUS_TONE: Record<LostFoundStatus, 'info' | 'ready' | 'ai' | 'neutral'> = {
  unclaimed: 'info', claimed: 'ready', donated: 'ai', discarded: 'neutral',
}
const STATUS_LABELS: Record<LostFoundStatus, string> = {
  unclaimed: 'Unclaimed', claimed: 'Claimed', donated: 'Donated', discarded: 'Discarded',
}
```
Add a `disposition_due: 'caution'` entry (per UI-SPEC.md's Color mapping: `--caution` for the disposition-due flag pill)
as a derived/computed Pill (not a real `status` enum value — matches RESEARCH.md's Common Pitfall about not conflating
the flag with the `status` column) rendered conditionally when `retention_due_at < now && status === 'unclaimed'`.

**Inline confirm form to clone exactly for disposition approval** (lines 365-390):
```tsx
{claimTarget && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/30" onClick={() => setClaimTarget(null)} />
    <form className="relative z-10 w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl"
      onSubmit={(event) => { event.preventDefault(); releaseItem(claimTarget) }}>
      <h2 className="text-lg font-semibold text-ink">Release found item</h2>
      <p className="mt-1 text-sm text-ink3">Record who received this item and how their identity was verified.</p>
      <label className="mt-4 block text-sm font-medium text-ink2">
        Recipient name
        <input required value={releaseRecipient} onChange={(event) => setReleaseRecipient(event.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      ...
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setClaimTarget(null)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={releasing || !releaseRecipient.trim() || !verificationMethod.trim()}>
          {releasing ? 'Recording...' : 'Record Release'}
        </Button>
      </div>
    </form>
  </div>
)}
```
The mutation this form calls (`releaseItem`, lines 263-276) uses `lostFoundApi.recordCustodyEvent(item.id, { event_type: 'released', ... })` —
the new disposition form calls the same API method with `event_type: 'disposition', disposition: 'donated'|'discarded'`,
gated to D-12's exact role set `{gm, housekeeping_supervisor, front_desk}` (already enforced API-side in `lost_found.py`
line 162 — UI gate should mirror it: `const canApproveDisposition = isGM || role === 'housekeeping_supervisor' || role === 'front_desk'`).

**Destructive-confirm copy (per UI-SPEC.md):** "Approve disposition: mark as {donated / discarded}" / "This creates a
permanent, append-only record and cannot be undone." — reuse `DeleteConfirmDialog` (already imported at line 26) rather
than a new confirm component, matching its default "This action cannot be undone" tone.

**CTA label:** "Approve Disposition" per UI-SPEC.md.

---

### `apps/web/app/(dashboard)/management-roi/page.tsx` (new, D-06) — Management ROI dashboard

**Analog:** `apps/web/app/(dashboard)/reports/page.tsx`'s `KpiCard` (lines 117-137) + `DateRangeSelector` (lines 84-113)
chrome, but per UI-SPEC.md use the more polished `Stat` primitive from `components/ui/primitives.tsx` (lines 194-216)
instead of the page-local `KpiCard`.

**`DateRangeSelector` to copy verbatim** (lines 84-113):
```tsx
function DateRangeSelector({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const options: { label: string; value: DateRange }[] = [
    { label: 'Last 7 days', value: '7d' }, { label: 'Last 30 days', value: '30d' }, { label: 'Last 90 days', value: '90d' },
  ]
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-gray-50 p-1">
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value ? 'bg-surface text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>{opt.label}</button>
      ))}
    </div>
  )
}
```
**`Stat` primitive to use instead of `KpiCard` (from `components/ui/primitives.tsx` lines 194-216):**
```tsx
export function Stat({ label, value, unit, delta, deltaTone = 'ready', hint, icon, className }: StatProps) {
  return (
    <div className={cn('bg-surface border border-line rounded-[var(--r-lg)] p-[14px_16px] flex flex-col gap-1.5 min-h-[96px]', className)}>
      <div className="flex justify-between items-start">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 leading-none">{label}</span>
        {icon && <span className="text-ink4">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[32px] leading-none text-ink font-normal">{value}</span>
        {unit && <span className="text-[12px] font-mono text-ink-3">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-auto">
        {delta && <Pill tone={deltaTone} size="sm">{delta}</Pill>}
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </div>
    </div>
  )
}
```
Organize into 4 theme sections per UI-SPEC.md's D-06 mapping (Time Saved=`--ready`, Quality=`--info`,
Response=`--caution`, Revenue Protected=`--accent`), NOT per-domain tabs. Page-level heading uses 20px per UI-SPEC.md
(not the legacy 22px kanban `<h1>`).

**Empty-state copy (per UI-SPEC.md):** "Not enough data yet" / "Metrics populate as guest requests, work orders, and
inspections are recorded over time."

**Data-fetch pattern to copy** (`DailySummaryTab`, lines 147-155): `useQuery({ queryKey: [...], queryFn: () => api.getX(params) })`
per parallel ROI endpoint — 6-8 parallel `useQuery` calls (one per new `/reports/roi/*` endpoint), matching how
`reports/page.tsx` already fans out per-tab queries. Route requires `require_role("gm")` gate client-side via `useRole()`
(mirrors `isGM` checks already used in `settings/inspections/page.tsx` line 22-23) in addition to the API-side gate.

---

### `apps/web/lib/api/reports.ts` → new `apps/web/lib/api/managementRoi.ts`

**Analog:** `apps/web/lib/api/reports.ts` (full file, 76 lines) — this is the exact client shape to replicate for the
new ROI domain.

**Pattern to copy exactly:**
```typescript
import { apiClient } from '@/lib/api/client'

export interface MaintenanceReport {
  period: { start: string; end: string }
  total_work_orders: number
  completed: number
  ...
}

export const reportsApi = {
  getMaintenance: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get('/reports/maintenance', { params }) as Promise<{ data: MaintenanceReport }>,
}
```
New `managementRoiApi` object with one method per new ROI endpoint (`getRepeatFailures`, `getDowntimeRevenue`,
`getPmCompliance`, `getTrainingReadiness`, `getInspectionTrends`, `getForecast`), each typed with a matching
`interface`, following this exact `{ data: T }` response envelope (the single most consistent convention across every
typed client in this codebase per `CLAUDE.md`'s "API responses" section).

---

## Shared Patterns

### Multi-tenancy (apply to every new query, every file)
**Source:** repeated throughout `guest_requests.py`, `lost_found.py`, `reports.py`, `internal.py`
```python
.eq("tenant_id", current_user.hotel_id)
```
**Apply to:** every new Supabase query in `webhooks.py` (Twilio handlers), `contracts.py`-consuming routers, the new
SLA-policy CRUD endpoints, the new ROI endpoints, and the retention-check cron. This is flagged in RESEARCH.md's
Security Domain as "the one most likely to be missed under time pressure when writing 6+ new aggregation endpoints" —
treat as the single highest-priority review item across this phase.

### RBAC gating
**Source:** `middleware/auth.py` lines 127-136 (`require_role`) and manual role-set checks in `lost_found.py` line 162,
`guest_requests.py` lines 177, 216, 255-256
```python
current_user: CurrentUser = Depends(require_role("gm"))
# or, for multi-role manual sets:
if current_user.role not in {"front_desk", "housekeeping_supervisor", "gm"}:
    raise HTTPException(status_code=403, detail="Not authorized to change item custody")
```
**Apply to:** ROI endpoints use `require_role("gm")` only (D-06). Disposition approval uses the manual-set style with
the exact D-12 role tuple `{"front_desk", "housekeeping_supervisor", "gm"}` — do not narrow, this was an explicit user
override. SLA-policy CRUD should use the manual-set style matching `settings/inspections`'s `canManageTemplates`
(`gm`, `housekeeping_supervisor`).

### API response envelope
**Source:** every router in this codebase (`{"data": ...}`, lists add `"meta"`)
```python
return {"data": result.data[0] if result.data else None}
return {"data": items, "meta": {"page": page, "per_page": per_page}}
```
**Apply to:** all new endpoints without exception — SLA-policy CRUD, ROI aggregation, retention-check cron
(`{"status": "ok", "flagged": len(due)}` follows the cron-specific `{"status": "ok", ...}` variant used by every
`/internal/*` endpoint, not the `{"data": ...}` variant).

### Append-only event tables via `SECURITY DEFINER`-style reject trigger
**Source:** `supabase/migrations/072_guest_recovery_and_roi.sql` lines 116-121
```sql
CREATE OR REPLACE FUNCTION public.reject_guest_recovery_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Guest recovery and custody events are append-only.'; END; $$;
CREATE TRIGGER guest_messages_immutable BEFORE UPDATE OR DELETE ON public.guest_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_recovery_mutation();
```
**Apply to:** if `guest_phone` migration 084 needs any new event-style table (unlikely — it's a plain column add),
follow this exact trigger-function-per-table naming (`reject_guest_recovery_mutation` is reusable if the new table
lives in the same domain; otherwise clone with a new function name).

### RLS tenant policy
**Source:** `supabase/migrations/072_guest_recovery_and_roi.sql` lines 123-135
```sql
ALTER TABLE public.guest_request_sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_guest_request_sla_policies" ON public.guest_request_sla_policies
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
```
**Apply to:** migration 084 — no new tables are strictly required for `guest_phone` (plain `ALTER TABLE ... ADD COLUMN`
on `guest_requests`, which already has RLS from earlier migrations), but if disposition-due tracking needs a new
column/table, use this exact policy shape.

### Migration numbering
**Source:** `supabase/migrations/` directory listing — last file is `083_program_template_facilities.sql`; `082` is a
known intentional gap (per `CLAUDE.md` and RESEARCH.md Pitfall #5).
**Apply to:** the new Phase 5 migration MUST be numbered `084_...` — do not attempt to fill gap `082`.

### Pydantic request model hygiene
**Source:** `apps/api/models/requests.py` lines 58-70 (`SanitizedBaseModel`) and lines 794-841 (existing Phase 5 models)
```python
class SanitizedBaseModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    @field_validator("*", mode="before")
    @classmethod
    def sanitize_string_fields(cls, value: Any, info):
        return _sanitize_untrusted_value(value, info.field_name or "")

class CreateGuestMessageRequest(SanitizedBaseModel):
    body: str = Field(min_length=1, max_length=LONG_TEXT_MAX)
    recipient: str = Field(min_length=7, max_length=MEDIUM_TEXT_MAX)
    channel: Literal["sms", "email"] = "sms"
```
**Apply to:** every new request body model (guest_phone field addition, SLA-policy create/update models) must extend
`SanitizedBaseModel`, not plain `BaseModel` — this is the codebase's V5 Input Validation control per RESEARCH.md's
Security Domain section.

### Router registration in `main.py`
**Source:** `apps/api/main.py` lines 217-245
```python
app.include_router(guest_requests.router, prefix=PREFIX)
app.include_router(lost_found.router, prefix=PREFIX)
app.include_router(reports.router, prefix=PREFIX)
```
**Apply to:** if the planner chooses a new `management_roi.py` router (RESEARCH.md Alternative — either choice is
valid), add `from routers import ... management_roi` to the import block (line 14) and
`app.include_router(management_roi.router, prefix=PREFIX)` alongside the existing entries, in the same declarative
list style (no special ordering required).

### Cron secret guard
**Source:** `apps/api/routers/internal.py` lines 14-16
```python
def verify_cron(x_cron_secret: str = Header(None)):
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Invalid cron secret")
```
**Apply to:** `/lost-found/retention-check` must call `verify_cron(x_cron_secret)` as its first line, identical to
every other `/internal/*` handler.

### React Query + typed client + toast pattern (web settings pages)
**Source:** `apps/web/app/(dashboard)/settings/inspections/page.tsx` (full pattern, lines 30-90)
**Apply to:** `settings/guest-requests/page.tsx` (new) and any list/create/edit flow touching SLA policies or
accessibility features — `useQuery` for list, imperative `async function saveX()` handlers for create/update (not
`useMutation`, matching this specific page's existing style — note `lost-found/page.tsx` DOES use `useMutation`, so
either idiom is acceptable per-surface as long as it's internally consistent within the new file).

---

## No Analog Found

None — every file in scope has at least a role-match analog in the existing codebase. The only genuinely
"first-of-its-kind" piece is the Twilio SMS vendor integration itself (no prior SMS/messaging-provider code exists),
but its *structural* pattern (webhook signature verification + dispatch, vendor SDK wrapper) is fully covered by the
Opera/Stripe webhook analogs above — RESEARCH.md confirms this explicitly ("Every 'don't hand-roll' item in this phase
has a working precedent already in this exact codebase").

## Metadata

**Analog search scope:** `apps/api/routers/`, `apps/api/services/`, `apps/api/models/`, `apps/api/tests/`,
`apps/api/main.py`, `supabase/migrations/`, `.github/workflows/cron-jobs.yml`, `apps/web/app/(dashboard)/`,
`apps/web/components/guest-requests/`, `apps/web/components/ui/`, `apps/web/lib/api/`
**Files scanned:** `webhooks.py`, `internal.py`, `guest_requests.py`, `lost_found.py`, `reports.py`,
`services/guest_recovery/contracts.py`, `models/requests.py`, `middleware/auth.py`, `main.py`, `hotels.py`,
`tests/test_guest_recovery.py`, `migrations/072_guest_recovery_and_roi.sql`, `GuestRequestDrawer.tsx`, `HistoryTab.tsx`,
`GuestRequestsPage.tsx`, `guest_requests.ts`, `reports.ts`, `client.ts`, `settings/inspections/page.tsx`,
`settings/rooms/page.tsx`, `lost-found/page.tsx`, `reports/page.tsx`, `components/ui/primitives.tsx`
**Pattern extraction date:** 2026-07-24
