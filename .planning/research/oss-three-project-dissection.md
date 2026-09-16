# PatelRep — Deep Dissection of the 3 Priority OSS Projects

*Research only, no code changed. Sourced from live material: InvenTree docs, Grash/Atlas CMMS JPA entity source (pulled via `gh`), and Google OR-Tools docs. Each section maps concretely onto PatelRep's stack (Supabase Postgres + RLS multi-tenancy, FastAPI routers, Expo mobile).*

**License posture in one line:** copy **InvenTree** (MIT), clean-room **Grash/Atlas** (AGPL — study only, never copy code), depend on **OR-Tools** (Apache-2.0).

---

## 1. InvenTree — the inventory/parts model to *copy*

**Repo:** https://github.com/inventree/InvenTree · **Stack:** Django + DRF, Postgres, Python · **License: MIT** → ✅ read the schema and lift it directly.

### The data model (the valuable part)

**Part** is the *definition* of a thing, not a physical unit. Its power is a set of boolean role-flags letting one table serve many purposes:

| Flag | Meaning for a hotel |
|---|---|
| `purchaseable` | amenity/part you buy (soap, HVAC filter) |
| `consumable` | used up on a job (sealant, cleaning chemical) |
| `trackable` | needs batch/serial (rare for you) |
| `salable` / `assembly` / `component` / `template` / `virtual` | mostly **skip** for a hotel |

Plus: `category` (a **tree** — MPTT), `units`, `minimum_stock`, `maximum_stock`, `default_location`, `default_supplier`, `active`, image.

**The min/max → flag pattern is the single best idea:** if `total_stock < minimum_stock` → auto **"low stock"** flag/notification; `> maximum_stock` → "overstocked." That's your reorder engine with zero extra machinery.

**StockItem** is the *physical quantity* (separate from Part): `part`, `location`, `quantity`, `batch`, `status`, `supplier_part`, timestamps, `last_stocktake`. One Part → many StockItems; total on hand = sum.

**StockLocation** is a **tree** with two clever flags: `structural` (organizational only, holds no stock) and `external`. Maps perfectly to *Building A → Floor 3 → Housekeeping closet 3B → shelf*.

**StockItemTracking** — **every adjustment auto-writes an immutable history row with the user.** Full audit trail for free.

**Stock actions** are just four verbs: **add / remove / count / transfer** — each writes a tracking entry. **PurchaseOrder → receive → line items convert into StockItems.** SupplierPart carries SKU/pack-size/pricing separate from Part.

### What PatelRep should steal (P0 inventory gap)
- **Two-table split: `inventory_items` (definition) + `stock_levels`/`stock_items` (quantity by location).** Do not conflate them.
- **`minimum_stock`/`maximum_stock` on the item → low-stock alert** fired through your existing notifications/Novu path. That *is* the "reorder" feature — don't build anything fancier.
- **Location as a tree** reusing your building/floor structure (`tenants.layout` already models buildings A/B).
- **An `inventory_transactions` audit table** (add/remove/count/transfer + user + WO reference) — mirrors your existing `room_status_history` trigger pattern.
- **Consume-on-use:** a "remove" transaction linked to a work order = parts consumption (wires into the CMMS section below).

### What to skip
BOM, assemblies, sales orders, manufacturer-vs-supplier distinction, build orders, serial tracking. A 50–150 room hotel stocks amenities, linen, and spare parts — not a manufacturing BOM. Take ~20% of InvenTree's schema and drop the rest.

---

## 2. Atlas / Grash CMMS — the engineering model to *study* (not copy)

**Repo:** https://github.com/Grashjs/cmms · **Stack:** Spring Boot (Java) + Postgres, React/TS web, React Native mobile · **License: AGPL-3.0 (dual commercial)** → 🚫 do **not** copy code; clean-room the patterns. It's alive: **pushed 2026-09-10, 768★.** Closest full analog to your engineering module, so its schema is a checklist of what you're missing.

