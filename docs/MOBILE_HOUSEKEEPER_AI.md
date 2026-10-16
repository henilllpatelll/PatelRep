# Mobile Housekeeper AI

How the housekeeper app's AI features work, what they cost, how they are controlled, and how to verify them.
Scope: `apps/mobile` plus the `apps/api` routes under `/v1/ai`, `/v1/sop` and `/v1/clean-sessions`.
Principle: AI saves a housekeeper time on the floor or it is not there. Everything operational (ranking, access, DND,
checklists, completion) is deterministic code; AI only words, explains, parses and suggests.

## 1. Architecture

- **One assistant.** `lib/ai/AssistantProvider.tsx` owns one conversation, one composer draft and one subject for the
  compact sheet (`components/ai/AssistantSheet`) and the full chat (`app/(app)/copilot`). Entry points call
  `openAssistant({ contextType, entityId })` (`lib/ai/launch.ts`); screens use `useAssistantOptional()` and keep working
  without it.
- **One contract.** `lib/ai/contract.ts` is the only reader of the chat envelope. A reply it cannot read is
  `invalid_response`, never an action.
- **Phone-side facts are free.** Room questions, "why this room", the shift plan, the task explanation and the handoff
  text are built on the phone from records already loaded (`lib/housekeeping/*`). No request, works offline.
- **Server.** `routers/ai_copilot.py` (chat, briefings, recap, photo, translation, confirm routes, usage),
  `services/ai/*` (parsers, RAG `sop_rag.py`, `sop_access.py`, `authorization.py`, `photo_analysis.py`).

## 2. Capabilities

Floating assistant (housekeepers) · room/task/SOP-aware questions · multi-task and voice task parsing · maintenance
drafting · optional photo analysis · approved-procedure answers with real citations · task translation · attention and
notification explanations · verified shift recap · AI & voice settings.

## 3. Context and authorization

The client's role, intent hint and ids are claims. The server takes role/hotel from the verified JWT, whitelists the intent
hint, and re-checks every id (`resolve_trusted_context`): a housekeeper's room must be on their CURRENT assignment, a task
must be theirs, a document must be visible AND approved in their hotel. GM-only reports are refused for other roles. Every query is
hotel-scoped; RLS remains underneath.

"Current assignment" is the room's `room_assignments` row for today's **hotel-local** date (tenant timezone, default
America/Chicago): whoever it names holds the room, so a reassignment (including a same-day rewrite) takes it away at once. An
older, expired or future-dated row grants nothing. One carry-over exists for overnight shifts: yesterday's row still counts while
that person is clocked in (`hk_shift_sessions`, not ended) on a shift that began yesterday and nobody has been given the room
today. Supervisors and GMs are not assignment-bound.

## 4. Confirmation and execution

Parsers return previews (`requires_confirmation`). Nothing is created until the person confirms; confirm routes re-validate
role, rooms (this hotel only), batch size and idempotency. AI cannot clear DND, grant entry, change room status, finish a
shift, dispatch a work order or reassign supervisor assignments; no AI path writes any of those. The one AI path that assigns
rooms, `POST /ai/assignments/confirm` (and the `task_assignment` intent), is limited to GM and housekeeping supervisor, the same
authority as the housekeeping assignment routes; line engineers have none there, so the AI cannot grant it
(`tests/test_ai_copilot_rbac.py` ties the two together).

## 5. Provider / model routing

`gpt-4o-mini`: task/work-order/guest-request/assignment parsing, photo analysis, translation. `claude-sonnet`: SOP answers,
briefings, recap, insights. Keys live only on the API; the phone holds none. Per-hotel overrides: `ai_model_routes`.

## 6. Credits and cost control

- Credits are derived from the provider's **actual token usage** (`middleware/credits.py::compute_credits`), never fixed.
- **Pre-flight (Phase 7):** `assert_ai_allowance` runs before every paid provider call (chat parsers/RAG, briefings, recap,
  photo, translation, SOP query, shift summary, insights). A hotel at its cap gets `402` and **no provider spend**; the
  refusal is logged (`error_message = credit_limit`). Free paths (rule-engine task parsing, phone-side answers, cache hits)
  keep working. A test asserts every function that charges credits checks the allowance first.
