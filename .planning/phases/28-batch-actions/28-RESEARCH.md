# Phase 28: Batch Actions - Research

**Researched:** 2026-08-13
**Domain:** Batch reassign/acknowledge for room-readiness predictions + batch acknowledge for asset-failure predictions (PatelRep AI Copilot v1.7, AI-09/AI-10/AI-11)
**Confidence:** HIGH — every file/line reference below was re-verified by direct read on 2026-08-13, not carried over from the milestone-level research without checking

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Endpoint naming**
- Use `batch-` prefix, not `bulk-`: `POST /housekeeping/room-readiness/batch-reassign`, `POST /housekeeping/room-readiness/batch-acknowledge`, `POST /assets/failure-predictions/batch-acknowledge` (exact router/path to be confirmed against the real `assets.py` route prefix during planning).

**Batch action semantics**
- Batch endpoints loop the existing single-item coroutines (`reassign_at_risk_room`, `acknowledge_at_risk_room`, and the asset equivalent) per selected ID — do not reimplement guard/validation logic. Each item must re-read live state at write time (no stale-snapshot batch writes).
- Partial-failure contract: best-effort, not all-or-nothing. Each item gets its own try/except and its own result entry (`succeeded` / `escalated_no_capacity` / `already_resolved` / `error`). Do NOT copy `create_assignments`'s all-or-nothing-with-no-per-item-breakdown shape.
- Request contract mirrors `BulkArchiveWorkOrdersRequest` (`apps/api/models/requests.py:786`): a `List[UUID4]`, non-empty, capped (recommend ~50, confirm during planning).

