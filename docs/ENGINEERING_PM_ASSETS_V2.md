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

## Phase 4: guided PM inspections, field evidence, readings, findings and safe completion

No migration. API: evidence integrity on completion and a permanent-evidence guard. Mobile: the inspection screen,
photo/finding/reading components and the local draft store. The existing inspection architecture is reused (one
`usePmInspection` hook, one local draft, one idempotent completion); nothing competes with it.

### Evidence integrity (API)
Completion used to check only that an evidence id belonged to the property. It now refuses (422, nothing written) evidence that:
is not in this property, has no uploaded file yet, was captured by someone else, was captured for other equipment or other work
(`related_entity_type` must be empty or this asset), or is already part of a recorded inspection (recording re-links evidence to
the new completion, so without this a photo could be pulled off a finished inspection and reused as proof for the next one).
The same id may appear only once per completion (an item, another item and the general photos are different places), so one
photo can never satisfy two steps. A replay of an already accepted `submission_id` skips these ownership checks (its evidence is
already linked to its own completion) and the database function answers replay/conflict as before.

The procedure, not the app, decides what needs a photo: `requires_evidence` is taken from the resolved checklist template
(matched by item key, else label) and stored as true even if the request said false; a controlled step without its own evidence
is refused unless it is N/A. The template lookups now select `items` (`checklist_binding.py`).

`DELETE /evidence/records/{id}` and `POST /evidence/records/{id}/file` return 409 for evidence linked to a `pm_completion`:
recorded proof can neither be deleted nor have its file replaced. A draft's photo or a failed upload stays removable, which is
what makes "Discard draft" safe even when an earlier submit's outcome was unknown.

The completion response now carries `next_due_at` (read back from the schedule, never computed by the app) and the corrective
work orders' `status` / `work_order_number` as the database holds them.

Residual risk, accepted and recorded: two simultaneous first submissions that both reference the same photo could pass the
ownership check before either links it (the check is before the transaction; closing it needs a SQL change in a new migration).
The duplicate-id rule and the per-user rule make this a deliberate-misuse case, not an app flow.

### Guided inspection (mobile)
- Header: `Equipment - Inspection name`, `TAG - location`, `Checklist name - vX`, and the local save status; one button opens the
  exact equipment record. Back steps through the sections, then leaves.
- Four sections in a tab row (`PmStepper`): **Checklist, Readings, Findings, Review**. Moving between them never touches the draft.
  Status icons (complete / needs attention / not started) come from `sectionStatuses` and are spoken, never colour-only.
- Checklist card: Pass / Fail / N/A as radio buttons with icons, nothing pre-answered, no "pass all". The answer stays visible when
  the card is collapsed. N/A is allowed as the checklist allows it (the checklist model has no configurable "reason required" flag,
  so none is invented).
