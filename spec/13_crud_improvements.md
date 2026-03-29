# PatelRep — CRUD Improvements Spec

## Scope

Two categories of change:

1. **Opera PDF room import removal** — strip the PDF upload path from onboarding entirely; keep CSV upload and manual entry only.
2. **Delete + full edit for Tasks, Lost & Found, Guest Requests, and Engineering Work Orders** — add DELETE endpoints, expand PATCH payloads, add kebab menus and in-place edit mode to all four detail drawers.

---

## 1. Opera PDF Room Import Removal

### 1.1 Backend (`apps/api`)

**Delete the endpoint:**

```python
# REMOVE from apps/api/routers/onboarding.py
@router.post("/rooms/import-pdf")
async def import_rooms_pdf(...)
```

Remove the `_map_headers()` and `_normalize_header()` helpers only if they are not used by the CSV path. If `_map_headers()` is used in both — it currently is — move the logic inline into `import_rooms_csv` or keep it as a shared private helper. Remove the two helpers once confirmed unused.

**Remove `pdfplumber` dependency:**

```
# REMOVE from apps/api/requirements.txt
pdfplumber
```

Also remove any indirect transitive dependency (`pdfminer.six`, `Pillow` image extraction shim) that was only pulled in by `pdfplumber` if not used elsewhere.

### 1.2 Frontend (`apps/web`)

The onboarding room import step currently offers CSV and PDF upload modes. After this change:

**UI layout — Tabs: CSV | Manual**

```
┌─────────────────────────────────────────────────┐
│  Import Rooms                                    │
│  ┌────────────┬──────────────────┐               │
│  │  CSV Upload │  Manual Entry   │               │
│  └────────────┴──────────────────┘               │
│                                                  │
│  [Tab content changes based on selection]        │
└─────────────────────────────────────────────────┘
```

- **CSV Upload tab**: existing drag-and-drop / file picker UI. No changes to functionality.
- **Manual Entry tab**: existing one-at-a-time room form (room number, floor, room type code, room type name). No changes to functionality.
- Remove any reference to PDF, pdfplumber, "Opera room list", or "Upload from Opera" in copy.
- Remove the PDF file picker, PDF help text, and any PDF-specific error messages.

### 1.3 AI assistant step context

Update the `STEP_CONTEXT[2]` string in `onboarding.py → onboarding_ai_assistant`:

```python
# BEFORE
"The GM is importing rooms via CSV or manually. The CSV format needs: room_number, floor, room_type_code..."
# (remove "They can also connect Opera Cloud to import automatically" from this step)

# AFTER — remove the Opera import mention; keep CSV + manual only
"The GM is importing rooms via CSV upload or by adding rooms one at a time manually. ..."
```

---

## 2. Delete + Full Edit — All Four Domains

### 2.1 RBAC

All roles (`housekeeper`, `engineer`, `housekeeping_supervisor`, `chief_engineer`, `front_desk`, `gm`) can delete and edit any record scoped to their hotel. No role restriction beyond the existing tenant scope (`hotel_id`).

No status restrictions — records at any status (open, in_progress, completed, cancelled, claimed, etc.) can be deleted or edited.

### 2.2 Delete behavior

- **Hard delete** — `DELETE FROM <table> WHERE id = $1 AND tenant_id = $2`. No soft-delete column.
- **Confirmation dialog** before all deletes. Standard pattern:

  ```
  "Delete [Record Name]?"
  "This action cannot be undone."
  [Cancel]  [Delete]
  ```

- **Post-delete**: optimistic removal from the React Query cache → list item disappears immediately → detail drawer/panel closes → brief "Deleted" toast.

### 2.3 Edit behavior

- **In-place drawer edit mode** — the existing detail drawer gains an Edit button (pencil icon). Clicking it switches all displayed fields to input controls. Save/Cancel buttons appear at the bottom.
- **Post-save**: drawer exits edit mode, shows updated read-mode values, React Query list cache is invalidated (refetches list in background).
- **Three-dot kebab menu `⋮`** on each list card (not inside the drawer). Menu options: **Edit** (opens drawer in edit mode) and **Delete** (triggers confirmation dialog). No status-change shortcuts in the menu.

