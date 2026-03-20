# Feature Research

**Domain:** Hotel staff mobile app — housekeeping and engineering roles
**Researched:** 2026-03-20
**Confidence:** HIGH (competitor analysis + existing scaffolding verified)

---

## Context

This research covers a **React Native (Expo SDK 51)** mobile app for the PatelRep hotel operations SaaS. The target users are housekeepers (6 per pilot hotel) and engineers (2 per pilot hotel) at ~80-room independent Texas hotels. The web dashboard already handles supervisor/GM workflows. The mobile app fills exactly one gap: **field staff need a fast, reliable tool they can use in their hands, on the floor, without training.**

Competitors analyzed: Quore Cleanings Plus, HotSOS Mobile (Amadeus), Alice/Actabl Staff App, HelloShift, SabeeApp, Snapfix, hotelkit.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or unacceptable to pilot hotel.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Assigned room list (housekeeper-scoped) | Every competing app shows only the housekeeper's rooms, not all hotel rooms — full list is noise and a confidentiality concern | LOW | API endpoint `/housekeeping/my-rooms` already exists; stub screen exists, needs real data wiring |
| Room status update: DIRTY → IN_PROGRESS → CLEAN | This is the core workflow — Quore, Alice, SabeeApp, and every competitor center on this single action | MEDIUM | Must be < 3 taps; detail drawer or inline action button; must optimistically update, queue offline |
| Offline banner + cached data on connectivity loss | Hotel floors and back-of-house areas routinely have no Wi-Fi; app that shows spinner and fails loses trust immediately | LOW | Offline banner already scaffolded in `my-rooms/index.tsx`; SQLite + sync queue scaffolded |
| Offline status update with sync on reconnect | Staff can't pause their work to wait for Wi-Fi; updates must queue locally and flush when reconnected | HIGH | Outbox pattern: write to SQLite immediately, sync queue flushes on reconnect; this is the highest-complexity table-stakes item |
| Push notification: room assigned to housekeeper | Quore Cleanings Plus delivers push on breakout assignment; Alice sends push on ticket assignment; this replaces radio chatter | MEDIUM | Expo Push token registration must be wired to backend on login; notification routing by role |
| Work order list for engineers (open + claimed + done tabs) | HotSOS, Alice, and every maintenance app show this 3-tab pattern; engineers expect to see what's unassigned vs claimed | LOW | Tab structure already scaffolded in `work-orders/index.tsx`; needs real API wiring |
| Claim work order (OPEN → IN_PROGRESS) | One-tap claim is standard in HotSOS and Alice; engineers scan the open queue and self-assign | LOW | `claimWorkOrder()` already stubbed in `work-orders/index.tsx`; needs error state and offline support |
| Update work order status (IN_PROGRESS → DONE) | Terminal action on a work order; standard in every hotel maintenance tool | LOW | Detail screen stub exists; needs status transition buttons |
| Add resolution note to work order | HotSOS and Alice require engineers to document what was done; supervisors need this for audit trails | LOW | Text input on detail screen; saves with status update |
| Push notification: work order assigned to engineer | Alice sends push on ticket assignment; eliminates radio dispatch for non-emergency WOs | MEDIUM | Same token infra as housekeeper push; routing by role |
| Report issue from room (housekeeper creates WO) | Every competing app (Quore, HelloShift, SabeeApp, hotelkit) allows housekeepers to create maintenance requests while cleaning a room | MEDIUM | Launches simple form from room detail: title, description, priority; creates work order via API |
| DND flag visible on room card | Quore surfaces "Do Not Disturb" flags on room cards; prevents housekeeper from disturbing a guest | LOW | Already scaffolded on room card (`dnd_flag` field) — needs to be visually prominent |
| Login: magic link + password, end-to-end on device | Auth is table stakes; magic link is non-negotiable for non-technical staff who can't remember passwords | MEDIUM | Login screen exists; auth callback needs deep-link handling on device |
| Profile screen: name, role, hotel | Staff need to verify they're logged into the right hotel; essential for shared devices | LOW | Profile screen exists as stub |
| Offline indicator (persistent, not just toast) | Hotel staff learn not to trust a tool that silently fails; persistent offline banner builds trust | LOW | Banner exists in `my-rooms/index.tsx`; needs to be consistent across all screens |

### Differentiators (Competitive Advantage)