### The real entity model (pulled from the JPA source)

**WorkOrder** = `WorkOrderBase` + workflow fields.
- `WorkOrderBase`: `title`, `description`, `priority` (NONE/LOW/MEDIUM/HIGH), `dueDate`, `estimatedStartDate`, **`estimatedDuration`**, `category`, `location`, `asset`, `team`, `primaryUser`, `assignedTo[]`, `requiredSignature`, `files[]`.
- `WorkOrder` adds: `status` (OPEN/IN_PROGRESS/ON_HOLD/COMPLETE), `completedBy`, `completedOn`, `signature`, `feedback`, `parentRequest`, `parentPreventiveMaintenance`, and **`firstTimeToReact`** (response-time timestamp — raw material for MTTR/response-SLA).

The pieces PatelRep **doesn't have**:

- **`PreventiveMaintenance`** extends WorkOrderBase (a PM *is* a WO template) + a **`Schedule`**: `recurrenceType` (DAILY/WEEKLY/MONTHLY/YEARLY), `frequency`, `endsOn`, `dueDateDelay`, and the killer field **`recurrenceBasedOn: SCHEDULED_DATE vs COMPLETION_DATE`** — "every 30 days on the calendar" vs "30 days *after last completion*." That one enum is the whole PM-recurrence design.
- **`Meter`** (`unit`, `updateFrequency`, category) + **`Reading`** (`value`, `meter`, timestamp). Plus `TaskBase.meter` → checklist items *are* meter readings. This is **meter/usage-based PM** — trigger a PM by runtime hours/cycles, not just the calendar.
- **`Asset`**: `barCode` **and `nfcId`**, `warrantyExpirationDate`, `inServiceDate`, `deprecation`, `acquisitionCost`, `model`/`manufacturer`/`serialNumber`/`power`, `primaryUser`, `location`, `area`. (You already have `warranty_expires` — this shows the rest.)
- **`AssetDowntime`** (`startsOn`, `duration`) → per-asset downtime → MTBF/MTTR. (You track *room* downtime→revenue already; this is the asset-level twin.)
- **Cost/labor stack:** **`Labor`** (`assignedTo`, `hourlyRate`, timer `startedAt` + `status` RUNNING/STOPPED, `timeCategory`, `includeToTotalTime`), **`AdditionalCost`**, **`PartQuantity`** (parts *planned* on a WO/PO), **`PartTransaction`** (parts *consumed* on a WO). Together → **true WO cost = labor + parts + additional.** This is your missing "cost on WO close."
- **`Request`** → `workOrder` (a request *converts* into a WO) with `contact`, `requestPortal` (public submission form), and **`audioDescription`** (a **voice** attachment — a real product doing voice input on the floor).
- **`Checklist`/`Task`/`TaskOption`** = reusable checklist templates with typed items (incl. meter/inspection), and **`CustomField`/`FieldConfiguration`** = user-defined fields per entity.

### What PatelRep should adopt (P0/P1 engineering deepening)
1. **PM as a WO-template + Schedule with `recurrenceBasedOn`** (scheduled vs completion). Auto-generate the WO when due. Your P0 "PM templates + auto-WO."
2. **`estimatedDuration` + `firstTimeToReact` + `AssetDowntime`** → compute **MTTR, response time, and MTBF** — pairs with the downtime→revenue you already have.
3. **`PartTransaction` on WO close → decrement InvenTree-style stock.** Exact seam where the two projects combine.
4. **`Labor` timer + `AdditionalCost`** → cost roll-up per WO/asset.
5. **`barCode`/`nfcId` on assets** → your P0 QR-everywhere ("scan → asset history → log issue").
6. **`Request.audioDescription`** validates your P2 voice-to-task bet.

### What to skip
Their subscription/billing/keygen entities, customers/salable concepts, deprecation accounting, `MultiParts`. And **don't clone their generic "custom fields on everything"** — it's enterprise flexibility that adds phone complexity; keep your schema opinionated and hotel-specific.

