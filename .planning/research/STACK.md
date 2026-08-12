# Stack Research

**Domain:** AI Copilot Proactive Intelligence — actionable predictions + proactive alerting for hotel ops (v1.6 milestone)
**Researched:** 2026-08-12
**Confidence:** HIGH

## Headline Finding

**No new libraries, services, or infrastructure are required for this milestone.** Both new
capabilities — (a) one-click reassign/escalate on room-readiness predictions and (b) a proactive
push path for newly-HIGH-risk failure predictions — are fully served by dependencies and patterns
that already ship in the codebase. The work is *wiring*, not *adopting*.

This is the correct outcome given the project's explicit zero-dependency bias and the architecture
decision that scopes Supabase Realtime to only three surfaces. Adding a web-push stack or a new
notification service here would be net-new surface area for capabilities that two existing patterns
(the `ai_recommendations` lifecycle and the `notifications` table + polling bell) already cover.

## Recommended Stack

### Core Technologies (all already installed — reuse, do not add)

| Technology | Version (installed) | Purpose in this milestone | Why it's the right tool |
|------------|--------------------|---------------------------|-------------------------|
| `@radix-ui/react-toast` (via `components/ui/Toast.tsx`) | 1.2.23 | Fire-and-forget success/error feedback after one-click reassign/escalate | Already mounted globally via `<Toaster/>` in `DashboardShell.tsx`; `useToast()` API exists and is used in 8+ screens. Confirmation UX for the new actions is a solved problem. |
| `@tanstack/react-query` | 5.101.4 | Mutations for reassign/escalate + cache invalidation; polling of predictions and notifications | Existing pattern: `AIRiskAlertsPanel` polls at 120s, `Header` polls unread notifications. New actions are `useMutation` + `invalidateQueries`. No new state layer. |
| `supabase` (Python SDK) | 2.31.0 | New API endpoints write to `ai_recommendations` / `room_assignments` and insert into `notifications` | No-ORM convention; the failure-prediction dashboard already drives the full `ai_recommendations` lifecycle this way. |
| Supabase Realtime (built-in) | — | **Do not extend.** Already covers the 3 sanctioned surfaces | Architecture decision A2 caps Realtime to 3 surfaces. This milestone does not justify a 4th subscription (see What NOT to Use). |

### Supporting Libraries (already installed — no version change)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `twilio` (Python) | 9.10.9 | *Optional, production-only* SMS to floor staff for HIGH-risk alerts | Already a dependency, but **no local credentials** — cannot be exercised locally. Treat SMS as a deferred differentiator, not MVP for this milestone. Flag any task that depends on it. |
| `lucide-react` | 1.30.0 | Action-button iconography (reassign, escalate, authorize) | Already the icon system across all panels. |
| `zod` | 4.4.3 | Validate new action request bodies at the boundary | Existing web-side validation convention. |

### Backend (already installed — no version change)

| Technology | Version | Purpose | Notes |
|------------|---------|---------|-------|
| `fastapi` | 0.141.1 | New action endpoints under existing `ai_copilot`/`housekeeping` routers | Follow `{ "data": ... }` response convention; gate with `require_role`. |
| `apscheduler` | 3.11.3 | Existing nightly `ai.failure-predictions` cron gains a notifications-insert step | No new job needed — extend `run_all_hotels_failure_predictions` to mirror the room-readiness escalation logic. |

## Installation

```bash
# Nothing to install. All required packages are already in
# apps/web/package.json and apps/api/requirements.txt.
```

## Integration Points (how the two capabilities map onto existing patterns)

### (a) One-click reassign/escalate on room-readiness predictions
- **Reuse the `ai_recommendations` lifecycle.** `routers/ai_copilot.py` already implements
  `create → authorize → mark-executed → outcome` with transition validation
  (`validate_recommendation_transition`) and an event log (`_append_recommendation_event`). The
  failure-prediction dashboard (`engineering/predictions/page.tsx`) already consumes it end-to-end.
  Add room-readiness action endpoints that create/authorize recommendations against the same table,
  and have "reassign" write to `room_assignments` (`assigned_to`, `assignment_date`).
- **Frontend:** upgrade `components/housekeeping/PredictionPanel.tsx` (currently read-only) with
  action buttons using `useMutation` + `useToast()`. Mirror the button pattern already present in
  the failure-prediction dashboard.
- **No Realtime needed** — housekeeping already refreshes via the existing patterns; the action
  result is confirmed by a toast + query invalidation.

### (b) Proactive push for newly-HIGH-risk failure predictions
- **Copy the room-readiness escalation, verbatim in shape.** `services/ai/predictions.py` already
  detects a `previous_risk != "HIGH"` transition and inserts rows into the generic `notifications`
  table for supervisors + GMs (`_notify_high_risk_supervisors` style logic). `failure_predictions.py`
  does **not** yet do this — add the identical previous-vs-current diff + `notifications` insert to
  the nightly cron.
