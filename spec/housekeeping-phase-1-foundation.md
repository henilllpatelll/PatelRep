# Housekeeping redesign — Phase 1 foundation

## Current operational data

- `GET /housekeeping/board` is the supervisor source of truth. It already returns room, room-type, building/floor, current housekeeping and PMS (`fo_status`) state, assignment, clean type, VIP, DND, service-declined, priority, check-in/out, readiness prediction, latest room note, the latest open work order, and latest clean-session evidence. The client retains the existing room-status and assignment Realtime subscriptions plus its polling fallback.
- Guest-request and open-task counts are fetched independently by the existing board client. They are not yet part of the board endpoint. The shared room adapter accepts these counts when a later composition layer supplies them.
- Inspections have templates, required items/photos, `ready-for-inspection`, history, submit, and re-clean endpoints. Programs also owns rule-driven inspection sampling (`inspection_sampling_rules` and `GET /programs/inspection-sample`). `InspectionModal.tsx` has no current caller, so reconnecting it belongs in the contextual inspection phase.
- DND and declined service are persisted separately as `room_status.dnd_flag` and `room_status.do_not_service`; rooms endpoints support setting each flag and creating a welfare check. Program settings include a tenant DND welfare policy.
- A housekeeper can have an active/on-break/ended `hk_shift_sessions` record, while scheduled availability is represented by `shift_assignments`. The current shift API exposes only the caller's session, so a supervisor Team Plan availability feed needs a scoped roster endpoint or an extension of an existing staff endpoint.
- Clean-type workload weights are client-side `DEP=3`, `FULL=2`, and `LIGHT=1`. The previous 16-credit target is now reached through `getDefaultWorkloadTarget()`; no persisted hotel workload-target field currently exists.

## Gaps deliberately left for later phases

- There is an integer room `priority` and VIP flag, but no explicit manual rush flag, rush reason, or needed-by timestamp.
- PMS occupancy (`fo_status`) and operational room state exist, but there is no durable occupancy-discrepancy record or Front Desk verification workflow.
- The board exposes the latest open work order, but it has no explicit `blocks_housekeeping` field. Phase 1 treats urgent or on-hold work as an attention candidate only; a later workflow should make blocking intentional.
- A failed inspection triggers a re-clean task and returns the room to cleaning, but there is no durable board-level `reclean_required` flag. The shared selector supports one when the eventual API exposes it.
- Master-data administration is already available at `/settings/rooms`. The legacy `/housekeeping/rooms` page remains for backward compatibility; no internal `href`, router navigation, or redirect currently points to it. A later phase can retire that route only after auditing bookmarks and external links.

## Phase 1 boundaries

- `/housekeeping/assignments`, `/housekeeping/inspections`, and `/housekeeping/routes` continue redirecting to the main workspace.
- “Routes” is now presented as “Team Plan” through a semantic wrapper, but its existing implementation is intentionally unchanged.
- No database migration, API contract change, prediction removal, or mobile work is part of this phase.
