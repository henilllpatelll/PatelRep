# Phase 5: Guest recovery and management ROI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 5-Guest recovery and management ROI
**Areas discussed:** Guest messaging (SMS), Management ROI dashboard, Lost & found retention/disposition, Accessibility ops & SLA config UI

---

## Guest messaging (SMS)

| Option | Description | Selected |
|--------|-------------|----------|
| Twilio | Industry standard, outbound send + inbound webhook, mirrors existing Opera/Stripe webhook pattern; no local creds yet | ✓ |
| Provider-agnostic interface now, pick later | Thin SmsProvider interface with stub implementation | |

**User's choice:** Twilio
**Notes:** No live Twilio credentials exist locally — same situation as AI/Stripe.

| Option | Description | Selected |
|--------|-------------|----------|
| Reply-only | Match inbound to most recent open request with an outbound thread to that number; no match → manual triage | ✓ (Claude's discretion) |
| Auto-create new request | No thread → auto-create a new open request from message body alone | |

**User's choice:** "You decide" — Claude selected reply-only matching to avoid phantom-request noise.

| Option | Description | Selected |
|--------|-------------|----------|
| Provider-level opt-out | Rely on Twilio's STOP/START handling + status webhook | ✓ |
| Custom keyword parsing | Parse inbound body ourselves in addition | |

**User's choice:** Provider-level

| Option | Description | Selected |
|--------|-------------|----------|
| Code-complete + mocked tests | Same pattern as AI/Stripe — implement fully, test against fake provider, flag live delivery unverified | ✓ |
| Defer SMS entirely to a follow-up phase | Ship everything else now, SMS later | |

**User's choice:** Code-complete + mocked tests

| Option | Description | Selected |
|--------|-------------|----------|
| Add guest_phone to guest_requests | Captured once at creation, auto-fills recipient, match key for inbound | ✓ |
| Keep per-message recipient, no stored number | Staff retypes number every message | |

**User's choice:** Add guest_phone to guest_requests

| Option | Description | Selected |
|--------|-------------|----------|
| Add a message thread panel in GuestRequestDrawer | Inbound/outbound thread + reply box, gated to MESSAGE_ROLES | ✓ |
| Separate messaging tab/page | Keep drawer focused on lifecycle+notes | |

**User's choice:** Add a message thread panel in GuestRequestDrawer

---

## Management ROI dashboard

| Option | Description | Selected |
|--------|-------------|----------|
| New unified 'Management ROI' page | Pulls all metrics together, organized around time saved/quality/response/revenue | ✓ |
| Extend the existing Reports page tabs | Add sections to current /reports | |

**User's choice:** New unified 'Management ROI' page

| Option | Description | Selected |
|--------|-------------|----------|
| GM sets an average daily rate in Settings | ADR field in Settings > General; revenue impact = downtime hrs × (rate/24) | ✓ |
| Pull from Opera Cloud sync when available, fallback to manual | More accurate for Opera-enabled pilots | |

**User's choice:** GM sets an average daily rate in Settings

| Option | Description | Selected |
|--------|-------------|----------|
| Same asset/room, 2+ failures in trailing 90 days | Configurable start/end like other reports | ✓ (Claude's discretion) |
| You decide | | |

**User's choice:** "You decide" — Claude selected the 90-day/2+ definition.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing prediction infrastructure | Extend room-readiness prediction cron + housekeeper_profiles data | ✓ (Claude's discretion) |
| You decide | | |

**User's choice:** "You decide" — Claude to research existing prediction code during phase research and extend it if it fits.

---

## Lost & found retention/disposition

| Option | Description | Selected |
|--------|-------------|----------|
| 90 days | Common hotel-industry default, fixed | ✓ |
| Configurable per hotel in Settings | GM sets the window | |

**User's choice:** 90 days

| Option | Description | Selected |
|--------|-------------|----------|
| Flag for review, no auto-action | Cron marks disposition_due; manager still must log the disposition custody event | ✓ |
| Auto-notify management only | Same + notification_deliveries entry | |

**User's choice:** Flag for review, no auto-action

| Option | Description | Selected |
|--------|-------------|----------|
| gm and housekeeping_supervisor | Restricts disposition approval to supervisor+ | |
| gm only | Tighter control | |
| *(user override)* gm, housekeeping_supervisor, and front_desk | Matches the exact custody-event RBAC already in lost_found.py | ✓ |

**User's choice:** Custom — gm, housekeeping_supervisor, and front_desk
**Notes:** User explicitly rejected narrowing to supervisor+ only; wanted parity with existing custody-event RBAC.

---

## Accessibility ops & SLA config UI

| Option | Description | Selected |
|--------|-------------|----------|
| Settings > Guest Requests page | New page for SLA rules by category+priority+guest_impact | ✓ |
| Defer — hardcode sensible defaults instead | Pre-seed via migration, no admin UI | |

**User's choice:** Settings > Guest Requests page

| Option | Description | Selected |
|--------|-------------|----------|
| New tab on Settings > Rooms | Reuse existing room list/selection UI | ✓ |
| Standalone Accessibility page | Separate top-level settings page | |

**User's choice:** New tab on Settings > Rooms

| Option | Description | Selected |
|--------|-------------|----------|
| Show matching accessible rooms on the request | Informational list of qualifying rooms, not automated assignment | ✓ |
| You decide | | |

**User's choice:** Show matching accessible rooms on the request

---

## Claude's Discretion

- Inbound SMS matching logic (reply-only, no auto-create)
- "Repeat failure" definition: same asset/room, 2+ occurrences, trailing 90-day window
- Whether/how to reuse existing room-readiness prediction infrastructure for the 7-day forecast (deferred to research step)

## Deferred Ideas

None — discussion stayed within phase scope.