---

## 3. Tasks

### 3.1 Backend

**Expand `UpdateTaskRequest` (models/requests.py):**

```python
class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[UUID] = None
    location_text: Optional[str] = None
    due_at: Optional[datetime] = None
    notes: Optional[str] = None
```

The existing `PATCH /tasks/{task_id}` handler already calls `request.model_dump(exclude_none=True)` and passes it through — no handler logic changes needed beyond ensuring the new fields are not blocked by any column allowlist.

**New DELETE endpoint:**

```python
@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("tasks") \
        .delete() \
        .eq("id", task_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    # Also remove orphaned task_comments (cascade should handle this if FK is set,
    # otherwise delete manually):
    supabase.table("task_comments") \
        .delete() \
        .eq("task_id", task_id) \
        .execute()
```

> **DB note**: If `task_comments.task_id` has `ON DELETE CASCADE` in the migration, the comment cleanup is automatic. Verify in migration `002` or later; add a migration if cascade is not set.

### 3.2 Frontend (`apps/web/app/(dashboard)/tasks/page.tsx`)

**Changes:**

1. Add `⋮` `KebabMenu` component to `TaskCard` — shows **Edit** and **Delete**.
2. **Edit** → opens `TaskDetailDrawer` with `editMode=true` prop.
3. **Delete** → opens `DeleteConfirmDialog` with task title; on confirm calls `tasksApi.delete(task.id)`.
4. `TaskDetailDrawer` gains an edit mode:
   - A pencil icon button in the drawer header toggles `isEditing` state.
   - Edit mode replaces read-only field values with controlled inputs for: title, description, task_type, priority, assigned_to, location_text, due_at.
   - Save button calls `tasksApi.update(task.id, editPayload)`.
   - Cancel button reverts state without saving.

**New API client method:**

```typescript
// lib/api/tasks.ts
delete: (taskId: string) =>
  apiFetch(`/tasks/${taskId}`, { method: 'DELETE' }),
```

---

## 4. Lost & Found

### 4.1 Backend

**Expand `PATCH /lost-found/{item_id}`:**

Change the `allowed_fields` allowlist to include all editable columns:

```python
# BEFORE
allowed_fields = {"status", "notes", "claimed_by_name", "claimed_at", "claimed_by_contact"}

# AFTER — full edit
allowed_fields = {
    "description",
    "location_found",
    "room_id",
    "notes",
    "status",
    "claimed_by_name",
    "claimed_by_contact",
    "claimed_at",
}
```

**New DELETE endpoint:**

```python
@router.delete("/{item_id}", status_code=204)
async def delete_lost_found_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    result = supabase.table("lost_found_items") \
        .delete() \
        .eq("id", item_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")
```

### 4.2 Frontend (`apps/web/app/(dashboard)/lost-found/page.tsx`)

1. Add `⋮` kebab menu on each item card with **Edit** and **Delete**.
2. **Edit** → opens the item detail panel in edit mode (in-place form with all fields).
3. **Delete** → confirmation dialog → `lostFoundApi.delete(item.id)` → optimistic removal + toast.
4. Edit form fields: description, location_found, room selector, notes, status, claimed_by_name, claimed_by_contact.

**New API client method:**

```typescript
// lib/api/lost_found.ts
delete: (itemId: string) =>
  apiFetch(`/lost-found/${itemId}`, { method: 'DELETE' }),
```

---

## 5. Guest Requests

### 5.1 Backend

**Expand `PATCH /guest-requests/{request_id}`:**

```python
# BEFORE
allowed_fields = {"status", "notes", "resolved_at", "assigned_to"}

# AFTER — full edit; cascade title+description to linked task
allowed_fields = {
    "title",
    "description",
    "room_id",
    "guest_name",
    "status",
    "notes",
    "resolved_at",
    "assigned_to",
}
```

Add cascade logic for `title` and `description` edits:

```python
@router.patch("/{request_id}")
async def update_guest_request(
    request_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user)
):
    allowed_fields = { "title", "description", "room_id", "guest_name",
                       "status", "notes", "resolved_at", "assigned_to" }
    update_data = {k: v for k, v in body.items() if k in allowed_fields}

    if update_data.get("status") == "resolved" and "resolved_at" not in update_data:
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("guest_requests") \
        .update(update_data) \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()

    # Cascade title/description to the linked task (if still unmodified is not tracked,
    # always cascade — both records were created together)
    if result.data:
        gr = result.data[0]
        task_id = gr.get("task_id")
        task_cascade: dict = {}
        if "title" in update_data:
            task_cascade["title"] = update_data["title"]
        if "description" in update_data:
            task_cascade["description"] = update_data["description"]
        if task_id and task_cascade:
            supabase.table("tasks") \
                .update(task_cascade) \
                .eq("id", task_id) \
                .eq("tenant_id", current_user.hotel_id) \
                .execute()

    return {"data": result.data[0] if result.data else None}
```

**New DELETE endpoint (cascade to linked task):**

```python
@router.delete("/{request_id}", status_code=204)
async def delete_guest_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    # Fetch the guest request to get linked task_id before deletion
    gr = supabase.table("guest_requests") \
        .select("task_id") \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single() \
        .execute()

    if not gr.data:
        raise HTTPException(status_code=404, detail="Guest request not found")

    task_id = gr.data.get("task_id")

    # Delete the guest request
    supabase.table("guest_requests") \
        .delete() \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()

    # Cascade: delete the auto-created linked task
    if task_id:
        supabase.table("task_comments") \
            .delete() \
            .eq("task_id", task_id) \
            .execute()
        supabase.table("tasks") \
            .delete() \
            .eq("id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
```

> **Note**: Supabase Python SDK does not support multi-statement transactions in a single call. The delete sequence (GR → task_comments → task) is sequential. If any step fails after the GR is deleted, the orphan task/comments remain. This is acceptable for MVP; add a DB-level trigger or Postgres function for strict atomicity if needed later.

### 5.2 Frontend (`apps/web/app/(dashboard)/guest-requests/page.tsx`)

1. Add `⋮` kebab menu on each request card with **Edit** and **Delete**.
2. **Edit** → opens detail panel in edit mode with fields: title, description, guest_name, room selector, status, assigned_to, notes.
3. **Delete** → confirmation dialog noting "This will also delete the linked task." → `guestRequestsApi.delete(id)`.
4. After delete: invalidate both `['guest-requests']` and `['tasks']` React Query keys.

**New API client method:**

```typescript
// lib/api/guest_requests.ts
delete: (requestId: string) =>
  apiFetch(`/guest-requests/${requestId}`, { method: 'DELETE' }),
```

---

## 6. Engineering Work Orders

### 6.1 Backend

The existing `UpdateWorkOrderRequest` model and `PATCH /work-orders/{wo_id}` handler are already fairly broad. Confirm the model includes all editable fields; add any missing ones:

```python
class UpdateWorkOrderRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[UUID] = None
    room_id: Optional[UUID] = None
    location_text: Optional[str] = None
    asset_id: Optional[UUID] = None
    due_at: Optional[datetime] = None
    notes: Optional[str] = None
    labor_hours: Optional[float] = None
    parts_used: Optional[dict] = None
```

Keep the existing cancel-only role check:

```python
if request.status == "cancelled" and current_user.role not in ("gm", "chief_engineer"):
    raise HTTPException(status_code=403, detail="Only GM or Chief Engineer can cancel work orders")
```

**New DELETE endpoint:**

```python
@router.delete("/{wo_id}", status_code=204)
async def delete_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    wo_check = supabase.table("work_orders") \
        .select("id") \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single() \
        .execute()
    if not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    # Delete child records first (no cascade FK assumed)
    supabase.table("work_order_comments") \
        .delete() \
        .eq("work_order_id", wo_id) \
        .execute()
    supabase.table("work_order_photos") \
        .delete() \
        .eq("work_order_id", wo_id) \
        .execute()
    supabase.table("work_orders") \
        .delete() \
        .eq("id", wo_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()
```