- **Delivery is already handled:** `Header.tsx` polls `notifications.list({ is_read: false })` and
  renders the bell + unread badge. New rows surface automatically. No push service, no service
  worker, no VAPID keys.

## Alternatives Considered

| Recommended | Alternative | When the alternative would be justified |
|-------------|-------------|-----------------------------------------|
| `notifications` table + polling bell | **Web Push (service worker + VAPID, e.g. `web-push`)** | Only if alerts must reach staff when the browser/tab is closed AND product decides floor staff live in the web app (they don't — floor staff are on the Expo mobile app, which is out of scope this milestone). Net-new service-worker + subscription-storage surface; rejected. |
| Polling bell (Header refetch) | **Realtime toast-on-arrival (4th subscription)** | Only if a HIGH-risk alert is time-critical to the second for a *web* user. It isn't — supervisors/GMs act on these within a shift, not seconds. Would violate the A2 3-surface Realtime cap; rejected unless the roadmap explicitly re-opens that decision. |
| In-app notification only | **Twilio SMS to floor staff** | Genuinely the highest-value channel for "save a housekeeper time on the floor," but requires production-only Twilio creds and targets mobile users. Defer as a differentiator; do not block this milestone on it. |
| Extend nightly cron insert | **New dedicated alerting microservice / queue** | Volume is trivial (per-hotel, once nightly for failures, every 30 min for readiness). A queue/worker is over-engineering for this scale. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| A web-push library (`web-push`, `firebase-messaging`) | Net-new service worker + subscription storage + VAPID key management for an audience (web-based supervisors/GMs) that is already served by the polling bell. Contradicts zero-dependency bias. | Existing `notifications` table + `Header.tsx` bell. |
| A new Supabase Realtime subscription for notifications | Violates architecture decision A2 (Realtime scoped to exactly 3 surfaces to protect connection budget and AI context window). | Existing 120s/refetch polling already used by `AIRiskAlertsPanel` and `Header`. |
| A new `predictions_actions` or bespoke table for the one-click actions | Duplicates the generic `ai_recommendations` lifecycle that already has transition validation, an event audit trail, and metrics endpoints. | Reuse `ai_recommendations` (create/authorize/mark-executed/outcome). |
| A separate toast library (`sonner`, `react-hot-toast`) | `@radix-ui/react-toast` is already installed, themed, globally mounted, and wrapped in a `useToast()` helper. | Existing `components/ui/Toast.tsx`. |
| Wiring Twilio SMS into the local/MVP path | No local Twilio credentials; cannot be tested end-to-end locally, and floor staff are on mobile (out of scope). | In-app `notifications` for this milestone; revisit SMS as a production-gated differentiator. |

## Stack Patterns by Variant

**If the roadmap decides HIGH-risk alerts must be real-time for web users:**
- This is a deliberate re-opening of architecture decision A2, not a stack choice. It would add a
  4th Realtime subscription (a global notification channel) + toast-on-arrival via the existing
  `useToast()`. Flag it as an explicit architecture decision for the roadmap, not a default.

**If the roadmap decides floor staff (not just supervisors/GMs) must be alerted:**
- That crosses into the mobile app (out of active scope) and/or Twilio SMS (production creds only).
  Treat as a separate, credential-gated milestone.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@radix-ui/react-toast@1.2.23` | `react@18.3.1` | Already integrated and working; no change. |
| `@tanstack/react-query@5.101.4` | `next@16.3.0-preview.10` | Existing polling/mutation patterns proven in `Header`, `AIRiskAlertsPanel`. |
| `supabase(py)@2.31.0` | `fastapi@0.141.1` | Existing `ai_recommendations` lifecycle runs on this pairing. |
| `twilio@9.10.9` | `fastapi@0.141.1` | Installed but unused locally (no creds). Compatible; production-only path. |

## Sources

- `apps/web/package.json` / `apps/api/requirements.txt` — authoritative installed versions (HIGH confidence, read directly).
- `apps/api/routers/ai_copilot.py` (lines ~827–940) — existing `ai_recommendations` create/authorize/mark-executed/outcome lifecycle + transition validation (HIGH, read directly).
- `apps/api/services/ai/predictions.py` (lines ~204–441) — existing HIGH-risk → `notifications` escalation pattern to replicate for failure predictions (HIGH, read directly).
- `apps/web/components/shared/Header.tsx` — polling bell that already delivers `notifications` rows (HIGH, read directly).
- `apps/web/components/ui/Toast.tsx` + `DashboardShell.tsx` — globally mounted toast infra (HIGH, read directly).
- `CLAUDE.md` architecture decisions A2 (Realtime scoped to 3 surfaces), A1 (services-layer depth), Current Scope (web-only, no local Twilio/AI creds) — constraints driving the "add nothing" recommendation (HIGH).

---
*Stack research for: AI Copilot Proactive Intelligence (v1.6)*
*Researched: 2026-08-12*