- **Report failed check** (`PmFailureSheet`, shared `BottomSheet`): equipment, the failed step, escalation guidance ("if this is an
  immediate danger ... tell the Chief Engineer; saving a finding does not alert anyone"), the finding text, a photo, Save. The text is
  written into the draft as it is typed, so dismissing the sheet loses nothing and the step stays Failed. A failed step now needs a
  written finding before the inspection can be completed (client rule; it travels as the step's note and becomes the corrective work
  order's description). Per-step severity is not offered: the API has no per-step severity (priority comes from asset criticality),
  and the existing "other defects" list keeps its optional severity.
- Photos (`PmPhotoField`): camera / library with permission states, preview, remove, per-thumbnail "Uploaded" mark (every thumbnail
  is an upload the server confirmed), upload failure keeps the prepared photo so **Retry upload** needs no re-pick, status announced
  to screen readers. Offline is stated; there is no offline photo queue (Phase 7).
- Readings: only the equipment's own meters, unit beside the field, configured band ("Normal: up to / at least / x to y"), last
  value, and a warning that states the entered value and which limit it is beyond. A plus/minus button is there because the iPhone
  decimal pad has no minus key. A reading never changes an answer. No meters gives an honest empty state.
- Labor / parts / defects / notes: unchanged semantics (actual labor only as typed, parts are a usage record with no stock
  deduction, defects are not work orders); inline errors per row.
- Review: blockers first, each with **Fix this** that switches section and scrolls to the exact field (a failed step's finding or
  photo opens the sheet); then inspection / equipment / checklist version / technician / due date, result counts, readings with
  out-of-range marks, photo count and required-photo status, findings, labor/parts, notes.
- Submission: one stable `submission_id` per logical attempt (existing). A retry after an unknown outcome is labelled "Retry safely",
  sends the same id and payload, and keeps the draft until the server confirms. Outcomes are titled (not confirmed yet / not
  recorded / not ready) and announced to screen readers.
- Completed: shows what the server confirmed (time, technician, results, readings and photos sent, work orders with their numbers,
  next due date when returned). A failed step is never summarised as a pass. Actions: View Inspection Record, View Equipment.

### Local draft
Saves are serialised per draft (an older write can never land after a newer one or resurrect a cleared draft), `savePmDraft` reports
whether the phone really stored it, and the header says Saving / Saved on this phone / Couldn't save. A draft is never written
under a different signed-in person: the hook resets and reloads when the user changes, and the unmount flush checks the owner.
Draft recovery for a changed checklist is the Phase 1 behaviour (blocked with "Use updated checklist"; answers follow only
items with the same key/label). The draft is local work in progress; nothing calls it recorded.

### Assets: Record Reading
The sheet moved onto the shared `BottomSheet` (its retry protections are unchanged: one request in flight, and an unconfirmed
attempt is re-read before it can be sent again). It now shows the meter's fixed unit, configured range and last reading. Observed-time
entry is deliberately not offered: the API would accept `recorded_at`, but back-dating readings would corrupt trends and the
unconfirmed-attempt re-read.

### Not done / dependencies
- A "reason required for N/A" setting, per-step severity and per-step instructions/safety text: the template model has none; this
  needs a template schema change (Phase 5/6) rather than invented client text.
- Offline photo queue and durable offline completion: Phase 7.
- Closing the simultaneous-first-submission window on shared evidence needs a SQL change (new migration).
- No device or emulator run (no safe backend: the local .env is production and shared staging is wiped by the candidate workflow).
  The screens were exercised in a desktop browser through Expo web with a stubbed API (390x844), which does not cover native
  camera, keyboard, safe-area or VoiceOver/TalkBack behaviour.

## Phase 5: Chief Engineer PM management, assignments, deferrals, performance and asset criticality

**Migration 234** (additive; apply BEFORE deploying the API):
- `pm_schedules.row_version` (optimistic concurrency) and `assigned_to / assigned_for_due_at / assigned_at / assigned_by`.
  A schedule is ONE recurring row whose `next_due_at` advances on completion; there is no occurrence table. An assignment is
  therefore stored with the due date it was made for and **lapses** when the schedule advances: it never carries into the next
  cycle and never grants completion rights. Reads expose `effective_assigned_to` / `assignment_lapsed`.
- `pm_schedule_assignment_events`: append-only history of assigned / reassigned / unassigned.
- `assign_pm_schedule()`: one transaction - row lock, version check, assignee must be an active engineer/chief engineer **of
  this property**, write + event + audit row. Statuses: ok, no_change, not_found, conflict, schedule_inactive, assignee_ineligible.
- `pm_completion_records.due_at`, captured by a BEFORE INSERT trigger from the (locked) schedule, so it is the EFFECTIVE deadline
  (an approved deferral has already moved it). Rows before this migration keep `NULL` = "no recorded deadline". Phase 1's
  `record_pm_completion()` is untouched.

**API** (`routers/pm_management.py`, prefix `/v1/pm-management`, managers = chief engineer + GM unless noted):
`GET /summary`, `/programs` (server filters + paging), `/technicians` (any PM executor), `/workload`, `/deferrals`,
`/performance`, `/technicians/{id}/assignments`, `PUT /schedules/{id}/assignment`, `GET /schedules/{id}/assignment-history`.
Also `PUT /assets/{id}/criticality` (chief engineer/GM, versioned, audited) and `PATCH /assets/pm-schedules/{id}` now honours
`expected_version` and bumps `row_version`. Deferral request/decision endpoints are Phase 1's, unchanged.

**Definitions.** overdue = active schedule on active equipment whose `next_due_at` has passed. unassigned = overdue or due this
hotel-local Monday-Sunday week with no current assignee. due_this_week = not yet overdue and inside that week. Performance:
on time = `completed_at <= due_at`; late = after; `no_recorded_deadline` is reported, never guessed; rate = on_time /
(on_time + late), `null` when there is nothing to rate. "Still overdue" and "Due in 7 days" describe schedules now, not the period.

**Mobile.** PM -> Management (chief engineer/GM): coverage cards, requires-attention, team workload (Today/This week),
Programs (search + filters + paging + assign), Pending Approvals (+ Decided), PM Performance. Schedule detail: assignee +
Assign/Reassign + Request deferral. Asset detail -> More -> Set criticality. Technician cards show "Assigned to you".

**Completed in the second Phase 5 pass:**
- *Schedule form* (`pm-schedules/management/schedule-form`): create (real equipment search, real procedure, recurrence, hotel-local first due date, review) and edit (only changed fields + `expected_version`; procedure bound through its own write, with a "details saved, procedure not" message if the second write fails) and deactivate (confirmation; nothing deleted). **Editing has no due-date field by design**: postponing is a deferral request another manager approves. The API still lets a chief engineer/GM PATCH `next_due_at` directly; that is a Phase 1 control left unchanged.
- *Asset Management* (`assets/management`, `GET /v1/pm-management/asset-overview`): critical equipment (life safety/high), down now, open repairs, warranty ending (<= 90 days) and ended, with retired/unknown counts. Recorded facts only.
- *Warranty state* (active / ends soon / expired / unknown) from the recorded date in the hotel calendar, same rule on server and app.
- *Downtime sheet* (More -> Record / End downtime): server stamps time and person; a repeat start returns the open period; start/end are now audited (`asset.downtime_started/ended`, once). It does not change room availability, close work orders or mark repairs.

**Still not done:** asset reinstatement (backend does not support it, so no action), a per-technician performance filter UI, create-schedule retry-dedupe (POST has no client id: a lost response is reported as unconfirmed and the manager is told to check Programs), and any device run.

## Phase 6: connected PM, Assets, Work Orders and room impact

**No migration.** Every relationship this phase needs already exists as a real column or foreign key, so nothing was added and
nothing was backfilled:

| Relationship | Stored as |
|---|---|
| PM schedule -> asset | `pm_schedules.asset_id` |
| PM completion -> schedule / asset | `pm_completion_records.pm_schedule_id`, `asset_id` (append-only) |
| Corrective work order -> originating inspection | `work_orders.pm_completion_id` (FK, `ON DELETE SET NULL`) + `is_pm_generated` |
| Work order -> asset / room | `work_orders.asset_id`, `room_id` |
| Asset -> room / shared area | `assets.room_id` or `assets.location_text` |
| Downtime -> asset / work order | `asset_downtime_periods.asset_id`, `work_order_id` (server checks same property and same asset) |

Older PM work orders without `pm_completion_id` stay unlinked. Nothing is inferred from a title, date or equipment name.

**What changed**
- `GET /v1/work-orders/{id}` now returns `pm_source` (or `null`): schedule name, completion date, asset, the inspection's *failed items*
  with their notes, and an evidence count. It is read through the order's `pm_completion_id` inside the caller's property, so a link
  into another property reads as no source. A lookup failure returns only the id with `details_unavailable: true`; it never fails the
  repair screen. Existing work-order permissions are unchanged (it rides the same read).
- Work order detail (Overview) shows a **Preventive Maintenance Source** card with **View original inspection**, which opens the exact
  historical completion. No PM origin => no card. The failed items are facts about the inspection; an inspection can open several
  orders and no single item is claimed as the cause of this one (the order's own description is the recorded defect).
- Asset -> Maintenance repair rows carry a **From PM inspection** marker when the server says the order is PM-generated.
- Asset -> More -> **Review room impact**: read-only sheet with the equipment's recorded service status and open downtime, the room (or
  the shared area, never a guessed room), the room's own occupancy/availability from the existing room-board read (a role that cannot
  read it sees a note, not a guess), active repairs linked to this asset, **Open room** and **Open work order**. It has no mutating
  action: availability is set only in the existing authorised room workflow, and the sheet says so.
- Downtime start can optionally link one of the asset's active repairs (`work_order_id`). Linking records the relationship only.

**Verified as already correct (no change):** completion idempotency and one corrective order per failed item (Phase 1, migration 232);
PM record -> equipment and corrective work order links (Phase 3); asset Maintenance already loads active repairs, completed repairs,
scheduled PM and PM history as separate, paged reads, and reloads on focus after returning from a work order or PM record; Engineering
Home already opens Engineering Work, PM Today, the exact attention PM schedule or work order; the original failed PM result is never
rewritten when a repair completes; completing a repair does not end downtime or touch a room; failing a PM does not create downtime.

**Completed after Phase 7 (2026-11-02): migration 235 and the remaining Phase 6 items**
- **Notifications.** When a PM inspection is recorded and opens corrective work, every chief engineer of that property gets one inbox row per
  work order (`pm_corrective_work_order`, `data.url = /(app)/work-orders/{id}`), through the existing `services/engineering_notify.notify_managers`.
  Inbox only (listed in `INBOX_ONLY_EVENTS`, never pushed), one unread row per person and order, never to the person who recorded the
  inspection, and **not sent again on a replay** of an accepted submission. Best effort: a notification failure cannot fail or retry a completion
  that is already committed. The mobile inbox files the type under Maintenance.
- **Item-level link.** Migration `235_pm_corrective_item_link.sql` adds nullable `work_orders.pm_completion_item_key` and replaces
  `record_pm_completion()` with a copy that differs only in storing that key on each corrective order, inside the same transaction.
  Signature, locking, idempotency, the `(tenant, completion, title)` uniqueness and privileges are unchanged (SQL tests check each). It is not a
  foreign key: `pm_completion_items` is append-only and the order must never be blocked or cascaded by it. Nothing is backfilled: orders created
  before this migration keep a NULL key and show no "this step", exactly as before. `GET /v1/work-orders/{id}` now returns `pm_source.this_item`
  only when the stored key matches a **failed** item of that completion; a key that matches a passed or missing item claims nothing. The Work Order
  card leads with "Opened for this step" and lists only the other failures under "Also failed in this inspection".
- **History filter chips.** Asset -> History -> Timeline has chips (All / PM / Repairs / Downtime / Readings) with counts. Each event type belongs to
  exactly one group, so the counts add up; a group with no events has no chip, and nothing is shown when only one group exists. Pure functions
  over the events already loaded: no new request. A selected group that empties after a reload falls back to All.
- **Asset quick actions.** Every directory card has an ellipsis button (also long press, and a screen-reader "actions" action) opening a sheet:
  Open equipment, Report an issue (pre-filled exactly like the equipment screen; disabled offline), Record a reading (only for roles that may),
  View maintenance, QR label. Nothing in the sheet changes data; each item opens the existing screen where the action, its permission check and its
  result happen. The equipment screen now accepts `?section=readings|maintenance|history`; any other value opens Overview.

**Deliberately not built (and why)**
- **`Request Room Status Review`:** PatelRep has no request/escalation mechanism for it, and none was invented. Room availability is still set only in
  the existing authorised room workflow.
- **A single server "maintenance timeline" endpoint:** the History chips filter the four paged reads the screen already makes, which keeps each read
  independently paged and failure-isolated. A combined endpoint would need its own paging contract and a migration/index review; it is a possible
  later optimisation, not a missing feature.
- No multi-hotel scale fixtures, no device/emulator run, no two-hotel run. The shared read cache is keyed by `tenant:user`, which is what isolates a
  hotel switch; it is covered by existing unit tests, not re-proved here.

## Phase 7: offline reliability, durable evidence, safe sync, conflicts and performance

**No migration. No new queue.** Everything rides the existing owner-scoped SQLite `sync_queue` (`lib/offline/db.ts`), the
`tenant:user` queue owner and `offlineStore`. The one generic-queue hazard found: `flushSyncQueue` **deletes any row it has no branch
for**, so PM rows (`entity_type = pm_schedule`) are skipped there and replayed only by `pmSyncRunner`.

### State model (`lib/engineering/pmSyncState.ts`)
`current` / `cached` / `local_draft` / `queued` / `syncing` / `synced` / `needs_review` / `rejected` / `unknown_outcome`, each with a
written label (`engSync.state.*`, en + es). Only `current` and `synced` are statements about the server. A queued completion is never
shown as recorded; an unknown verification time is `null`, never zero.

### Local draft (unchanged storage, extended)
`pmDraftStore` keeps its serialised per-key writes, owner scoping and "saved only after the write succeeded" indicator. Added: a `label`
for lists, `listPmDraftLocalUris()` (null = unreadable = keep every file). Checklist change still blocks the draft with the old content
preserved (`draftCompatibility`); nothing is auto-mapped.

### Durable photos (`pmLocalEvidence.ts`)
Offline (or server unreachable) a photo is copied into `documents/pm-evidence/<tenant_user>/<token>.jpg`, read back, size-checked
(10 MB = the server limit), and quota-checked (150 MB per person). It is a `local:<token>` id that **cannot pass the completion
validator**, so it can never be sent as evidence. Deletion is allowed only inside the caller's own folder; storage-full is told apart
from other failures; a failed save attaches nothing. Orphans (no draft, no queued row, older than 24 h) are swept only when every draft
and queued row was read successfully. **Not claimed:** encryption at rest (app sandbox only).

### Save for sync (`pmCompletionQueue.ts`)
Offline, or holding a phone-only photo, the review button becomes **Save for sync**: the validated body, submission id and photo list
are frozen (fingerprinted) into one queue row, **then** the draft is cleared (a crash between leaves both; the queue wins on reopen).
One outstanding row per schedule: reopening shows "Saved - waiting to sync" instead of the form, so one inspection cannot become two.
Editing after saving is not possible without discarding (explicit, confirmed) - there is no silent revision of a queued payload.

### Replay order (`pmSyncWorker.ts`, driven by `pmSyncRunner.ts`)
1. same `tenant:user` as the row, else pause (nothing touched, no attempt counted); 2. fingerprint intact, else stop `invalid`;
3. **conflict check before any upload**: another technician's completion for the schedule since the draft started => stop
`conflict_completed`; 4. per photo: create record -> **persist its id** -> upload file (a lost reply is reconciled by reading the record
back: `storage_path` set = landed; a record on a different asset is never reused; 2 server errors => start that photo on a fresh record;
413/400 => `evidence_rejected`); 5. swap `local:` ids for record ids and POST once under the **frozen `submission_id`** (the server
records once per id, so a re-POST is the safe reconciliation of every unknown outcome); 6. only on `recorded`: delete the row, clear
any leftover draft, invalidate PM/asset caches, **then** delete the photo files.
Outcomes: `retry` (network/5xx: attempt counted, exponential backoff 30 s -> 30 min, +/-20 % jitter, in-memory), `stopped` (marked
refused with a code; never replayed on its own), `paused`. One run at a time app-wide; offline runs are skipped so they cannot burn the
5-attempt budget. Manual **Sync now** clears the backoff.

**Conflict policy (what the server does and does not do).** `record_pm_completion` is idempotent per `submission_id` and refuses
`schedule_inactive`, `asset_inactive`, `checklist_unavailable`, `submission_conflict`. It does **not** detect "another technician
already did this round", so the client check in step 3 is the only guard; it compares `technician_id`/`completed_at` from
`GET .../completions`. It is a best-effort guard (a completion that lands between the check and the POST is not caught) and the server
has no occurrence-level version check - recorded as a limitation, not hidden. Recovery for a conflict: **Submit anyway** (explicit; keeps
the frozen content and submission id) or **Discard**. The other person's record is never edited or overwritten.

### Sync Status (extends the existing `engineering-sync` screen)
Real counts from the real rows: waiting, syncing, needs review, could not sync, unfinished drafts, photos still on the phone. Per item:
state in words, reason code text, Open / Retry now / Submit anyway (conflicts only) / Discard (two taps, warns it only removes unsent
work). The shared Sync overview and the sign-out warning now count PM inspections (`pm_completion` kind / `pmInspections` category).
Unfinished **drafts are not** in the sign-out warning (they are private to their owner and return when that person signs in again).

### Offline action policy (enforced by what is queueable)
| Offline | Online only |
|---|---|
| PM checklist answers, notes, readings (in the draft), defects, labor, parts, photos | PM schedule create/edit, reassignment |
| Save for sync (PM completion, idempotent) | Deferral approve/reject, asset retire, criticality |
| Cached asset lookup by exact id/tag | Downtime start/end, room status, permissions |
| Existing Work Order offline queue (unchanged) | Anything needing fresh authoritative state |
No standalone meter-reading or equipment-issue queue was added: the existing endpoints lack the idempotency contract this phase requires.

### Offline asset lookup (`assetCacheStore.ts`)
Owner-scoped lookup index (id, name, tag, short location, `verifiedAt`; nothing else), 300 entries, 30-day age limit, serialised
writes, corrupt records dropped. Filled from browse pages and successful lookups; an offline scan shows a **Saved copy - last
confirmed HH:MM** card (never auto-opens as live), an unknown code stays "offline/not on this phone", a retired copy stays retired, a
server 404 forgets the entry, a changed tag stops matching the old one.

### Browse performance (`GET /assets/browse`)
Previously every page request read the whole property's assets **and a year of every work order, all PM schedules, downtime and
predictions** in Python. Now a request with no maintenance-derived filter and a non-derived sort (`name`, `location`, `risk`,
`updated`) sorts the (still fully read) assets, slices the page, and reads the derived facts **for those assets only** (`IN` on the page
ids; equipment-less work orders are no longer fetched). Filters/sorts that read the facts (`status`, `attention`, `maintenance`,
`reliability`, `last_serviced`, `next_pm`) behave exactly as before. A test proves page-only results equal the full path for 4 sorts x
4 searches x 3 pages.
Measured (in-memory fake DB, 2,000 assets / 20,000 work orders / 2,000 PM schedules; handler time is Python-side only, no SQL/network):
| Request | Work orders read | PM read | Median | p90 |
|---|---|---|---|---|
| Browse page 1, before | 20,000 | 2,000 | 349 ms | 390 ms |
| Browse page 1, after | 250 | 25 | 29 ms | 31 ms |
| Search "asset 001", after | 20 | 2 | 25 ms | 26 ms |
| `maintenance=pm_overdue` (needs all, unchanged) | 20,000 | 2,000 | 372 ms | 419 ms |
**Residual:** the `assets` table is still read in full per request (search/sort run in Python). The real fix is an indexed SQL query /
RPC with keyset paging; it needs a migration and validation on a disposable Postgres, so it was deliberately not done here.

### Logout / account / hotel switch
Rows, drafts, caches and photo folders are keyed by `tenant:user`. Nothing is deleted at sign-out (unsent work stays under its owner;
the sign-out sheet warns about queued PM inspections). A different account never lists, counts, replays or deletes them; a replay stops
the moment the owner changes; hotel switch changes the owner so nothing replays into the new hotel.

### Observability
`[pm-sync]` events (`evidence_upload_started/confirmed`, `completion_submitted`, `completion_outcome_unknown`,
`completion_reconciled`, `conflict_detected`, `permanent_rejection`, `queue_item_resolved`) with an 8-character operation id and a
short code only - no tokens, notes, file paths or signed URLs. Dev builds only.

### Not done / not verified (honest list)
- **No device or emulator run** (no safe backend: local `.env` is production, shared staging is destructive). Offline airplane-mode
  scenarios A-F are covered by unit tests with fakes only. The real `expo-file-system` copy, camera and NetInfo paths are untested.
- **No background sync**: replay runs while the app is open (network reconnect via the shared sync, app-foreground via `usePmForegroundSync` in
  the authenticated layout, Sync now, opening Sync Status). Nothing is claimed about uploads continuing after the app is force-closed.
- No encryption of local photos/drafts is claimed. Draft **schema migration**: an unknown `v` is ignored, not converted (v1 only).
- Drafts are not listed in the sign-out warning. An unreadable queue row is shown as needing review but has no "repair" action (discard only).
- Cache invalidation after a recorded completion resets the PM schedule cache and marks the asset list stale; mounted screens refresh on
  their next focus, not live. Work-order-completion and asset-edit invalidation paths were reviewed, not changed.
- Phase 6 leftovers (notifications, item-level link, history chips, quick actions) were completed afterwards on 2026-11-02; see Phase 6.
- PM Today/Plan/Calendar/History large-list performance (500 schedules, virtualization audit) was **not** done in this phase.
- Realtime duplicate-subscription audit not done.

## Phase 8: final QA, release readiness and rollout (2026-11-02)

Release decision: **NOT READY - blockers remain** (see "Blockers"). Nothing here was merged, released or applied to any shared database.

### Blockers
1. **Shared staging is destructive on `main`.** `.github/workflows/staging-candidate.yml` runs `scripts/remote-migration-apply.mjs`, which executes
   `supabase db reset --db-url <staging>` and then re-seeds the fixture, for any same-repo PR to `main` once CI completes. The hostname guard
   (`staging-target-guard.mjs`) only stops a wrong target; it does not stop the wipe of the right one. Re-verified on 2026-11-02: no merged or open
   fix exists. Until the staging workflow replays migrations only into an independently provisioned disposable database (or applies them
   non-destructively), **do not open the PR**. The branch is pushed as a branch only; CI triggers on PRs and `main`, so the push runs nothing.
2. **No device or emulator verification** of any phase (camera, QR scan, photo picker, file copy, share sheet, keyboard, safe areas, VoiceOver/TalkBack).
   There is no safe backend: local `apps/api/.env` points at production, and staging is item 1.

### Found and fixed in Phase 8
- Migration `234_pm_management_assignments.sql` failed `node scripts/check-migrations.mjs` ("Destructive migration requires -- migration-safety:
  destructive-reviewed and -- rollback-plan"). Both `DROP`s only re-create objects migration 234 itself creates. The two header lines were added
  (no SQL changed). CI never ran on this branch, so this would have failed the first CI run.

### Verification evidence (commit `c356c9ea` + the migration header edit)
| Check | Command | Environment | Result |
|---|---|---|---|
| TypeScript | `npm run type-check` (apps/mobile) | local, Windows | pass |
| ESLint | `npm run lint` (apps/mobile) | local | pass |
| Jest | `npx jest --ci` (apps/mobile) | local, all suites | 445 suites / 10,141 tests pass (after the Phase 6 completion) |
| Python lint | `ruff check .` (apps/api) | local | pass |
| Migration integrity | `node scripts/check-migrations.mjs` | local | pass after the header fix (failed before) |
| Migration script tests | `node --test scripts/check-migrations.test.mjs scripts/remote-migration-apply.test.mjs scripts/staging-target-guard.test.mjs` | local | 12/12 pass |
| SQL behaviour | `pytest tests/sql` | disposable `postgres:16-alpine` container | 40 pass (34 + 6 for migration 235) |
| API unit/route suite | `pytest tests --ignore=tests/sql --ignore=tests/integration` (apps/api, dummy env, never the production `.env`) | local venv | all pass except 6 known environment failures (old stripe/dateutil/httpx in the shared venv; `test_snooze_sets_snoozed_until_one_hour_out` flakes in the full run, passes alone) |
| RBAC matrix drift | `pytest tests/smoke/test_rbac_matrix_contract.py` | local | failed (stale line refs after Phase 7); regenerated with `generate_rbac_matrix.py` (line numbers only), now 3/3 pass |
| EN/ES | key-set comparison of `i18n/locales/{en,es}.json` | local script | 9,717 / 9,717 keys, none missing either way |
**Incomplete:** after the Phase 6 completion the full API suite was started but stopped at about 18% when the machine ran out of memory, so it has NOT been re-run in full since; the affected suites (PM connected/foundation, engineering notifications, notification policy, RBAC matrix contract: 111 tests) pass and ruff is clean. The full-suite result above predates the Phase 6 completion.
Not run: `tests/integration` (needs a migrated database; collection fails without one), real device/emulator, Mobile CI and CI Gate on GitHub (no PR), Staging Gate, clean-room replay of all migrations through the Supabase CLI,
large-hotel load test, accessibility tooling, live cross-tenant negative tests against a real database.

### Static security review (read of the diff; not a penetration test)
- Every `pm_management` route is behind `require_role(PM_SCHEDULE_MANAGER_ROLES | PM_EXECUTION_ROLES)`; new asset routes use `ASSET_MANAGER_ROLES`,
  `ASSET_RETIRE_ROLES` or `PM_*` role sets. Deferral self-review is refused by the database function (`self_review` -> 403).
- Every new query on `pm_management.py` carries a tenant filter. Two lookups in `assets.py` (the flagged-asset and room maps in the repeat-issues report,
  `.in_("id", ...)` without `tenant_id`) predate this branch and take ids from a tenant-scoped work-order query: no cross-tenant exposure, P3 hardening.
- Offline storage is keyed `${tenant}:${user}` and each record repeats its owner; a mismatched record is rejected on read. Files remain on the
  device after sign-out under that owner (no encryption claimed).
- No token, signed URL or note content is logged by the new code; `[pm-sync]` events carry an 8-character operation id and a short code.

### Role summary (source of truth: `apps/api/core/roles.py`, `apps/api/RBAC-MATRIX.md`)
Engineer: executes PM, scans/searches assets, reports issues, records readings. Chief Engineer and General Manager: PM management, schedule
create/edit, assignment, deferral decisions (never one's own request), performance, asset create/edit, criticality, downtime, retirement.
The UI hides what the API refuses, but the API is the authority.

### Rollout path and recovery
- Forward only: `232 -> 233 -> 234 -> 235`, all additive (new nullable columns, new tables, idempotent functions/triggers). Apply to production only through the
  existing authorized Production Release process after a human merge; apply to staging only once blocker 1 is fixed.
- Recovery: 235 only adds a nullable column and replaces one function with a copy of 232's body (rollback: redeploy 232's body, drop the column). 234's header documents the rollback (drop its trigger, policy, `pm_schedule_assignment_events` and the added columns). 232/233 add columns,
  an active-tag unique index and functions; none rewrites history. Roll back app behaviour by redeploying the previous API; the mobile client treats an
  unknown server response as "needs review", not as success.

### Known limitations and open items
- P2: PM Today/Plan/Calendar load every schedule into a ScrollView (no virtualization); behaviour at ~500 schedules is unmeasured. PM History and the Asset directory are paged/virtualized.
- P2: `assets` table is still read in full per browse request (Phase 7 residual); needs an indexed RPC with keyset paging and a migration.
- P2: the Phase 7 list in "Not done / not verified" above remains open. The Phase 6 leftovers were completed afterwards (see Phase 6).
- P3: the two unscoped `.in_("id", ...)` lookups noted above.
