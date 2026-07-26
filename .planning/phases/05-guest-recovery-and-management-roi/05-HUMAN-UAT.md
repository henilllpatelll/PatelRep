---
status: blocked_on_credentials
phase: 05-guest-recovery-and-management-roi
source: [05-VERIFICATION.md]
started: 2026-07-25T05:10:00Z
updated: 2026-07-25T21:15:00Z
---

## Current Test

Only item 1 (live Twilio SMS) remains — blocked on missing local credentials, not a gap.

## Tests

### 1. Live Twilio SMS round-trip
expected: Outbound send reaches the guest; inbound reply appends to the correct request thread; an opted-out recipient disables the reply box and records contact_opted_out_at.
result: [blocked — no local Twilio credentials, D-01 accepted deferral]

### 2. Management ROI dashboard browser click-through (GM and non-GM)
expected: GM sees the four theme sections populated (or explicit "not configured"/"not computable" messages, never fabricated zeros); a non-GM sees the "available to the general manager" refusal screen and no partial data; the sidebar entry is absent for non-GM.
result: PASS — confirmed by manual check against localhost:3000

### 3. Average Daily Rate set/clear persistence round-trip
expected: The ADR persists across reload; clearing it (blank field) writes null and the downtime-revenue card then reports "not configured".
result: PASS — confirmed by manual check against localhost:3000

### 4. Guest-request drawer: message thread, reply, resolution confirmation, satisfaction capture
expected: Thread shows inbound/outbound messages with delivery-status pills; reply box is gated by role and opt-out; the confirmation prompt prefills the reply textarea without auto-sending; a 1-5 satisfaction score records once and cannot be overwritten.
result: PASS — confirmed by manual check against localhost:3000

### 5. Settings > Guest Requests SLA rules and Settings > Rooms Accessibility Features tab
expected: SLA rule create/list/delete works with confirmation copy; a new rule changes a matching new request's due date; the accessibility tab records a feature and its operational status persists; both surfaces are hidden from unauthorized roles.
result: PASS — confirmed by manual check against localhost:3000

### 6. Lost & Found disposition review queue (role-gated)
expected: The disposition-due filter lists only past-retention items; Approve Disposition is visible to gm/housekeeping_supervisor/front_desk and hidden from engineer/housekeeper; approving records a permanent custody event and disposes nothing automatically.
result: PASS — confirmed by manual check against localhost:3000

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

None. Item 1 (live Twilio SMS) remains blocked on missing local credentials per D-01 (accepted deferral, not a defect) — verify when Twilio credentials become available, e.g. in production or a credentialed environment.
