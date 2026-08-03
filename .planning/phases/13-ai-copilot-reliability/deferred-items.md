# Deferred Items — Phase 13 (AI Copilot Reliability)

Out-of-scope discoveries found during live verification, logged per the executor's
scope-boundary rule (only fix issues directly caused by the current task's changes).

## From 13-02 live verification (2026-08-02)

1. **`GET /v1/tasks?per_page=200` returns 422** — `EngineeringRoomBoard.tsx` (not touched
   by 13-02) requests `per_page: 200` via `tasksApi.list()`, but the backend's `/v1/tasks`
   query-param validation caps `per_page` at `le=100`. Reproduced live when switching to
   the Room Board tab on Engineering → Work Orders: the tasks count/badge silently fails
   to load (console 422, React Query swallows it, no visible UI breakage) while rooms
   themselves render fine. Not caused by 13-02's changes (`EngineeringRoomBoard.tsx` is
   outside this plan's file list) and not blocking 13-02's own success criteria. Needs a
   fix in either the frontend call site (lower `per_page`) or the backend validator
   (raise the cap) in a future plan.

2. **Broader `ai_interactions.interaction_type` CHECK-constraint drift is real and
   reproducible** — confirmed live (not just theorized) that `intent_to_log` values not
   in migration 013's original 8-value list — specifically `"general"` (the fallback for
   any message that scores zero against all keyword lists in `detect_intent`) — still
   500/400 on the final `log_ai_interaction` call, exactly as migration
   `088_ai_interactions_work_order_triage_type.sql`'s header comment already documented
   and explicitly deferred. Reproduced via the main AI Copilot chat bubble with a message
   that doesn't match any intent keyword ("Create a task to check smoke detectors in room
   210" scores 0 against `task_creation`/`work_order_creation`/`guest_request_creation`
   keyword lists and falls to `general`, then 400s). This is pre-existing, already known,
   and intentionally out of 13-02's scope (13-02 only added `work_order_triage` to the
   allowed list) — tracked here as live confirmation, not a new bug. A future plan should
   widen the CHECK constraint to cover all `intent_to_log` values actually used in code
   (`work_order_creation`, `guest_request_creation`, `task_assignment`,
   `housekeeping_briefing`, `general`).

## From 13-03 live verification (2026-08-02)

3. **Same `general`-intent CHECK-constraint drift (item 2 above) reproduced via a third
   entry point** — clicking the "At-risk rooms today" quick-action chip in the main
   `AICopilotBubble` (dashboard) also scores 0 against every `detect_intent` keyword list,
   falls to `general`, and 400s with `{"error":{"code":"23514", ...}}` at the final
   `log_ai_interaction` call. Not a new bug and not caused by 13-03's changes (13-03 only
   modifies `AICopilotBubble.tsx`'s catch blocks, not intent detection or the backend) —
   confirms the same pre-existing, already-deferred drift from item 2 is reachable from a
   third UI surface. Notably, 13-03's `sendMessage` fix (real `ApiClientError.message`
   instead of a hardcoded generic string) is what surfaced the specific `"Database request
   failed. Please check the request and try again."` detail inline in the chat thread —
   proving the fix's value, even though the underlying 400 itself is out of scope here.