Features that set PatelRep apart. Not required for pilot launch, but create "wow" moments and justify the $99/mo.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Risk badge on room card (HIGH risk surfaced visually) | Quore and Alice don't surface AI-predicted late rooms on mobile; housekeepers learn to prioritize visually | LOW | `risk_level` already on room card scaffold; predictions already generated by backend; just needs render |
| ETA displayed on room card | No competitor shows predicted clean completion time to the housekeeper; reduces supervisor micromanagement | LOW | `eta` field from prediction payload; render as "Est. done by 2:30 PM" on card |
| Spanish-first UX (EN/ES toggle, persistent) | Most hotel housekeepers in Texas are Spanish-speaking; Quore has minimal i18n; this is a real differentiator for independent TX hotels | MEDIUM | i18n scaffolded; needs translation coverage for all new strings added |
| Photo attachment on work order / issue report | Snapfix built its brand on "photo-first maintenance"; HelloShift and hotelkit support photos; reduces back-and-forth on ambiguous issues | MEDIUM | Expo ImagePicker; attach to issue report or WO note; upload to Supabase Storage; v1.x candidate |
| Sync badge showing last-synced timestamp | Housekeepers in spotty-wifi hotels want confidence their data saved; web board has this; mobile needs it | LOW | Show "Synced 2 min ago" or "Pending 3 changes" in header or footer |

### Anti-Features (Deliberately NOT Building in v1)

Features that seem obvious but would bloat scope, reduce reliability, or require infrastructure not yet in place.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Inspection workflow on mobile | "Housekeepers could inspect rooms too" | Inspections require photo capture, checklist rendering, pass/fail logic, and supervisor sign-off — this is a full sub-app; web-only for pilot reduces surface area and testing burden | Supervisor does inspections on web dashboard; mobile gets "Request Inspection" button at most |
| AI Copilot chat on mobile | "Staff could ask the AI questions" | GPT-4o-mini + Claude Sonnet calls require active network, add latency, and staff on the floor don't have mental bandwidth for chat; stub screen stays in nav but is clearly deferred | SOP search stays on web; AI surfaces passively as risk badges and ETAs on cards |
| Scheduling / shift management on mobile | "Staff want to see their schedule" | Shift data is read-only for staff; adding it to mobile before the sync story is solid creates a stale-data confidence problem; web dashboard handles this | "My Shifts" as a future v1.x read-only screen after core sync is solid |
| Supervisor room assignment on mobile | "Supervisors are on the floor too" | Assignment requires drag-and-drop logic, complex state, and conflicts with the housekeeper-scoped view; the web board is purpose-built for this | Supervisors use the web board on a tablet or phone browser; mobile app is staff-only in v1 |
| Real-time room board (Supabase Realtime) on mobile | "Updates should be live" | Persistent WebSocket on a mobile device drains battery and fails on spotty Wi-Fi; pull-to-refresh on demand is more reliable and predictable in hotel environments | Pull-to-refresh (already scaffolded) + push notification for high-priority events only |
| Minibar / linen consumption logging | "Reduces lost charges" | Requires inventory database, room service integration, and folio write-back to PMS (Opera); out of scope for pilot backend | Log as a note on work order if needed; full minibar feature is v2+ |
| Lost & found on mobile | "Housekeepers find items" | Requires photo, item categorization, guest matching, front-desk notification chain; full sub-feature; Quore made it a separate app module | Create a generic "notes" or issue report as workaround; full lost & found is v2+ |
| Biometric login (FaceID / fingerprint) | "Faster login for staff" | Expo LocalAuthentication works but adds complexity; shared-device scenarios (one phone per floor) make biometrics unreliable | Password + magic link covers pilot; biometric is a polish item post-pilot |

---

## Feature Dependencies

```
Push Notification: Room Assigned
    └──requires──> Expo Push Token Registration (on login)
                       └──requires──> Backend push_tokens table + upsert endpoint

Push Notification: WO Assigned
    └──requires──> same Expo Push Token Registration

Offline Status Update (sync on reconnect)
    └──requires──> SQLite rooms table (upsertRooms exists)
    └──requires──> Sync queue outbox pattern (sync.ts scaffolded, needs room status mutations)

Report Issue from Room
    └──requires──> Room Detail screen (stub exists)
    └──requires──> Work Orders POST API endpoint

ETA on Room Card
    └──requires──> Predictions API returning eta field (already live on backend)
    └──enhances──> Risk badge (both come from same prediction payload)

Spanish UX
    └──requires──> i18n coverage for all new screen strings (i18n scaffolded)

Photo on WO / Issue Report
    └──requires──> Supabase Storage bucket for attachments
    └──requires──> WO attachment endpoint on API (not yet built)
    └──conflicts──> v1 timeline (defer to v1.x)
```

### Dependency Notes

