# PatelRep — Remaining Work

Everything from Weeks 1–10 of the roadmap is complete.
The items below are what's left from Weeks 11–12.

---

## Week 11 Gaps

### 1. Email Delivery Integration
**What the spec says:** Daily summary PDF auto-emailed to GM at 6am.
**What's built:** `POST /internal/reports/daily-summary-email` exists but creates a logbook entry as a placeholder — no real email is sent.
**What's needed:**
- Sign up for Resend (resend.com) or SendGrid
- Add `RESEND_API_KEY` (or `SENDGRID_API_KEY`) to Railway env vars
- Replace the logbook-entry placeholder in `apps/api/routers/internal.py` → `daily_summary_email()` with a real HTTP call to the email API
- Build a simple HTML email template with: room status breakdown, tasks completed, open work orders, top risks
- The Railway cron job (`0 6 * * *`) is already registered — just needs the real send logic

### 2. Guest Profile View from Opera
**What the spec says:** Front Desk can view a read-only guest profile (VIP flag, preferences) pulled from Opera.
**What's built:** VIP flag and check-in time show on room cards. No dedicated guest profile page.
**What's needed:**
- Add `GET /reservations/{reservation_id}` endpoint in `apps/api/routers/` (or extend `integrations.py`) that returns Opera reservation data from the `opera_reservations` table
- Build a simple read-only drawer or modal on the web front desk view showing: guest name, VIP flag, check-in/out dates, room number, special preferences

---

## Week 12 Gaps

### 3. Drag-and-Drop Room Assignment (Web)
**What the spec says:** Supervisor can drag a room card onto a housekeeper in the assignment sidebar.
**What's built:** Assignment sidebar works via click/select — no drag-and-drop.
**What's needed:**
- Install `@dnd-kit/core` and `@dnd-kit/sortable` (already common in Next.js projects)
- Make room cards in `components/housekeeping/RoomStatusBoard.tsx` draggable
- Make housekeeper rows in `components/housekeeping/AssignmentSidebar.tsx` droppable
- On drop: call the existing `assignRoom()` mutation

### 4. Mobile Inspection Screen
**What the spec says:** Mobile app has a full inspection checklist screen.
**What's built:** Web inspection modal (`components/housekeeping/InspectionModal.tsx`) is complete. Mobile has no inspection screen.
**What's needed:**
- Create `apps/mobile/app/(app)/inspection/[roomId].tsx`
- Fetch inspection template from `GET /housekeeping/inspections/templates`
- Render checklist items with pass/fail/na toggle buttons (NativeWind styled)
- Submit via `POST /housekeeping/inspections`
- On success: navigate back to room detail, show toast
- Add "Inspect" button on the mobile room detail screen (`apps/mobile/app/(app)/my-rooms/[roomId].tsx`) — supervisor-only, CLEAN rooms only

### 5. Maintenance Cost & Asset Report (PDF)
**What the spec says:** Maintenance cost and asset report exportable as PDF.
**What's built:** `GET /reports/maintenance` returns JSON with full breakdown. No PDF.
**What's needed:**
- Install `reportlab` or `weasyprint` in `apps/api/requirements.txt`
- Add `format=pdf` query param to `GET /reports/maintenance` in `apps/api/routers/reports.py`
- Generate a simple PDF: KPI summary table, by-category chart, by-priority breakdown, SLA compliance
- Return as `StreamingResponse` with `Content-Disposition: attachment; filename=maintenance-report-{date}.pdf`
- Add "Export PDF" button to `apps/web/app/(dashboard)/reports/page.tsx` on the Maintenance tab

### 6. Mobile UI Polish Pass
**What the spec says:** Full UI polish pass — spacing, colors, edge cases.
**What's needed (go through each mobile screen):**
- `(app)/my-rooms/index.tsx` — empty state when no rooms assigned, pull-to-refresh
- `(app)/my-rooms/[roomId].tsx` — loading skeleton, error state
- `(app)/work-orders/index.tsx` — empty state per tab, filter chips
- `(app)/work-orders/[woId].tsx` — photo upload progress indicator
- `(app)/tasks/index.tsx` — swipe-to-complete gesture
- `(app)/copilot/index.tsx` — keyboard avoiding view, message scroll-to-bottom
- `(app)/logbook/index.tsx` — infinite scroll pagination
- `(app)/notifications/index.tsx` — mark-all-read button, swipe-to-dismiss
- Global: consistent bottom tab bar safe area insets, haptic feedback on actions

### 7. Tablet-Responsive Web Layout
**What the spec says:** Responsive layout for tablet screens.
**What's needed:**
- Sidebar: on tablets (768–1024px) collapse to icon-only mode (`w-14` instead of `w-56`)
- Room board: adjust grid columns — 3 cols on tablet, 4 on desktop
- Drawers: on tablet, render as side panel instead of overlay
- Main areas to check: `housekeeping/page.tsx`, `engineering/page.tsx`, `scheduling/page.tsx`

### 8. Expo EAS Production Builds
**What's needed:**
```bash
cd apps/mobile

# Android production build (Google Play)
eas build --platform android --profile production

# iOS production build (App Store)
eas build --platform ios --profile production
```
- Requires `eas.json` production profile with correct bundle IDs
- Android: needs Google Play Developer account ($25 one-time)
- iOS: needs Apple Developer account ($99/year)
- Set all EAS secrets first (see LAUNCH_GUIDE.md Phase 8)

### 9. TestFlight Submission (iOS)
**What's needed:**
```bash
eas submit --platform ios --latest
```
- Requires App Store Connect app record created (bundle ID: `com.patelrep.app`)
- Requires at least one TestFlight beta tester group set up
- Apple review for TestFlight takes 1–2 days

### 10. Play Store Internal Testing (Android)
**What's needed:**
```bash
eas submit --platform android --latest
```
- Requires Google Play Console app record created
- Set up Internal Testing track, add pilot hotel staff as testers
- Android internal testing goes live immediately (no review)

### 11. App Store & Play Store Public Submission
**What's needed:**
- App Store: screenshots (6.7", 6.1", iPad), app description, privacy policy URL, support URL
- Play Store: feature graphic (1024×500), screenshots, app description, privacy policy
- Both stores: content rating questionnaire
- App Store review typically takes 1–3 days
- Play Store review typically takes 1–7 days for first submission

---

## Priority Order for Pilot Launch

**Do before pilot hotel goes live:**
1. Email delivery (guests and GMs need password resets to work reliably via email)
2. EAS builds (pilot staff need the mobile app)
3. TestFlight / Play Store internal testing (distribute to pilot staff)
4. Mobile UI polish pass (first impressions matter)
5. Mobile inspection screen (supervisors need this on mobile)

**Can do after pilot starts:**
6. Drag-and-drop assignment (click-based works fine)
7. Guest profile view from Opera (nice-to-have for front desk)
8. Tablet-responsive layout (most users will be on desktop or phone)
9. PDF reports (CSV works for now)
10. Public App Store / Play Store submission (internal testing is enough for pilot)
