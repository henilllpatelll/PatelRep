# Mobile Supervisor Inspections

How the supervisor's Inspect tab works, which rules the server enforces, where evidence lives, and how to verify and
roll it out. Scope: `apps/mobile/app/(app)/inspect/**`, `apps/mobile/lib/inspections/**`, and the
`/v1/housekeeping/inspections*` routes in `apps/api`. Migrations: `219_inspection_workflow_foundation.sql`,
`220_inspection_evidence_private_storage.sql`.

## 1. Lifecycle

1. A room becomes `CLEAN` (housekeeper finished) and appears under **To inspect** (`GET /housekeeping/ready-for-inspection`).
2. **Start inspection** opens one canonical workspace (`inspect/[roomId]`). Answers are Pass / Issue / N/A per standard.
   A missing answer is never a pass. The draft is saved on the phone as the supervisor goes; **Save & exit** and
   resume restore it, and a changed checklist is detected (template fingerprint) before anything is submitted.
3. **Review** lists what was answered and what is outstanding. The primary action is **Approve room** (all passed) or
   **Submit & request correction** (any issue).
4. Submission is `POST /housekeeping/inspections/complete` (multipart). `client_submission_id` is the inspection's id, so
   a retry returns the stored inspection (`replayed: true`) and a lost response can be read back with
   `GET /housekeeping/inspections/submissions/{id}`. The app shows an uncertain state until it has read the result.
5. **Pass** moves the room to `INSPECTED`. **Fail** keeps the room blocked (`DIRTY`), creates exactly one correction task
   (unique per inspection), and the room appears under **Corrections**.
6. The housekeeper completes the work and the room returns to `CLEAN`. A **reinspection** must re-judge every item that
   failed before (pass or fail; N/A does not count), and a pass completes the earlier correction task. A repeat failure
   retires the earlier unstarted task so the housekeeper sees one current instruction.
7. **Done** shows completed history (paged, filtered), per-inspection records with failed-item evidence, the correction
   timeline and linked reinspections, plus quality insights.

Approval is recorded in PatelRep only. The success screen says it does not change the room's status in the PMS.

## 2. Server rules (single authority: `services/inspection_rules.py`)

Required items answered; no duplicate or foreign items; N/A only where the item allows it; result must equal the
answers; required photos on failed items; checklist applies to the room type and is unchanged; room is still `CLEAN`;
cleaning cycle is current; reinspection lineage matches the open correction. A database trigger re-checks the room under a
row lock so two supervisors cannot both inspect one clean room.

The legacy JSON route `POST /housekeeping/inspections` remains for compatibility, but a `passed` result now gets the same
checklist validation. Failures and historical `conditional` rows only ever block a room, so they stay lenient.

## 3. Evidence

New photos go to the private `inspection-evidence` bucket (no storage policy; service role only) at
`<hotel_id>/inspections/<inspection_id>/<item_id>.<ext>`, recorded in `inspection_results.photo_path`. Clients receive
10-minute signed URLs minted after a hotel and role check; API responses never contain a public URL. Uploads are limited to
5 MB and accepted only if the **bytes** are JPEG, PNG or WebP (the declared content-type is not trusted).

Evidence recorded before migration 220 still lives in the public-readable `work-order-photos` bucket. **Run the backfill
before calling evidence private** (operator-run, dry run by default):

```
python apps/api/scripts/backfill_inspection_evidence.py                                  # dry run
python apps/api/scripts/backfill_inspection_evidence.py --apply --remove-legacy-objects
```

## 4. Roles

Inspect routes: `gm`, `housekeeping_supervisor`. Housekeepers see only their own correction task through the normal task
routes. Other hotels get 404. See `apps/api/RBAC-MATRIX.md`.

## 5. Rollout order and compatibility

There is no feature flag or minimum-app-version gate for this experience. Safe order:

1. Apply migrations 219 and 220 through the normal migration workflow (both additive).
2. Deploy the API (older app builds keep working; their legacy `POST /inspections` pass is now refused with `422` unless
   it answers every required item).
3. Run the evidence backfill (section 3).
4. Ship the mobile build.

Reverting the app does not require rewriting data. Reverting the API before step 4 leaves new rows readable.

## 6. Verification

- API: `cd apps/api && pytest tests/` (uses an in-memory fake; the fake storage enforces the real bucket's MIME allow-list).
- Mobile: `cd apps/mobile && npx tsc --noEmit && npx eslint . && npx jest`.
- Real stack (recommended for backend changes): replay migrations with `scripts/build-migration-replay-workspace.mjs` +
  `supabase start/db reset`, enable the `custom_access_token_hook` in the replay `config.toml`, run the API against it and
  drive `/inspections/complete`. This is how concurrency, the storage privacy rules and the backfill were verified.

## 7. Known limitations

- Camera capture, the system photo picker, on-device file persistence and screen readers have only been exercised in a
  web build and unit tests. Verify on an iPhone (Expo Go) and an Android emulator before release.
- The first-party staging deploy for non-`feature/ai-*` branches is not guaranteed; see the PR for its state.
- Filters apply to **To inspect** only. History insights are activity counts, not room readiness.