- **Push token registration requires backend table:** The `push_tokens` table needs a upsert endpoint; token must be re-registered on every login in case it rotated. Expo documentation confirms tokens can change — always re-upsert on app foreground.
- **Offline status update requires outbox pattern:** Writing to SQLite first and syncing later means the sync queue in `lib/offline/sync.ts` must handle room status mutations specifically — the existing scaffold is the right foundation.
- **Report Issue requires WO creation endpoint:** The FastAPI `/work-orders` POST endpoint already exists (from Session 8 per MEMORY.md); mobile just needs to call it with room context pre-filled.
- **ETA and risk badge come from the same API call:** `/housekeeping/my-rooms` can return `risk_level` and `eta` from the predictions table — no extra API call needed; the room card scaffold already renders `risk_level`.

---

## MVP Definition

### Launch With (v1) — Pilot Gate

These are required before the pilot hotel goes live. Missing any of these = pilot failure.

- [ ] Housekeeper room list, scoped to assigned rooms, with cached offline fallback — *without this, app has no value*
- [ ] DIRTY → IN_PROGRESS → CLEAN status update, optimistic + offline-queued — *core workflow*
- [ ] Offline status updates queue and flush on reconnect — *hotel Wi-Fi is spotty; silent failure destroys trust*
- [ ] Push notification when room is assigned — *replaces radio chatter, key value prop*
- [ ] Report issue from room (creates work order) — *housekeepers need this every shift*
- [ ] Engineer work order list (open / in_progress / done) with real API data — *engineers need this daily*
- [ ] Claim work order (OPEN → IN_PROGRESS, one tap) — *engineers self-assign*
- [ ] Update WO to DONE with resolution note — *audit trail, supervisor visibility*
- [ ] Push notification when WO assigned to engineer — *replaces radio dispatch*
- [ ] Login end-to-end on device (magic link deep link + password) — *prerequisite for everything*
- [ ] DND flag prominently visible on room card — *prevents guest complaints*
- [ ] Offline banner on all screens — *builds staff trust*
- [ ] EN/ES language toggle (persistent) — *Texas pilot hotel staff*

### Add After Validation (v1.x)

Add these once the pilot hotel confirms core workflows are working.

- [ ] Photo attachment on issue reports / WO notes — *trigger: pilot hotel reports photos would reduce back-and-forth*
- [ ] ETA and risk badge rendering on room card — *trigger: predictions are live, just need UI hookup; low effort*
- [ ] Sync badge showing last-synced time — *trigger: pilot staff ask "did my update save?"*
- [ ] "My Shifts" read-only screen — *trigger: staff start asking about schedule from mobile*

### Future Consideration (v2+)

Defer until post-pilot product-market fit.

- [ ] Inspection workflow on mobile — *full sub-app; supervisors use web for pilot*
- [ ] AI Copilot chat — *stub screen stays; feature requires network reliability and UX design*
- [ ] Minibar / linen consumption logging — *requires inventory + PMS folio write-back*
- [ ] Lost & found module — *full sub-feature with photo, categorization, guest matching*
- [ ] Biometric login — *polish, post-pilot*
- [ ] Supervisor assignment on mobile — *conflicts with staff-scoped view design*

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Housekeeper room list (real data + offline) | HIGH | LOW | P1 |
| Room status update (optimistic + queued) | HIGH | MEDIUM | P1 |
| Offline queue + sync on reconnect | HIGH | HIGH | P1 |
| Push: room assigned | HIGH | MEDIUM | P1 |
| Report issue from room | HIGH | MEDIUM | P1 |
| Engineer WO list (real data) | HIGH | LOW | P1 |
| Claim WO (one tap) | HIGH | LOW | P1 |
| Update WO to DONE + note | HIGH | LOW | P1 |
| Push: WO assigned | HIGH | MEDIUM | P1 |
| Login end-to-end on device | HIGH | MEDIUM | P1 |
| DND flag on room card | MEDIUM | LOW | P1 |
| Offline banner (all screens) | MEDIUM | LOW | P1 |
| EN/ES language toggle | MEDIUM | LOW | P1 |
| ETA + risk badge on room card | MEDIUM | LOW | P2 |
| Photo on WO / issue | MEDIUM | MEDIUM | P2 |
| Sync badge | LOW | LOW | P2 |
| Inspection on mobile | LOW | HIGH | P3 |
| AI Copilot mobile chat | LOW | HIGH | P3 |
| Minibar / linen logging | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for pilot launch
- P2: Add post-pilot validation
- P3: Future consideration

---

## Competitor Feature Analysis