### 6.2 Frontend (`apps/web/app/(dashboard)/engineering/page.tsx`)

1. Add `⋮` kebab menu on each WO card with **Edit** and **Delete**.
2. **Edit** → opens the work order detail panel in edit mode. Edit fields: title, description, category, priority, assigned_to, room, location_text, asset, due_at, notes, labor_hours, parts_used.
3. **Delete** → confirmation dialog → `workOrdersApi.delete(wo.id)` → optimistic removal + toast.

**New API client method:**

```typescript
// lib/api/work_orders.ts
delete: (woId: string) =>
  apiFetch(`/work-orders/${woId}`, { method: 'DELETE' }),
```

---

## 7. Shared UI Component: `KebabMenu`

Create a reusable `KebabMenu` component used across all four list pages:

```tsx
// components/shared/KebabMenu.tsx
interface KebabMenuProps {
  onEdit: () => void
  onDelete: () => void
}
```

- Renders a `⋮` button (MoreVertical icon from lucide-react).
- Opens a small dropdown (absolute positioned, `z-10`) with "Edit" and "Delete" menu items.
- Delete item is styled with `text-red-600` to signal destructive action.
- Clicking outside closes the dropdown (use `useEffect` with a `mousedown` listener or a Radix `DropdownMenu`).
- `onClick` on the card itself should NOT open the dropdown (stop propagation on the `⋮` button click).

## 8. Shared UI Component: `DeleteConfirmDialog`

```tsx
// components/shared/DeleteConfirmDialog.tsx
interface DeleteConfirmDialogProps {
  open: boolean
  title: string           // e.g. "Delete Task"
  description?: string    // e.g. "This will also delete the linked task."
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}
```

- Renders a centered modal overlay.
- Title in `font-semibold`, description in `text-sm text-gray-500`.
- Cancel button (ghost) + Delete button (red solid).
- Shows a spinner on the Delete button while `loading=true`.

---

## 9. Database Migrations

### Migration 020 — Verify/Add cascade FK for child records

```sql
-- Check if task_comments.task_id has ON DELETE CASCADE
-- If not, this migration adds it:
ALTER TABLE task_comments
  DROP CONSTRAINT IF EXISTS task_comments_task_id_fkey,
  ADD CONSTRAINT task_comments_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE work_order_comments
  DROP CONSTRAINT IF EXISTS work_order_comments_work_order_id_fkey,
  ADD CONSTRAINT work_order_comments_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

ALTER TABLE work_order_photos
  DROP CONSTRAINT IF EXISTS work_order_photos_work_order_id_fkey,
  ADD CONSTRAINT work_order_photos_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
```

With these constraints, the explicit child-record cleanup in the DELETE handlers becomes redundant but harmless. The handlers can remain as a belt-and-suspenders safety net.

---

## 10. Summary of New Endpoints

| Method | Path | Domain | Notes |
|--------|------|--------|-------|
| `DELETE` | `/v1/tasks/{task_id}` | Tasks | Hard delete; cleans up task_comments |
| `DELETE` | `/v1/lost-found/{item_id}` | Lost & Found | Hard delete |
| `DELETE` | `/v1/guest-requests/{request_id}` | Guest Requests | Cascades to linked task + task_comments |
| `DELETE` | `/v1/work-orders/{wo_id}` | Engineering | Cascades to WO comments + photos |
| `DELETE` | `/v1/onboarding/rooms/import-pdf` | Onboarding | **REMOVED** |

## 11. Summary of Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `PATCH` | `/v1/tasks/{task_id}` | `UpdateTaskRequest` expanded with title, description, task_type, location_text, due_at |
| `PATCH` | `/v1/lost-found/{item_id}` | `allowed_fields` expanded to include description, location_found, room_id |
| `PATCH` | `/v1/guest-requests/{request_id}` | `allowed_fields` expanded; cascade title+description to linked task |
| `PATCH` | `/v1/work-orders/{wo_id}` | `UpdateWorkOrderRequest` confirmed to include all fields |