- Nothing paid happens on opening a screen. Paid calls are explicit taps; the phone de-duplicates (one in-flight request per
  key; a recent briefing/recap is reused); the server caches the recap per facts, and translations per task-text hash.
- Rate limit: 20 AI requests/min/user (`middleware/rate_limit.py`).
- **Concurrency (migration 217):** the cap check and the increment used to be two steps, so overlapping requests all passed
  the same stale check and were all billed. `check_and_deduct_credits` now calls `deduct_ai_credits()`, one statement that
  checks and increments under the ledger row lock, so the ledger passes the cap by at most the single call that crossed it,
  whatever the concurrency (`tests/test_ai_credit_concurrency.py`). Until the migration is applied the API logs a warning and
  uses the previous read-then-increment. There is deliberately no up-front reservation: a call's cost is only known from
  the provider's actual usage, and holds would add leak-on-crash billing risk.
- Remaining risks: calls already in flight when the cap is reached still reach the provider, and their deduction is then refused
  (the hotel is not billed past the cap, but that provider spend is ours); sync provider
  calls inside async handlers serialize per worker (a bound, but also a latency risk); a provider invoice is the only
  authoritative cost, so the usage summary's dollar figure is an estimate.

## 7. Usage observability

`GET /v1/ai/usage?days=30` (GM only, own hotel only) summarizes the existing `ai_interactions` log per feature and model:
requests, failures, timeouts, cap refusals, cache hits, tokens, credits, avg/p95 latency, unmetered requests, estimated
cost. No message text, no person ids. Not measured server-side: confirmation outcomes and client-side duplicate
suppression (they never reach the API).

## 8. Offline and fallback

AI calls are online-only and never queued; the offline outbox carries only task, room-status, work-order and logbook
actions, so nothing paid can replay on reconnect. Without AI, every manual path remains: typing a task, reporting an
issue, the checklist, reading the original SOP and task text. A failure shows a short sentence, never raw errors.

## 9. Photo analysis

One photo the person chose, after an explicit disclosure. Validated from its bytes, re-encoded without metadata, analysed in
memory, never stored; output whitelisted; result is a suggestion the person edits. Limits: category/description hints only,
no damage assessment, no guest detection. Needs `hk_ai_photo_analysis`.

## 10. SOP retrieval and citations

Answers come only from approved, in-effect, indexed documents of the caller's hotel (`sop_access.py`, `require_approved=True`
for retrieval and for the assistant's document context). An upload with no `controlled_documents` record stays in the library for
browsing, labelled as uploaded, with `ai_ready: false`; it is never retrieved, cited or used as context, so it cannot be presented
as approved policy; excerpts are untrusted
data; invented figures are rejected; citations are real title/version/page only; the original is always one tap away and a
translation never replaces it.

## 11. Cleaning-time estimates

`services/cleaning_estimates.py`, served by `GET /v1/clean-sessions/estimates`. Deterministic, no model call, hotel-level.
1. Only trustworthy completed sessions: consistent timestamps, not truncated at the 240-min cap, ≥3 min, no DND/guest/
   maintenance blocker, something ticked, no duplicate, no overlap with the same person's other session.
2. Per (room type, clean type): median after a MAD trim, shrunk toward the baseline `(n·median + 6·baseline)/(n+6)`, bounded
   to 0.4–2.5× baseline.
3. **Hold-out gate:** train on the older 70%, predict the newest 30%; the learned figure is returned only if it has ≥20
   valid sessions, ≥6 hold-out cleans and its MAE ≤ 95% of the baseline's. Otherwise the app keeps the baseline.
No individual figures, rankings or punitive signals exist. Estimates never reorder rooms and are labelled estimates.
Mobile: `lib/housekeeping/estimateTable.ts` (per-person/hotel cache, ignored after 7 days, refreshed ≤ every 6 h) and one
resolver `resolveEstimate` used by Home, My Rooms, Room Detail, Why-this-room, the timer and the briefing.
**Accuracy has not been measured on real data** (no production data was used); the tests prove the gate's behaviour on
synthetic histories only. Pause/interruption is not modelled: sessions have no pause state, so wall-clock time includes
breaks, and the cap/overlap/blocker filters are the only defence.