| Feature | Quore Cleanings Plus | HotSOS Mobile | Alice/Actabl | PatelRep v1 Approach |
|---------|---------------------|---------------|--------------|----------------------|
| Room status update | Yes, mobile card-based UI | Not primary focus | Yes | Yes — one-tap from detail screen |
| Push on assignment | Yes — "breakout push" to housekeeper | Yes — role-based service order alerts | Yes — push on unassigned and assigned tickets | Yes — Expo Push, both roles |
| Offline support | Not documented | Not documented | Not documented | Yes — SQLite + outbox sync queue (explicit requirement) |
| Issue report from room | Yes — centralized room issues view | Service order creation | Yes — ticket creation | Yes — report issue button on room detail |
| Engineer WO workflow | Via Work Orders module | Primary use case | Yes — ticket pipeline | Yes — open/in_progress/done tabs |
| WO claim / self-assign | Not explicit | Yes — staff pick up service orders | Yes | Yes — one-tap Claim button |
| Photo on issues | Not documented | Not documented | Yes | v1.x — deferred |
| EN/ES i18n | Minimal | Not documented | Not documented | Yes — key differentiator |
| AI predictions on mobile | No | No | No | Yes (ETAs, risk) — v1.x |
| Inspection on mobile | Yes — Cleanings Plus 3-type inspection | Yes | Yes | No — web-only for pilot |
| Minibar logging | Yes — dedicated feature | No | No | No — v2+ |

---

## Mobile-Specific UX Patterns

These patterns are validated across competitors and mobile UX research for field staff apps:

**Room card design (housekeeper):**
- Left colored status bar (6px) — color-coded at a glance; used by Quore and SabeeApp
- Room number prominent (18–20px bold) — must be readable in hallway lighting
- Status badge with background tint — not just color; accessible for colorblind staff
- DND flag iconographic (moon icon) — not just text, scannable
- Guest name visible — housekeeper needs checkout context
- Risk badge only when HIGH — avoid badge fatigue; normal rooms show nothing

**Status update UX:**
- Full-width action button at bottom of detail screen — thumb-reachable zone
- Color matches target status (green for CLEAN, amber for IN_PROGRESS)
- Optimistic update: card changes color immediately, syncs in background
- "Saved offline" micro-toast if no network at time of update
- Confirmation for irreversible transitions only (e.g., CLEAN is a significant state change)

**Work order claim UX:**
- Claim button inline on list card for open WOs — avoid extra tap to detail screen for common action
- After claim: card moves to In Progress tab immediately (optimistic)
- Detail screen shows assignee name and claimed timestamp once claimed

**Push notification content:**
- Room assigned: "Room 214 assigned to you — DIRTY, checkout 11 AM" (actionable, deep links to room)
- WO assigned: "Work Order #47 — Leaking faucet, Room 318, URGENT" (actionable, deep links to WO)
- Never batch — one notification per event for staff tools (urgency matters)
- iOS: badge count on app icon for unread assignments
- Notification tap → deep link to exact room or WO (not just app home)

**Offline patterns:**
- Never block UI on network call — write locally first, sync second
- Outbox table in SQLite: `{ id, entity_type, entity_id, payload, created_at, synced_at }`
- Sync on: app foreground, reconnect event (`NetInfo`), pull-to-refresh
- Conflict resolution: server wins (last-write-wins with server timestamp); no merge complexity for v1
- Do not auto-retry faster than 10s to avoid hammering the API on spotty connections

---

## Sources

- [Quore Cleanings Plus features](https://www.quore.com/product-premium/cleanings-plus) — official
- [Quore housekeeping mobile UX](https://www.quore.com/how-to/ways-quore-supports-housekeepers) — official
- [HotSOS Mobile — Amadeus](https://www.amadeus-hospitality.com/service-optimization-software/hotsos/) — official
- [HotSOS on Hotel Tech Report](https://hoteltechreport.com/operations/collaboration-tools/hotsos-by-amadeus) — MEDIUM confidence (review aggregator)
- [Alice Staff App (App Store)](https://apps.apple.com/us/app/alice-staff/id971004611) — official
- [ALICE Housekeeping by Actabl](https://hoteltechreport.com/operations/housekeeping-software/alice-housekeeping) — MEDIUM confidence
- [HelloShift housekeeping](https://www.helloshift.com/housekeeping-management) — competitor product page
- [Xenia: Best hotel housekeeping apps 2025](https://www.xenia.team/articles/free-hotel-housekeeping-app) — MEDIUM confidence (aggregator)
- [Expo offline-first guide](https://docs.expo.dev/guides/local-first/) — HIGH confidence (official)
- [Expo push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) — HIGH confidence (official)
- [Altexsoft: Housekeeping software features](https://www.altexsoft.com/blog/housekeeping-management-software/) — MEDIUM confidence

---
*Feature research for: Hotel staff mobile app (housekeeping + engineering roles)*
*Researched: 2026-03-20*
