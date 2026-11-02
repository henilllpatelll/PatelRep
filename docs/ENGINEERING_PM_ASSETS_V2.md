# Engineering PM + Assets V2

One branch (`feat/engineering-pm-assets-v2`), one pull request, eight phases. This file records what each phase changes
underneath the screens. Phase 1 is the foundation; later phases append their own sections.

## Phase 1: foundation, data contracts and correctness

### Migration 232 (`supabase/migrations/232_engineering_pm_assets_foundation.sql`)

Additive only: new nullable columns, new objects, no edits to existing rows, no removals. It can be re-run safely.

| Object | Purpose |
|---|---|
| `pm_schedules.checklist_template_id`, `checklist_template_code` | The procedure a schedule uses. Both NULL = never configured (every existing schedule). The code survives a removed template so "template deleted" differs from "unassigned". |
| `pm_completion_records.submission_id`, `submission_hash` + unique `(tenant_id, submission_id)` | Server-enforced idempotency key for a completion. |
| `work_orders_pm_completion_title_uidx` | One corrective work order per failed item of a completion. Created only if no duplicate already exists. |
| `pm_next_due_at()` | Next-due arithmetic; mirrors `services/pm_schedules.compute_next_due_at` (a test pins them together). |
| `record_pm_completion()` | One transaction: claim the submission, write the completion, items, corrective work orders, evidence links and audit rows, advance the schedule. |
| `pm_deferral_decisions` + `decide_pm_deferral()` | A deferral is a request (`pm_deferrals`, still append-only); a decision is a separate append-only row made by the authenticated reviewer. `UNIQUE (deferral_id)` is the guarantee a request is decided, and applied, at most once. |
| `pm_deferrals_not_self_approved` (NOT VALID) | A requester can never be recorded as their own approver. Not validated against old rows. |
| `assets_tenant_active_tag_uidx` | Active asset tags are unique per property, ignoring case and surrounding spaces. Created only if no duplicate active tag exists; the API enforces the same rule either way. |

**Order.** Apply 232 before deploying the API that calls `record_pm_completion` / `decide_pm_deferral`. The API fails
closed (503, nothing written) if the function is missing; it never falls back to the old non-atomic write.

**Compatibility.**
- Older app builds send no `submission_id`: the completion is still atomic, just not replay-safe.
- Older API builds ignore every new column and never call the new functions.
- A `pm_deferrals` row written before 232 carries `approved_by` and was applied when created; it reads as `approved`.
- `POST /programs/pm-schedules/{id}/deferrals` still accepts `approved_by` and ignores it. Approval is whoever
  authenticates on `POST /programs/pm-deferrals/{id}/approve|reject`.
- Checklist templates are edited in place; a change to the checklist now bumps `version`, so a completion's
  `checklist_version` names the revision it was done against. Completed items are their own immutable rows and are never
  rewritten.

**Recovery.** Nothing to undo: leave the objects in place. To stop using the new behaviour, redeploy the previous API.

**Legacy schedules (no checklist).** They stay `unassigned`; the technician chooses a checklist exactly as before and no
checklist is ever assigned automatically. A chief engineer or GM binds one with `PUT /assets/pm-schedules/{id}/checklist`
(mobile UI in Phase 5; the web console can call the same endpoint).

### Permissions after Phase 1

