# Phase 38: Engineering Work Order Labor + Cost Capture - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning
**Mode:** Autonomous (user delegated all decisions — "gsd plan phase and then build ... do not ask me any questions you go ahead and make all the decisions and do not come back to me until its built." No interactive discussion was run; decisions below are Claude's, grounded in `.planning/research/oss-ecosystem-landscape.md` (item #7 in the ranked Output-3 list: "Parts + labor + cost on WO close") and `.planning/research/oss-three-project-dissection.md`'s Atlas/Grash CMMS section (`Labor` timer + `AdditionalCost` + `PartTransaction` → true WO cost = labor + parts), plus a direct read of the current schema/code before writing this file.

<domain>
## Phase Boundary

Parts consumption already exists end-to-end (migration 102, shipped in the prior OSS-research build pass: `engineering_parts` / `engineering_part_stock` / `engineering_part_transactions`, wired into `POST /work-orders/{id}/complete` via `parts_consumed[]`). `work_orders.labor_hours` also already exists as a plain `DECIMAL(4,2)` column with no rate behind it, and `work_orders.parts_used` is a free-text field. What's missing, confirmed by direct grep before this file was written: **no cost anywhere in the system** — no `hourly_rate` on any staff/role table, no `unit_cost` on `engineering_parts`, no cost column on `work_orders`, no MTTR/MTBF, no cost display in any web component.

This phase closes exactly the P0 gap: turn the labor hours already being captured, plus the parts already being consumed, into a **dollar cost stored on the work order at completion time** and **shown in the UI**. It does NOT build a `Labor` timer (start/stop clock — Atlas/Grash has this; out of scope, `labor_hours` stays a manually-entered number as it already is today), does NOT build MTTR/MTBF analytics (ranked #14, separate item, deferred), does NOT build a vendor/contractor cost path (no vendor concept exists yet in this codebase), and does NOT touch `housekeeping_supply_pars` or any non-engineering inventory.

</domain>

<decisions>
## Implementation Decisions

### Schema (new migration, next free number `104_*.sql`)
- `ALTER TABLE public.user_roles ADD COLUMN hourly_rate NUMERIC(8,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0);` — `user_roles` is this codebase's staff/profile table (migration 003), confirmed by grep; there is no separate `staff` table. Nullable — a hotel doesn't have to fill in rates before this ships; NULL rate means labor cost simply can't be computed (falls back to `NULL`/0, never blocks WO completion).
- `ALTER TABLE public.engineering_parts ADD COLUMN unit_cost NUMERIC(10,2) CHECK (unit_cost IS NULL OR unit_cost >= 0);` — cost per unit of a part, editable wherever parts are already CRUD'd (`PartsPanel.tsx` / `inventory.py`). Nullable for the same reason.
- `ALTER TABLE public.work_orders ADD COLUMN labor_cost NUMERIC(10,2), ADD COLUMN parts_cost NUMERIC(10,2), ADD COLUMN total_cost NUMERIC(10,2);` — three plain nullable columns, **not** a generated column (Postgres `GENERATED ALWAYS AS` can't reference values computed in application code from a join across `engineering_part_transactions`/`user_roles`; the API computes and writes all three at completion time). Left NULL until a WO is completed with cost-computable inputs.
- Follow the append-only-audit precedent used for stock only where it already applies — `engineering_part_transactions` is untouched by this phase (still just quantity movements); cost multiplication happens in application code by joining `quantity_delta` × `engineering_parts.unit_cost` at the moment of completion, not stored per-transaction. This keeps the immutable-audit-log table's shape unchanged (no migration risk to a trigger-guarded append-only table).

### Cost computation (in `complete_work_order`, `apps/api/routers/work_orders.py`)
- **Labor cost** = `request.labor_hours * hourly_rate` where `hourly_rate` is looked up from `user_roles` for the work order's `assigned_to` (fall back to `completed_by`/`current_user.user_id` if `assigned_to` is null) — Claude's discretion at plan time on the exact fallback order, but assigned_to first matches "whoever did the work" intent. If no `hourly_rate` is on file (NULL), `labor_cost` stays NULL — do not silently default to $0 or a guessed rate, since a $0 cost is misleading (looks like free labor) whereas NULL clearly means "unknown."
- **Parts cost** = sum of `quantity * engineering_parts.unit_cost` for every row in `request.parts_consumed[]`, computed from the already-fetched part rows during the existing pre-flight stock check (no extra query — the completion handler already loads each `engineering_parts` row to validate stock, per the Phase-1 SUMMARY). If any consumed part has a NULL `unit_cost`, that part contributes 0 to the sum but the response should make clear the total is a partial/lower-bound cost (see Claude's Discretion — exact flag/annotation is a display detail, not a schema one).
- **Total cost** = `COALESCE(labor_cost, 0) + COALESCE(parts_cost, 0)`, written as `total_cost` only if at least one of the two is non-NULL; if both are NULL (no labor_hours given, no parts consumed, or all costs unknown), leave `total_cost` NULL rather than writing `0` — a WO closed with truly nothing captured should read as "no cost data," not "cost was zero."
- This computation happens once, at completion, and is **not recomputed retroactively** if `hourly_rate`/`unit_cost` change later — matches how `parts_consumed` stock decrement is already a point-in-time action, not a live-recalculated view.

### API surface
- `CompleteWorkOrderRequest` (`apps/api/models/requests.py`) needs no new input fields — `labor_hours` and `parts_consumed[]` already exist and are the only inputs this phase needs; cost is *derived*, never entered directly by the completing user (prevents cost-entry drift from the rate-table source of truth).
- `WorkOrderResponse` (`apps/api/models/responses.py`) gains `labor_cost: Optional[float]`, `parts_cost: Optional[float]`, `total_cost: Optional[float]` — read straight off the new columns, standard `{"data": ...}` envelope, no new endpoint needed.
- `UpdateStaffProfileRequest` / whatever endpoint already edits a staff member's `user_roles` row gains an optional `hourly_rate: Optional[float] = Field(default=None, ge=0, le=500)` field, gated to `require_role("gm")` only (matches every other staff-admin write in `staff.py` — all gm-only per the grep of existing role gates). Do not expose hourly_rate editing to chief_engineer or engineer roles — pay-rate-adjacent data is GM-only by the existing pattern in this file, no exceptions needed for this phase.
- `hourly_rate` must **never** be included in any response visible to the `engineer`/`housekeeper`/`front_desk` roles (a floor worker should not see their own or a coworker's pay rate reflected back from an API call) — if the existing staff-list/profile response already role-gates fields, follow that pattern exactly; if it doesn't yet, add the gate as part of this phase since leaking pay-rate data is a real regression risk, not a hypothetical one.

### UI
- **Parts CRUD (`PartsPanel.tsx` / `inventory.py`):** add a `unit_cost` input to the existing part create/edit form (currency input, optional). No new component.
- **Work order completion drawer (`WorkOrderDetailDrawer.tsx`):** no new input — the completion drawer's existing `labor_hours` field and parts-consumed picker are unchanged. After completion, the WO detail view shows a small read-only "Cost" line (e.g. "Labor: $X · Parts: $Y · Total: $Z", or "Cost data unavailable" if `total_cost` is NULL) — Claude's discretion on exact layout/copy, but it must be visibly present on the completed WO, not buried behind a click.
- **Staff profile/settings (GM-only edit surface, wherever `UpdateStaffProfileRequest` is currently submitted from):** add an hourly-rate input next to whatever role/permission fields already exist there, gm-visible only, matching the RBAC decision above.
- Do not add a cost column to the main work-orders list/board view — keeping the list dense and phone-first is the existing product filter; cost lives in the WO detail/completion view only, consistent with how `parts_used`/`labor_hours` are already detail-only fields today, not list columns.

### Claude's Discretion
- Exact fallback order for whose `hourly_rate` is used if `assigned_to` has none set (e.g. try `completed_by` next, or just leave labor_cost NULL) — pick whichever is simplest to implement correctly; document the choice in the plan.
- Exact display copy/layout for the cost line in `WorkOrderDetailDrawer.tsx` and how a "partial cost" (some parts had no unit_cost) is visually flagged, if at all.
- Whether the new `hourly_rate` input on the staff edit form uses a shared currency-input component already in the codebase or a plain number input — follow whatever pattern nearby fields (e.g. `annual_maintenance_cost` from migration 071) already use in their own form.
- Test file naming/organization — follow this project's existing `test_work_order_parts_consumption.py` / `test_inventory.py` conventions from the Phase-1 build.
- Migration file name (must be `104_*.sql`, exact suffix is discretion).

### Deferred Ideas (explicitly out of scope)
- Labor timer (start/stop clock, `RUNNING`/`STOPPED` states like Grash's `Labor` entity) — `labor_hours` stays manually entered.
- MTTR/MTBF analytics (ranked #14 in the research doc) — separate future phase.
- Vendor/contractor cost capture — no vendor concept exists in this codebase yet.
- Retroactive cost recalculation when rates/unit costs change after a WO is closed.
- Cost roll-up dashboards/reporting (e.g. "total maintenance spend this month") — this phase only stores and displays cost on the individual WO; aggregate reporting is a separate future item.
- Editing hourly_rate for chief_engineer/housekeeping_supervisor/etc. roles beyond what the existing gm-only staff-admin gate already allows — no new role-permission surface.

</decisions>