## 12. Language and voice

English/Spanish UI; speech locale follows the app language unless changed in Profile → AI & voice; transcripts are editable
and only enter the message on "Use text"; no audio is recorded or sent. Native recognition needs a development build, not
Expo Go.

## 13. Feature controls

Existing fail-closed tenant flags (`core/feature_flags.py`, mirrored in `apps/web/lib/featureRegistry.ts`), default OFF:
`hk_ai_assistant` (UI-only: off → housekeepers keep the corner copilot card), `hk_ai_photo_analysis` and
`hk_ai_task_translation` (server-enforced 403). The phone reads `GET /v1/ai/capabilities`; unknown = off, so no dead
buttons. Flags are not an entitlement: the credit cap still applies.
**Operator procedure:** enable or disable per hotel with the **Feature Rollout** workflow (`docs/FEATURE_FLAGS.md`,
`enabled: false` is the kill switch; effective within ~15 s server-side and on the phone's next refresh, ≤10 min).
Other optional AI paths (task parsing, SOP answers, briefing, recap) pre-date the flags; they are bounded by role, the
credit cap and, in an emergency, removing the provider key (every path then degrades to its local fallback).
**After merge nothing is visible until an operator enables the flags for a hotel.**

## 14. Testing

```bash
cd apps/api && pytest tests/ --ignore=tests/integration     # needs dummy env vars as in .github/workflows/ci.yml
cd apps/mobile && npx jest && npx tsc --noEmit && npx eslint .
node scripts/check-feature-flag-registry.mjs && node scripts/check-migrations.mjs
```
Mobile jest is not in CI. Run it from a real install: `cd apps/mobile && npm ci` (a junction to another checkout's
`node_modules` can lack `expo-local-authentication`, which fails the biometrics, SecuritySettings and useMyRoomsData suites).
With a clean install all 179 suites pass; `npx expo export --platform android|ios` needs dummy `EXPO_PUBLIC_*` values.

## 15. Device-only limitations (not verified by automation)

Native speech recognition and permission prompts, camera/gallery pickers, bottom-sheet drag-to-dismiss, keyboard behaviour
on iOS/Android, VoiceOver/TalkBack order, dynamic text scaling, real PDF open from a signed URL, live provider output.
Features needing a **development build** (not Expo Go): speech recognition, biometrics.

## 16. Troubleshooting

| Symptom | Check |
|---|---|
| No floating assistant | `hk_ai_assistant` off for the hotel, or role is not housekeeper/supervisor; `/ai/capabilities` |
| "AI help is used up" | hotel at cap: `GET /billing/credits`, `GET /ai/usage` (credit_limit rejections) |
| Photo/translate button missing | its flag is off, or offline |
| Estimates unchanged | not enough clean history, or learned figure did not beat the baseline on the hold-out |
| 503 from AI routes | provider keys / outage; manual flows are unaffected |
| SOP answer says no approved source | no approved, indexed document matches; check SOP status/indexing, and that the upload has an approved controlled-document record |

## 17. Manual verification checklist (device)

1. Sign in as a housekeeper in a hotel with the flags on: floating button above the tab bar, no overlap with sticky actions.
2. Ask a room question from Room Detail; returns to the room; no other room's data appears.
3. Create two tasks from one sentence (text, then voice in EN and ES); review, edit, confirm; both exist once; airplane mode blocks
   confirm with a clear message.
4. Report an issue with a photo; analysis only after the disclosure; manual submit still works with analysis off.
5. Ask an SOP question; open the cited page; switch the app to Spanish; the original document is still reachable.
6. Exhaust a test hotel's cap: AI requests show the allowance message; checklist, mark clean and finish shift still work.
7. Sign out and in as another person: no conversation, procedure list, shift or room from the first person.
8. Turn each flag off for the hotel and confirm the control disappears within a refresh.
9. Large text (200%) and TalkBack/VoiceOver on the assistant, task review and recap sheets.
