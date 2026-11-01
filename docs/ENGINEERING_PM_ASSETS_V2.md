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