---

## 3. Google OR-Tools — the assignment/sequencing engine to *use*

**Repo:** https://github.com/google/or-tools · **License: Apache-2.0** → ✅ link as a Python dependency in `apps/api`. Two distinct tools solve two distinct PatelRep problems.

### A) Housekeeper → room assignment = **CP-SAT assignment**
Cost matrix `cost[housekeeper][room]` = **your existing `housekeeper_profiles` rolling-avg clean time** for that housekeeper × room-type (already computed — it's the exact input OR-Tools wants).

```python
from ortools.sat.python import cp_model
model = cp_model.CpModel()
x = {(h, r): model.NewBoolVar(f"x_{h}_{r}") for h in hk for r in rooms}
for r in rooms:                              # each room assigned once
    model.AddExactlyOne(x[h, r] for h in hk)
for h in hk:                                 # fairness: cap minutes per HK
    model.Add(sum(clean_min[h][r] * x[h, r] for r in rooms) <= shift_capacity[h])
for h, r in forbidden:                       # skills/section constraints
    model.Add(x[h, r] == 0)
model.Minimize(sum(cost[h][r] * x[h, r] for h in hk for r in rooms))
```
Hotel-reality add-ons: **checkout-priority** (weight early-arrival checkout rooms so they're front-loaded), **balanced workload** (minimize the *max* load across housekeepers for fairness), **skill/language match**, **stay-in-section**. Solves well under a second at your scale.

### B) Per-housekeeper room **sequencing** = **VRP (routing)**
Minimize floor-walking with `RoutingModel` + a transit callback where "distance" = travel cost between rooms (floor changes, building A↔B, elevator/laundry). `SetGlobalSpanCostCoefficient` balances routes; time-window dimensions honor "room X must be ready by early check-in." Your `tenants.layout` JSONB (buildings, elevator, laundry) is exactly the adjacency data the callback needs.

```python
manager = RoutingIndexManager(locations, num_vehicles, depot)
routing = RoutingModel(manager)
transit_idx = routing.RegisterTransitCallback(distance_callback)
routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)
routing.AddDimension(transit_idx, slack, max_distance, True, "Distance")
solution = routing.SolveWithParameters(search_parameters)
```

### The product rule
Surface both as **one "Auto-assign / Optimize" button that proposes, and a supervisor accepts or drags to override.** Never fully automate assignment — the value is a smart default in one tap, per your product principle.

### What to skip
Don't reach for VROOM (heavier, BSD, C++ service) or Timefold yet — OR-Tools' CP-SAT covers both assignment and sequencing in one Apache-licensed Python lib. Escalate to Timefold only if you later add complex multi-day rostering.

---

## Why these three, together, are the whole play

They're not three features — they're **one loop**:

> Guest reports AC issue → `Request` (voice ok) → converts to **WorkOrder** (asset auto-linked, SLA `firstTimeToReact` starts) → engineer logs **Labor** + consumes a **PartTransaction** → **InvenTree stock** decrements and trips a **low-stock alert** → **AssetDowntime** recorded → room readiness recalculated → **OR-Tools** re-optimizes remaining assignments around the now-delayed room → analytics get MTTR + parts cost + downtime→revenue.

**InvenTree** gives the copyable stock spine, **Grash/Atlas** gives the (study-only) WO/PM/cost/meter schema that connects to it, and **OR-Tools** is the permissive brain that reacts to the whole thing. License posture stays clean: copy MIT, clean-room the AGPL, depend on Apache.

### Suggested next artifacts (not yet built)
- Concrete Supabase migration + FastAPI router shape for the inventory core (InvenTree-derived).
- Runnable OR-Tools assignment prototype against real `housekeeper_profiles` data.
- PM-template + Schedule (`recurrenceBasedOn`) migration for auto-WO generation.