| Action | engineer | chief_engineer | gm |
|---|---|---|---|
| Complete a PM, record a meter reading, start/restore downtime | yes | yes | yes |
| Create / edit equipment | yes | **yes (new)** | yes |
| Create, edit, reschedule, retire a PM schedule, bind its checklist | **no (was yes)** | **yes (was create only)** | yes |
| Request a deferral | no | yes | yes |
| Approve / reject a deferral (never one's own request) | no | yes | yes |

Why engineers lost schedule editing: `PATCH /assets/pm-schedules/{id}` accepts `next_due_at`, so an engineer could move a
due date and bypass the independent deferral approval. The API is the authority; the mobile helpers in
`lib/engineering/roles.ts` only decide what to offer, and a drift test compares them with `core/roles.py`.

### Staging finding (reported, not triggered)

`.github/workflows/staging-candidate.yml` runs after CI on every open same-repository pull request to `main`, drafts
included (it checks state, base, head SHA and `CI Gate`, not draft status). Its step *Rebuild isolated staging database
from candidate migrations* runs `scripts/remote-migration-apply.mjs`, which executes `supabase db reset --db-url
<staging> --yes` ("Wiping remote database to the blank Supabase baseline") and then reseeds the fixture tenant. The
`staging-target-guard.mjs` step refuses a non-staging host, so production is protected, but every pushed commit of any
PR wipes the shared staging database. This is by design in the workflow, not an accident of this change.

## Phase 2: mobile UI/UX, navigation, cards, search, filters and sheets

Mobile only (`apps/mobile`); no API or migration change. PM and Assets stay two separate tabs sharing primitives
(`EngineeringSegmented`, `BottomSheet`, `EngineeringState`, `assetUi`, `pmUi`).

### PM
- Top level is **Today | Plan | History**; Plan holds **Week | Calendar** (`lib/engineering/pmViews.ts`). Old
  `?view=week|calendar` links land on Plan > Week/Calendar.
- Today (`lib/engineering/pmFilters.ts` `todayPlan`): Continue Inspection (real saved drafts only, with `x of y steps`
  from `listPmDraftSummaries`), Needs Attention (overdue, most overdue first), Due Today, Coming Up (+ link to Plan).
  A schedule is in at most one section; a drafted schedule appears only under Continue.
- Summary cards open the worklist they count: Overdue / Due today filter Today, This week opens Plan > Week.
- History hides the schedule search and filters (they do not apply to server history), flags follow-up defects and
  opens the exact equipment.
- Schedule detail: summary, linked equipment (whole card opens that asset, shows confirmed service condition),
  inspection procedure (bound checklist name/version/steps/photo steps; a broken binding shows the Phase 1 error and
  disables Start), previous maintenance.
- Filter & Sort: All chip, active count in the title, live result count on the apply button, nothing applied until
  Show results.

### Assets
- Detail sections are **Overview | Maintenance | Readings | History**; the old Work Orders tab is now inside
  Maintenance (Active repairs, Scheduled maintenance, Recent records incl. completed repairs).
- Overview: Report Issue primary, Record Reading where permitted, secondary actions in a More sheet; the duplicated
  maintenance summary became Recent activity with a link to History; room impact is shown when status is not operational.
- Asset Filter & Sort now uses the shared `BottomSheet` (backdrop/Android back/safe area/keyboard consistent with PM).

### Not done / dependencies for later phases
- Criticality is not shown: the API has no criticality field. Needs a Phase 3 backend field.
- History does not link to corrective work orders: the completion summary carries no work-order ids. Needs the
  completion list to return them (the record detail screen is unchanged).
- Schedule detail has no technician assignment: the API only has `assigned_to_role`.
- The Record Reading sheet still uses its own Modal (not moved onto the shared BottomSheet, to avoid disturbing its retry protections); checklist selection and inspection confirmations are unchanged. Move them in Phase 4 with the workflow changes.

## Phase 3: equipment identity, asset creation and editing, QR labels, PM-to-asset integration

### Migration 233 (`supabase/migrations/233_asset_identity_photo_and_version.sql`, additive)
- `assets.row_version` (int, default 1): optimistic-concurrency token. Only user edits through the assets API move it
  (there is no `updated_at` trigger, and the risk-score / downtime jobs write the same row).
- `assets.photo_evidence_id` (uuid, FK `evidence_records`, `ON DELETE SET NULL`): the one evidence record that is the
  equipment's identity photograph. Inspection photos stay linked to their PM completions; replacing the identity photo never
  touches them. Apply this migration BEFORE deploying the API (the edit path reads/writes `row_version`).

### One source of truth for identity
`assets.id` (tenant-scoped) is the identity. `asset_tag` is the printed label text (optional, unique among ACTIVE assets per
property, case-insensitive, trimmed; the DB index `assets_tenant_active_tag_uidx` is the backstop). The QR encodes only
`patelrep:asset:v1:<asset-uuid>` (unchanged format, already accepted by the scanner). No credentials, user ids or property
data. A scan is a lookup key resolved inside the signed-in person's property; it authorises nothing.

### API
- `POST /assets` takes an optional client-generated `id`: replaying the same id returns the original (HTTP 200) and never a
  second asset; a racing duplicate reads back the winner; an id that exists only in another property is refused
  (`asset_id_in_use`) without revealing it. `criticality` is accepted.
- `PATCH /assets/{id}`: `expected_row_version` makes a stale edit a 409 `asset_conflict` (the check is part of the UPDATE, so
  two simultaneous editors cannot both win). `clear_fields` explicitly empties optional fields (omitting a field never
  changes it). Older clients (web) keep working: no version sent = checked against what was just read.
- `POST /assets/{id}/retire` (chief engineer / GM): reason required (3+ chars), refused while open work orders or open
  downtime exist (`asset_has_open_work_orders` / `asset_has_open_downtime`), deactivates the asset's PM schedules, keeps every
  completion / work order / downtime row, audited with the reason. PATCH `is_active` still exists for the web app unchanged.
- `PUT|DELETE /assets/{id}/photo`: attaches an already-uploaded evidence photo (must be this property's, an image, captured for
  THIS asset) and removes only the previous identity photo. `GET /assets/{id}` returns `photo_url` = a 1-hour signed URL, never
  a storage path. Files live in the existing private `evidence-files` bucket; no new storage system.
- `GET /assets/lookup`: tag match is now case-insensitive; retired equipment resolves flagged `is_active:false`.
- `GET /assets/pm-schedules/{id}/completions/{cid}` now also returns the exact `asset` and the `corrective_work_orders` that
  completion opened (read only; reading never creates work).

### Mobile
- Assets > Add (+) > **Register Equipment** (full-screen form: identity, location, details, review). Location is a real room
  (searched server-side, carries building/floor) or a free-text area (Roof, Pool plant...). Dates use the native picker.
  Photo: camera or library with permission handling, resized JPEG, uploaded after the record exists.
- Asset > More > **Edit Equipment**, **QR Label**, **Scan equipment**, **Retire equipment** (chief engineer / GM only).
- **QR Label** screen: black-on-white QR (quiet zone, error-correction Q), tag, name, location, property. Share = PDF via the
  system share sheet; Print = the system print dialog. Both only hand off: the app never says "printed" or "sent".
- New dependencies (justified): `qrcode-generator` (MIT, 0 deps, encoder only), `expo-print`, `expo-sharing` (native: a new
  EAS/dev-client build is needed to use them outside Expo Go), `@react-native-community/datetimepicker` (native date picker).
- PM record screen links to its equipment and to the corrective work orders it opened.

### Phase 1 repair found while verifying prerequisites
`apps/api/tests/test_programs_routes.py` still encoded the pre-Phase-1 contract (ids like `sched-1`, a bare fake DB, an approver
named in the deferral body): 10 tests failed on this branch (and CI never ran here - it only runs on PRs). The controls they
guard are intact in the code (`_validate_verifier`, tenant-scoped evidence, `decide_pm_deferral`); the tests were ported to the
new contract keeping every assertion's intent (`tests/smoke/pm_fakes.py` now mirrors the SQL for photos/attachments/reason codes).

### Not done / dependencies for later phases
- Offline registration / photo queueing and a durable offline lookup index: Phase 7.
- A restore-from-retired action on mobile: not built (web `PATCH is_active:true` still exists). Needs the same guarded, audited
  design as retire; Phase 5.
- Asset tags are optional by business rule (no generator). A per-category tag sequence is a Phase 5/6 decision.
- Criticality is now settable and shown; criticality-driven PM/priority rules are Phase 5/6.