**Selection UI**
- Checkbox multi-select, scoped only to actionable rows (`canAct = canAssignRooms && risk_level === 'HIGH'`, matching `PredictionRow`'s existing gate in `apps/web/components/housekeeping/PredictionPanel.tsx` exactly).
- Select-all scoped to the currently-rendered list only, not hotel-wide.
- Contextual action bar (appears once >=1 row selected, shows count + available batch actions + deselect-all), not a modal — stay consistent with `PredictionPanel.tsx`'s existing inline-confirm-subrow interaction model (mode: idle -> confirm-X -> result).
- Per-item outcome after a batch commits shown as a short results list/panel (e.g. "3 reassigned, 1 escalated: no capacity"), not a single pass/fail toast.

**Scope**
- Room-readiness gets both batch-reassign and batch-acknowledge (AI-09, AI-10). Asset-failure gets batch-acknowledge only (AI-11) — assets have no "reassign" concept.
- Batch create-work-order is explicitly NOT in this phase (deferred, v2).

### Claude's Discretion
- Exact per-item request cap value.
- Exact visual placement/styling of the action bar.
- Whether checkbox selection resets on `onActionComplete` refresh (recommend yes).
- Exact i18n key naming for new batch strings — follow existing `housekeeping.predictionPanel.*` convention.

### Deferred Ideas (OUT OF SCOPE)
- AI-15 (batch create-work-order), AI-16 (select-all-HIGH-on-this-floor quick filter) — v2, out of scope for this phase.
</user_constraints>

## Summary

This phase adds three batch endpoints and two frontend selection surfaces on top of code that already
shipped in Phase 27 (v1.6). Every backend and frontend precedent this phase needs already exists in the
repository and was re-read directly for this research pass — there is nothing new to install or design
from scratch at the library level. The milestone-level research (`.planning/research/*.md`) already
converged on the right shape; this pass exists to pin down exact current file/line references and
verify two things the milestone research flagged as open questions: the real `assets.py` route prefix
(confirmed: `/assets`, so the full path is `/v1/assets/failure-predictions/batch-acknowledge`, not
`/v1/engineering/...`) and endpoint naming (`batch-` confirmed as the locked choice, `bulk-` in
`STACK.md`'s illustrative examples is superseded).

**One new finding not previously flagged**: the phase's stated actor scope for AI-11
("Engineer/chief_engineer/GM can batch-acknowledge") does not match the current single-item
`acknowledge_failure_prediction` endpoint's role gate (`require_role("gm", "engineer")` only — no
`chief_engineer`) or the frontend's `canManage` gate on the same action
(`isGM || role === 'engineer'` in `engineering/predictions/page.tsx:364` — `chief_engineer` there is
only wired to a *different* action, `canAuthorize`). See "Critical Finding" below — this needs an
explicit decision before implementation, not a silent assumption either way.

**Primary recommendation:** implement all three batch endpoints as thin loops over the existing
single-item route coroutines with a per-item try/except and a per-item result list (mirroring the
partial-failure contract already locked in CONTEXT.md), add checkbox selection state directly to
`PredictionRow`'s existing list (housekeeping) and `PredictionCard`'s existing list (engineering) without
introducing a modal, and resolve the chief_engineer role-gate discrepancy explicitly during planning
before writing the batch-acknowledge endpoint for assets.

## Critical Finding: AI-11 actor scope vs. current role gate

**What was verified:** `apps/api/routers/assets.py:111-114`, the existing single-item
`acknowledge_failure_prediction` endpoint:

```python
@router.post("/failure-predictions/{prediction_id}/acknowledge")
async def acknowledge_failure_prediction(
    prediction_id: str,
    current_user: CurrentUser = Depends(require_role("gm", "engineer"))
):
```

No `chief_engineer`. And on the frontend, `apps/web/app/(dashboard)/engineering/predictions/page.tsx:364-365`:

```ts
const canManage = isGM || role === 'engineer'
const canAuthorize = isGM || role === 'chief_engineer'
```

`canManage` gates the Acknowledge and Create Work Order buttons (`PredictionCard` render, lines 293-328
and 384-390). `chief_engineer` only gets `canAuthorize`, a *different* action (authorizing an AI
recommendation) — chief engineers cannot click Acknowledge on a single prediction today.

But Phase 28's own ROADMAP.md success criterion 3 and REQUIREMENTS.md AI-11 both explicitly say:
"Engineer/chief_engineer/GM can select multiple HIGH-risk asset-failure predictions and batch-acknowledge
them." This is inconsistent with the app's current behavior for the *single-item* version of the same
action.

**This needs an explicit decision during planning, one of:**
1. Widen `acknowledge_failure_prediction`'s role gate (and `canManage` on the frontend) to include
   `chief_engineer`, and apply the same widened gate to the new batch endpoint — makes single-item and
   batch behavior consistent, but is a small scope expansion beyond "batch actions only" (touches
   existing single-item RBAC).
2. Keep the batch endpoint's role gate matching the current single-item gate (`gm`, `engineer` only) and
   flag AI-11's "chief_engineer" wording as inaccurate/aspirational — no RBAC change, but the batch
   feature would then not satisfy its own stated requirement text.
3. Give the *batch* endpoint alone a wider gate than its single-item counterpart — not recommended: this
   would be the first case in the codebase of a batch endpoint being less restrictive than the single-item
   action it fans out over, and violates the "reuse guard logic, don't diverge" principle already locked
   in CONTEXT.md.

Option 1 is the only one that keeps single-item and batch behavior consistent and actually satisfies
AI-11 as written. Flag this for the user/planner to confirm before implementation — it is a one-line
`require_role(...)` change in two places (`assets.py:114` and the frontend `canManage`) plus a
same-parameter change on the new batch route, not a redesign, but it is scope beyond what CONTEXT.md's
"no new business logic path" framing implies.

## Verified Current State

### Room-readiness (housekeeping) — backend

| Piece | Confirmed location | Notes |
|---|---|---|
| Router | `apps/api/routers/housekeeping.py`, mounted at `PREFIX = "/v1"` (`apps/api/main.py:284`, `main.py:289`) | Full paths: `/v1/housekeeping/room-readiness/{room_id}/reassign` etc. |
| `reassign_at_risk_room` | `housekeeping.py:1274-1319` | `require_role("gm", "housekeeping_supervisor")`. Re-reads `room_status.status`, 409s unless `{DIRTY, IN_PROGRESS, PICKUP}`. Scores housekeepers via `count_rooms_ahead`, picks least-loaded eligible (`<=4` rooms ahead). If none eligible: calls `notify_supervisors_high_risk` and returns `{"action": "escalated", "reason": "no_eligible_housekeeper"}`. Else calls `create_assignments(...)` directly (not via HTTP) and returns `{"action": "reassigned", "housekeeper_id": ...}`. |
| `escalate_at_risk_room` | `housekeeping.py:1322-1344` | Same role gate. Re-reads `risk_level` via `_fetch_room_prediction_or_404`, 409s if not `HIGH`. Calls `notify_supervisors_high_risk`, returns `{"action": "escalated", "notifications_sent": N}`. |
| `acknowledge_at_risk_room` | `housekeeping.py:1347-1362` | Same role gate. Re-reads `is_acknowledged`; if true, short-circuits to `{"action": "already_acknowledged"}` (no write). Else updates `is_acknowledged`/`acknowledged_at`/`acknowledged_by`, returns `{"action": "acknowledged"}`. |
| Tenant-scope helper | `_ensure_tenant_row(table, row_id, hotel_id, label)` — `housekeeping.py:83-91` | Single-row `.eq("id", ...).eq("tenant_id", ...).maybe_single()`, 404s if missing. Used by all three actions. A batch endpoint doing a bulk `.in_()` fetch must still diff requested-vs-returned ids to preserve this same 404-on-missing/wrong-tenant behavior per-item (Pitfall 6 in prior research, still valid — see below). |
| Prediction fetch helper | `_fetch_room_prediction_or_404(room_id, hotel_id, columns)` — `housekeeping.py:135-146` | Used by escalate/acknowledge for their live-state re-read. |

**Batching precedent already in this exact function:** `reassign_at_risk_room` already calls another
route coroutine directly (`create_assignments`, `housekeeping.py:1318`) — this is the established pattern
for a batch endpoint to call `reassign_at_risk_room`/`acknowledge_at_risk_room` per id in a loop; no new
call convention needed.

### Room-readiness (housekeeping) — frontend

| Piece | Confirmed location | Notes |
|---|---|---|
| Panel component | `apps/web/components/housekeeping/PredictionPanel.tsx` | `PredictionRow` (lines 66-240) renders one room per row with an inline `mode: 'idle' \| 'confirm-reassign' \| 'confirm-escalate' \| 'confirm-acknowledge'` state machine (line 64, 76). `canAct = canAssignRooms && prediction.risk_level === 'HIGH'` (line 89) — this is the exact gate CONTEXT.md says batch checkboxes must match. |
| Panel-level list | `PredictionPanel` (lines 253-336) | `atRiskRooms` = HIGH+MEDIUM filtered/sorted list (lines 257-262), rendered when the panel is expanded (line 305). Selection state and the batch action bar belong here, above the `.map()` at line 323, since that's where "N selected" and "select all" naturally live. |
| API client | `apps/web/lib/api/housekeeping.ts:126-141` | `reassignAtRiskRoom`, `escalateAtRiskRoom`, `acknowledgeAtRiskRoom`, all single `roomId: string` args, each typed with an inline discriminated-union response type (e.g. `{ action: 'reassigned'; housekeeper_id: string } \| { action: 'escalated'; reason: 'no_eligible_housekeeper' }`). New batch client methods should follow this same typed-response-union convention, extended to an array of per-room results. |
| Role gate parity | `apps/web/lib/hooks/useRole.ts:16,34` | `ASSIGN_ROOMS_ROLES = ['gm', 'housekeeping_supervisor']`, exposed as `canAssignRooms` — matches the backend's `require_role("gm", "housekeeping_supervisor")` exactly. No mismatch here (unlike the asset-failure chief_engineer issue above). |
| Panel mount point | `apps/web/app/(dashboard)/housekeeping/page.tsx:719-742` | `canAssignRooms` is already computed once at the page level (line 630, `const { canAssignRooms } = useRole()`) and passed down as a prop — no new prop plumbing needed for batch UI to know if the current user can act. |

### Asset-failure (engineering) — backend

| Piece | Confirmed location | Notes |
|---|---|---|
| Router | `apps/api/routers/assets.py`, `router = APIRouter(prefix="/assets", tags=["assets"])` (`assets.py:12`), mounted at `PREFIX = "/v1"` in `main.py:295` | **Full path confirmed: `/v1/assets/failure-predictions/*`, NOT `/v1/engineering/...`.** This resolves the "to be confirmed" note in CONTEXT.md — the new batch route is `POST /v1/assets/failure-predictions/batch-acknowledge`, added to `assets.py`, not a new `engineering.py` router. |
| `acknowledge_failure_prediction` | `assets.py:111-125` | `require_role("gm", "engineer")` — **see Critical Finding above, no `chief_engineer`.** Simple update, no live-state re-read/409 guard (unlike the room-readiness actions) — it unconditionally sets `is_acknowledged=True` regardless of current value, so there's no "already acknowledged" branch to preserve in a batch loop, just a straight per-id update. Returns `{"data": result.data[0] if result.data else None}` — note this is NOT wrapped in an `{"action": ...}` shape like the room-readiness endpoints; a batch wrapper should not assume a uniform response shape across domains. |
| Other asset routes with `chief_engineer` | `assets.py:214, 231` | PM-schedule-related endpoints already use `require_role("gm", "engineer", "chief_engineer")` — proves the three-role pattern exists elsewhere in this same file, so widening `acknowledge_failure_prediction` (Critical Finding, option 1) would be consistent with at least two sibling endpoints in the same router, not a novel pattern. |

### Asset-failure (engineering) — frontend

| Piece | Confirmed location | Notes |
|---|---|---|
| Page | `apps/web/app/(dashboard)/engineering/predictions/page.tsx` | Card-per-item grid (`PredictionCard`, lines 135-340), NOT a compact row list like `PredictionPanel.tsx` — different visual density. `canManage = isGM \|\| role === 'engineer'` (line 364, **excludes chief_engineer, see Critical Finding**), `canAuthorize = isGM \|\| role === 'chief_engineer'` (line 365, a different action). Acknowledge button gated by `canManage && !prediction.is_acknowledged` (line 293). |
| Acknowledge mutation | `acknowledgeMutation` (lines 384-390) | `useMutation` calling `engineeringApi.acknowledgeFailurePrediction(id)`, invalidates `['failure-predictions-history']` and `['failure-predictions']` query keys on success. Batch mutation should invalidate the same two keys. |
| API client | `apps/web/lib/api/engineering.ts:257-260` | `acknowledgeFailurePrediction(predictionId: string)` → `POST /assets/failure-predictions/${predictionId}/acknowledge`, typed `Promise<{ data: FailurePrediction }>`. |
| List source | `page.tsx:378-382` | Uses `getFailurePredictionHistory()` (all predictions, up to 50, `assets.py:85-104`), filtered client-side by `riskFilter`/`statusFilter` (lines 421-429) — batch selection state should be scoped to the *filtered* list currently rendered, matching CONTEXT.md's "scoped to the currently-rendered list" rule, and matching what `atRiskRooms` already does on the housekeeping side. |

**Key structural difference from room-readiness:** this page has no risk-level gate equivalent to
`canAct` — every unacknowledged prediction (any risk score) shows an Acknowledge button when `canManage`
is true, not just HIGH-risk ones. CONTEXT.md's decision text says batch selection should be "scoped only
to actionable rows... matching `PredictionRow`'s existing gate... exactly" — but that gate is
room-readiness-specific (`risk_level === 'HIGH'`). For asset-failure, the closest existing "actionable"
gate is `canManage && !prediction.is_acknowledged`, with no HIGH-only restriction in the current single-item
UI. Confirm during planning whether batch selection for assets should introduce a new HIGH-only
restriction not present in the single-item UI today, or mirror the current unacknowledged-only gate — the
milestone-level FEATURES.md assumed HIGH-only for both domains, but the actual per-domain UI gates differ.

### Existing multi-item precedents (what to copy, and what NOT to copy)

| Precedent | Location | Copy this | Don't copy this |
|---|---|---|---|
| `BulkArchiveWorkOrdersRequest` | `apps/api/models/requests.py:786-787` — `work_order_ids: List[UUID4] = Field(min_length=1, max_length=200)` on `SanitizedBaseModel` (base defined `requests.py:58-73`) | The `List[UUID4]` + `min_length=1` + capped `max_length` shape, and `SanitizedBaseModel` base | The `max_length=200` value itself — CONTEXT.md recommends ~50 for this feature, since HIGH-risk prediction lists at a 50-150 room property are inherently small; confirm exact number during planning (Claude's discretion). |
| `_bulk_archive` | `apps/api/routers/work_orders.py:550-582` | The bulk tenant-scoped fetch pattern (`.in_("id", ids)` then diff `found_ids` vs `set(ids)` to catch missing/cross-tenant ids, `work_orders.py:566-569`) | The **all-or-nothing shape**: one bulk `.update()` for everything that passed validation (`work_orders.py:579-581`), a single 404 if *any* id is missing (`work_orders.py:568-569`), and no per-item result list at all. This is explicitly the anti-pattern CONTEXT.md's partial-failure contract rejects — confirmed still present in current code, not fixed since the prior pitfalls research. |
| `BulkArchiveModal.tsx` | `apps/web/components/engineering/BulkArchiveModal.tsx` | The `useState<Set<string>>` selection pattern (line 22), `toggleSelected` helper (lines 80-87), and `useMutation` firing on a `[...selected]` array (line 51) | The **modal chrome itself** (lines 91-196, a full `fixed inset-0` overlay dialog) — CONTEXT.md's decision explicitly rules out a modal for this feature in favor of an inline contextual action bar, consistent with `PredictionPanel.tsx`'s existing inline-confirm-subrow pattern. Adapt the *state management*, not the *rendering shape*, from this component. |
| `test_room_readiness_actions.py` | `apps/api/tests/test_room_readiness_actions.py` (384 lines, Phase 27's test suite) | The direct-coroutine-call test pattern (`await housekeeping_router.reassign_at_risk_room(room_id=..., current_user=SUPERVISOR)` against a monkeypatched `FakeDB`, no HTTP client), the `GM`/`SUPERVISOR` `CurrentUser` fixtures, and the RBAC-parametrized-role-rejection test shape (lines 170-179). `FakeDB` (`apps/api/tests/smoke/fake_supabase.py`) supports `.in_()` (line 116), needed for any bulk-fetch test. | N/A — this file is a template to extend, not a pattern to avoid. |

## i18n key structure (confirmed)

`apps/web/i18n/locales/en.ts:431-461` (mirrored in `es.ts`), flat keys under `housekeeping.predictionPanel.*`:

```ts
predictionPanel: {
  predictions: 'Predictions',
  // ...
  reassign: 'Reassign',
  escalate: 'Escalate',
  acknowledge: 'Acknowledge',
  confirmReassign: 'Reassign to least-loaded housekeeper?',
  confirmEscalate: 'Notify supervisors now?',
  confirmAcknowledge: 'Acknowledge and suppress alerts for this room?',
  reassignedTo: 'Reassigned',
  escalatedNoCapacity: 'Escalated to supervisors — no housekeeper had capacity',
  escalated: 'Escalated to supervisors',
  acknowledged: 'Acknowledged',
  alreadyAcknowledged: 'Already acknowledged',
  actionFailed: 'Action failed — please try again',
},
```

New batch keys should follow this same flat, present-tense naming convention, e.g.
`batchReassign`, `batchAcknowledge`, `confirmBatchReassign: 'Reassign {{count}} rooms to least-loaded housekeeper?'`,
`selectedCount: '{{count}} selected'`, `deselectAll: 'Deselect all'`, `selectAll: 'Select all'`,
`batchResultSummary: '{{succeeded}} succeeded, {{failed}} need attention'` (exact strings/keys are
Claude's discretion per CONTEXT.md). The asset-failure side has no existing `predictionPanel`-style i18n
namespace — check `engineering.predictionsPage.*` / `engineering.failurePrediction.*` namespaces (used at
`page.tsx:479-483`, `354` etc.) for the sibling convention to extend there.

## Architecture Recommendation (confirmed against current code)

No new router files, no new `services/` modules — both `housekeeping.py` and `assets.py` already own
their respective single-item actions and are the correct place for the new batch routes, per this
project's flat-architecture convention (`services/` reserved for logic shared across 2+ domains; batch
fan-out over an existing domain's own actions is not cross-domain sharing).

```
POST /v1/housekeeping/room-readiness/batch-reassign     → housekeeping.py, loops reassign_at_risk_room
POST /v1/housekeeping/room-readiness/batch-acknowledge   → housekeeping.py, loops acknowledge_at_risk_room
POST /v1/assets/failure-predictions/batch-acknowledge    → assets.py, loops acknowledge_failure_prediction
```

Each batch handler:
1. Validates the request body (`List[UUID4]`, `min_length=1`, capped `max_length`) via a new
   `SanitizedBaseModel` subclass per domain (mirroring `BulkArchiveWorkOrdersRequest`'s shape but with a
   smaller cap).
2. Loops the ids, calling the corresponding single-item coroutine per id inside its own `try/except`,
   so one item's `HTTPException` (404/409) becomes a per-item result entry, not an aborted batch.
3. Returns `{"data": {"results": [...], "succeeded": N, "failed": N}}` with one entry per requested id,
   each entry echoing the id plus either the single-item action's own response shape or an
   `{"error": "..."}` entry, so the frontend can render exactly what CONTEXT.md's "3 reassigned, 1
   escalated: no capacity" example describes.

This satisfies CONTEXT.md's locked partial-failure contract and reuses 100% of existing guard/validation
logic without duplicating it, exactly as instructed.

## Confirmed Pitfalls (carried forward, re-verified against current code)

The prior milestone PITFALLS.md's batch-specific pitfalls (P1, P2, P6, P7) were re-checked against the
current code state on 2026-08-13 and remain accurate and unaddressed as of this phase's start — i.e.
`create_assignments` and `_bulk_archive` still exhibit the exact gaps described (no per-item try/except,
no per-item result list, single 500/404 on any failure). These are not stale findings; they are still the
live shape of the only two multi-item write endpoints in the codebase today, and the strongest argument for
why this phase must build its own partial-failure contract rather than copying either of them wholesale.

- **P1 (stale-snapshot batch writes):** confirmed still applicable — `reassign_at_risk_room` re-reads
  `room_status` and re-scores housekeepers fresh on every call (`housekeeping.py:1281-1297`); a batch
  loop calling this coroutine per id automatically inherits the live re-read, so this pitfall is avoided
  *for free* by the "loop the existing coroutine" approach CONTEXT.md locks in — but only if the batch
  handler does NOT pre-fetch room state itself and pass it in. Verify the implementation does not add a
  bulk pre-read that shortcuts the per-item re-read inside the looped coroutine.
- **P2 (undefined partial-failure contract):** already resolved by CONTEXT.md's locked decision — the
  per-item try/except + result-list contract is specified, not left to implementation-time judgment.
- **P6 (cross-tenant id silently dropped):** applies to any bulk pre-check the batch handler does *before*
  calling the per-item coroutines (e.g. if it does a bulk existence check first for a nicer 404 message) —
  `_ensure_tenant_row` already 404s per-item inside each single-item coroutine, so as long as the batch
  handler doesn't add its own silent bulk filter in front of that, this is also avoided by construction.
- **P7 (no batch UI precedent, risk of losing confirm discipline):** confirmed still true — no multi-select
  pattern exists anywhere in `apps/web` outside `BulkArchiveModal.tsx` (which CONTEXT.md rules out as a
  modal). This is genuinely new frontend surface; the action bar's single-confirm-with-visible-list
  design is the safeguard against silently skipping confirmation, as already locked in CONTEXT.md.

P3/P4/P5 (escalation-cron-specific: GM-notification spam, escalation column preserve/reset, migration
deployment gap) do **not** apply to this phase — they belong to a future escalation-to-GM phase (AI-10 in
the original milestone numbering referred to escalation-to-GM in the prior research pass, but this phase's
actual scope per ROADMAP.md/REQUIREMENTS.md is AI-09/AI-10/AI-11 = batch reassign / batch acknowledge
(room-readiness) / batch acknowledge (asset-failure) only — no schema change, no new cron. Confirm this
requirement-ID mapping matches the current ROADMAP.md before planning, since the prior milestone research
pass used a slightly different AI-09/AI-10 pairing than what ended up in this phase's actual scope.

## Open Questions for Planning

1. **Chief-engineer role gate (Critical Finding, above).** Must be resolved explicitly — either widen
   `acknowledge_failure_prediction` + `canManage` to include `chief_engineer` (recommended, matches
   AI-11's stated scope and two sibling endpoints in the same file), or explicitly scope AI-11 down to
   `gm`/`engineer` only and flag the mismatch with ROADMAP.md/REQUIREMENTS.md wording.
2. **Batch cap value.** Recommend 50 (CONTEXT.md's suggestion), smaller than `BulkArchiveWorkOrdersRequest`'s
   200 since HIGH-risk prediction lists at a 50-150 room property are inherently small and this is a
   synchronous request (no background job), not a bulk-by-age sweep.
3. **Asset-failure selection scope (HIGH-only vs. all-unacknowledged).** The room-readiness `canAct` gate
   is HIGH-only; the asset-failure page's current single-item Acknowledge button has no risk-level
   restriction, only `canManage && !is_acknowledged`. Decide whether batch selection for assets introduces
   a new HIGH-only restriction (matching FEATURES.md's original assumption) or mirrors today's
   unacknowledged-only gate (matching the actual current UI) — recommend the latter, since introducing a
   new restriction not present in the single-item UI would be inconsistent with "no new business logic
   path."
4. **Response shape uniformity.** `acknowledge_at_risk_room`/`reassign_at_risk_room` return
   `{"action": "..."}`-shaped bodies; `acknowledge_failure_prediction` returns the raw updated row
   (`result.data[0]`). The three new batch endpoints will need per-domain result-entry shapes rather than
   one shared shape — do not try to unify room-readiness and asset-failure batch response types into a
   single shared Pydantic model or TS type.

## Sources

All findings verified by direct file read on 2026-08-13 (HIGH confidence, primary source, this session):
- `apps/api/routers/housekeeping.py:83-146, 1274-1362` — tenant/prediction fetch helpers, all three
  single-item room-readiness actions
- `apps/api/routers/assets.py:1-165, 214, 231` — router prefix, `acknowledge_failure_prediction`, sibling
  `chief_engineer`-inclusive endpoints
- `apps/api/main.py:284-315` — `PREFIX = "/v1"`, router mount order/prefixes
- `apps/api/models/requests.py:58-73, 786-796` — `SanitizedBaseModel`, `BulkArchiveWorkOrdersRequest`,
  `BulkArchiveByAgeRequest`, `BulkUnarchiveWorkOrdersRequest`
- `apps/api/routers/work_orders.py:518-582` — `_bulk_archive`, the only existing multi-item write endpoint
- `apps/api/tests/test_room_readiness_actions.py` (full file, 384 lines) — Phase 27's test conventions,
  direct-coroutine-call pattern, RBAC test shape
- `apps/api/tests/smoke/fake_supabase.py:34-169` — `FakeDB`, confirmed `.in_()` support
- `apps/web/components/housekeeping/PredictionPanel.tsx` (full file, 337 lines) — `PredictionRow`
  confirm-mode state machine, `canAct` gate, panel-level `atRiskRooms` list
- `apps/web/components/engineering/BulkArchiveModal.tsx` (full file, 197 lines) — selection-state pattern
  to reuse, modal chrome to discard
- `apps/web/app/(dashboard)/engineering/predictions/page.tsx` (full file, 685 lines) — `PredictionCard`,
  `canManage`/`canAuthorize` role split, acknowledge mutation, list filtering
- `apps/web/lib/api/housekeeping.ts:100-159` — existing single-item API client methods and response types
- `apps/web/lib/api/engineering.ts:240-312` — `acknowledgeFailurePrediction` and sibling asset API methods
- `apps/web/lib/hooks/useRole.ts` (full file) — `canAssignRooms`/`canViewEngineering` role capability gates
- `apps/web/app/(dashboard)/housekeeping/page.tsx:630, 700-742` — `PredictionPanel` mount point, existing
  `canAssignRooms` prop plumbing
- `apps/web/i18n/locales/en.ts:431-461` — `housekeeping.predictionPanel.*` i18n key structure

Prior milestone-level research (MEDIUM-HIGH confidence, read this session, cross-checked against the
above; used as scaffolding, not taken on faith):
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md`
  (2026-08-13) — largely accurate; superseded on two points: (1) `assets.py` route prefix is `/assets`
  not `/engineering` (this document confirms `/assets`), (2) endpoint naming is locked to `batch-` per
  CONTEXT.md, not the `bulk-` used in STACK.md's illustrative examples.

## Metadata

**Confidence breakdown:**
- Backend endpoint signatures/role gates: HIGH — direct code read, line-numbered
- Frontend component structure: HIGH — direct code read, full files read
- i18n conventions: HIGH — direct code read
- Chief-engineer role-gate discrepancy: HIGH confidence that the discrepancy exists (verified both
  backend and frontend); the *resolution* is a product decision, not a research finding — flagged as an
  open question, not resolved here

**Research date:** 2026-08-13
**Valid until:** Should remain valid for the duration of this phase's planning/implementation (days, not
weeks) — re-verify role gates and route prefixes if implementation is delayed past other in-flight PRs
touching `assets.py` or `housekeeping.py`.
