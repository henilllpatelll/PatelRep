# UI/UX Fixes Backlog — PatelRep

**Audit date:** 2026-05-23  
**Method:** Playwright visual crawl — 21 routes, desktop (1366×900) + mobile (390×844)  
**Screenshots:** `test-results/ui-audit/`  
**Coverage:** 20 authenticated routes + login, with 9 interaction states (modals, drawers, filters)

---

## CRITICAL — Layout Breaks & Blocked Interactions

### C-01 · Dashboard stat cards never resolve from skeleton (desktop)
**Route:** `/dashboard`  
**Screenshot:** `desktop-dashboard.png`  
**Pillar:** Layout & Alignment

The three top stat cards, the four quick-stat cards below, and the two section panels at the bottom all remain as gray skeleton placeholders on desktop even after 3+ seconds. The mobile dashboard loads the same data instantly. This means desktop users open their GM dashboard and see nothing actionable.

**Root cause:** The 2.5s screenshot wait is a symptom, not the cause. React Query on desktop is likely hitting a race condition where Supabase auth headers aren't attached in time on the first hydration cycle, causing silent fetch failures with the skeleton never flipping to content.

**Fix:**
- In each dashboard data hook, add an `onError` handler that at minimum logs and breaks out of skeleton state to an error card.
- Ensure `useAuth` auth token is resolved before React Query fires the first dashboard requests — gate with `enabled: !!user?.hotel_id`.
- Add a hard `staleTime: 0` + `retry: 1` so failed desktop requests auto-retry once.

---

### C-02 · Work Orders shows blank skeletons instead of empty state (desktop + mobile)
**Route:** `/engineering`  
**Screenshot:** `desktop-engineering.png`, `mobile-engineering.png`  
**Pillar:** Layout & Alignment, Clutter & Flow

Three tall blank white rectangles fill the main content area. There is no "No work orders" message, no CTA, nothing. Users cannot tell if the page is loading, broken, or genuinely empty. The "Asset Failure Risks" sidebar renders correctly beside it, which makes the blank left area look more broken.

**Fix:**
- Replace the skeleton cards with a proper empty state: icon + "No open work orders" + "+ Create Work Order" button.
- Only show skeleton cards while `isLoading === true`. When `data?.length === 0`, show empty state immediately.

---

### C-03 · Scheduling weekly grid permanently stuck in skeleton (desktop)
**Route:** `/scheduling`  
**Screenshot:** `desktop-scheduling.png`  
**Pillar:** Layout & Alignment

The 4-row × 8-column weekly staff schedule grid renders as gray placeholder cells and never resolves. Mobile shows per-day "No shifts assigned" rows instead, which works. The grid skeleton on desktop persists across navigation, suggesting the schedule data call is failing silently.

**Fix:**
- Same pattern as C-01/C-02: gate skeleton on `isLoading`, swap to empty state on `data?.length === 0`.
- Add error boundary around the weekly grid so a failed schedule fetch doesn't leave the grid in limbo.

---

### C-04 · Inspection History displays raw UUID fragment as inspector name
**Route:** `/housekeeping/inspections`  
**Screenshot:** `desktop-housekeeping-inspections.png`, `mobile-housekeeping-inspections.png`  
**Pillar:** Typography & Hierarchy

The INSPECTOR column shows `42d49284` — a truncated UUID — for both inspection rows. Supervisors reviewing inspections have no idea who performed the inspection. This turns a people workflow into raw database output.

**Fix:**
- In the inspection list query, join to `profiles` or `staff` table on `inspector_id → id` and return `full_name`.
- Fallback chain: `full_name` → `email` → first 8 chars of UUID with a tooltip.
- The mobile card view has the same issue under the INSPECTOR label.

---

### C-05 · Housekeeping Board filter chips overflow and clip on mobile
**Route:** `/housekeeping`  
**Screenshot:** `mobile-housekeeping.png`  
**Pillar:** Layout & Alignment

The status filter chip row truncates at 390px — "To Insp..." is clipped off the right edge and "Ready 12", "OOO 0", and "At Risk 0" are completely invisible. Users cannot filter to the statuses they care about most.

**Fix:**
- Wrap the filter row in `overflow-x-auto` with `flex-nowrap` and add `-webkit-overflow-scrolling: touch`.
- Or collapse to a 2-row wrap: row 1 = All/Dirty/In Progress, row 2 = To Inspect/Ready/At Risk.
- Reduce chip padding on mobile from `px-3` to `px-2` to fit more per row.

---

### C-06 · "Assign Staff" button wraps to two lines on mobile
**Route:** `/scheduling`  
**Screenshot:** `mobile-scheduling.png`  
**Pillar:** Layout & Alignment

The top-right CTA "Assign Staff" breaks to "Assign\nStaff" at 390px because the page heading + subtitle + button all fight for the same row. The button is still tappable but looks broken.

**Fix:**
- Add `whitespace-nowrap` to the button.
- Move the CTA below the heading on `sm:` breakpoint using a flex column layout, or abbreviate to "+ Assign" on mobile.

---

### C-07 · AI Copilot floating button overlaps table actions (all routes)
**Route:** All routes  
**Screenshot:** `desktop-housekeeping-rooms.png` (visible overlap at bottom row)  
**Pillar:** Clutter & Flow

The fixed orange AI bubble (bottom-right) overlaps the last visible row's Edit/action button across table-heavy pages. On `/housekeeping/rooms`, the final table row's Edit button is covered. On `/settings`, the Discard/Save bar conflicts. On mobile `/ai`, the bubble competes with the chat input itself.

**Fix:**
- Add `pb-20` (or `pb-safe`) to all scrollable content containers so the last row never sits behind the bubble.
- On `/ai` specifically, hide the floating bubble — the user is already on the AI page.
- On mobile, consider moving it to the bottom nav bar rather than a floating overlay.

---

## MODERATE — Visual Inconsistencies & Spacing Issues

### M-01 · Action button colors are inconsistent across the app
**Routes:** `/tasks`, `/guest-requests`, `/lost-found`, `/housekeeping/rooms` (drawer)  
**Screenshots:** `desktop-tasks.png`, `desktop-guest-requests.png`, `desktop-lost-found.png`, `state-housekeeping-rooms-modal.png`  
**Pillar:** Component Consistency

The same action concept — "do the primary thing on this item" — uses four different colors:
- Tasks: "Start" = **blue**, "Complete" = **green**
- Guest Requests: "Start" = **purple**
- Lost & Found: "Mark Claimed" = **green**, "Donate" = **purple**
- Room drawer: "Mark Dirty" = red/pink outline

The brand color is amber/yellow. These colors were likely chosen semantically (green = done, red = dirty) but they create a visual system that looks unplanned.

**Fix — adopt a 3-color semantic system:**
| Intent | Color | Usage |
|--------|-------|-------|
| Primary action | Amber filled | Start, Assign, Save |
| Completed / success | Green filled | Mark Claimed, Complete |
| Destructive / escalate | Red outlined | Deactivate, Mark Dirty, Escalate |
| Secondary | Gray outlined | Cancel, Discard, Donate |

Standardize all "Start" buttons to amber. Keep green for "Complete/Claimed" and red for "Dirty/Escalate".

---

### M-02 · Native `<select>` elements break visual consistency
**Routes:** `/tasks`, `/settings`, `/scheduling` (new task modal, timezone, role dropdown)  
**Screenshots:** `desktop-tasks.png`, `desktop-settings.png`, `state-tasks-modal.png`, `state-staff-modal.png`  
**Pillar:** Component Consistency

Browser-default `<select>` elements appear on the Tasks filter bar (All Types, All Priorities), the Settings timezone picker, and the Add Staff/New Task modals (Role, Type, Priority). They have a different border radius, background, and chevron icon from every other interactive element in the app.

**Fix:**
- Wrap with the existing `<Select>` from shadcn/ui that's already used elsewhere.
- Apply `className="w-full"` + match the input border `border-stone-200 rounded-lg` to align with text inputs.

---

### M-03 · Test/validation data is visible in production
**Routes:** `/tasks`, `/lost-found`, `/staff`  
**Screenshots:** `desktop-tasks.png`, `desktop-lost-found.png`, `desktop-staff.png`  
**Pillar:** Clutter & Flow

Three categories of test pollution are visible to any logged-in user:
1. **Tasks:** "Test task from e2e audit" and "prodval-20260512185853 extra towels" are open tasks.
2. **Lost & Found:** "prodval-20260512185853 validation umbrella" is a logged item.
3. **Staff:** 28+ "AutoTest 1778..." engineer accounts fill the staff list. The real user "Miguel" is buried.

**Fix (data):**
- Delete all `AutoTest *` staff accounts and `prodval-*` tasks/items from production.
- Add a post-test teardown step to `e2e/auth.setup.ts` (or a dedicated teardown spec) that deletes any record created with a `prodval-` prefix or `AutoTest` name.

**Fix (guard):**
- In e2e auth setup, assert `process.env.PLAYWRIGHT_BASE_URL !== 'https://patelrepweb-production.up.railway.app'` before creating test data, or use a flag column (`is_test_record`) and filter it out in production queries.

---

### M-04 · Guest request cards use ~45% column width on desktop
**Route:** `/guest-requests`  
**Screenshot:** `desktop-guest-requests.png`  
**Pillar:** Spacing & Padding, Clutter & Flow

Guest request cards render in a single narrow column that occupies roughly half the content width, leaving a large empty cream area to the right. With only one card visible, the layout looks unfinished.

**Fix:**
- Remove the fixed `max-w-sm` or `w-1/2` constraint on the card container.
- Use a 2-column responsive grid: `grid grid-cols-1 md:grid-cols-2 gap-4` — same pattern as Lost & Found which correctly uses 2 columns.

---

### M-05 · Billing AI Credit Usage shows stale month ("April 2026")
**Route:** `/billing`  
**Screenshot:** `desktop-billing.png`  
**Pillar:** Typography & Hierarchy

The "AI Credit Usage — April 2026" header is frozen at last month. The current date is May 23, 2026.

**Fix:**
- Change the month display to use the current billing period start date from the API response, not a hardcoded or cached value.
- If the API returns `null` or a stale period, show "Current Period" instead of a specific month.

---

### M-06 · Billing progress bar color is dark navy instead of brand amber
**Route:** `/billing`  
**Screenshot:** `desktop-billing.png`  
**Pillar:** Component Consistency

The AI credit usage progress bar fills with a dark navy/indigo color. Every other accent in the app is amber/yellow. This bar looks like it belongs to a different product.

**Fix:**
- Add `[&>div]:bg-amber-400` to the `<Progress>` className, or set `indicatorClassName="bg-amber-400"` if using the shadcn Progress component.

---

### M-07 · "Today's AI Shift Summary" uses purple/lavender brand color
**Route:** `/logbook`  
**Screenshot:** `desktop-logbook.png`  
**Pillar:** Component Consistency

The logbook AI summary accordion has a purple-lavender background and icon color. All other AI features (AI Copilot page, dashboard AI Risk Alerts, task AI badges) use amber. This inconsistency makes AI features feel disjointed.

**Fix:**
- Change the accordion background from purple tint to `bg-amber-50` and the sparkle icon from purple to `text-amber-500`.
- Keep the `AI` badge in amber to match the housekeeping board and tasks.

---

### M-08 · SOP Library empty state CTA button is green
**Route:** `/sop`  
**Screenshot:** `desktop-sop.png`  
**Pillar:** Component Consistency

The "Upload your first SOP" button inside the empty state is styled green. The header "Upload SOP" button is amber. Same action, two different colors on the same screen.

**Fix:**
- Change the empty-state CTA: `className="bg-amber-400 hover:bg-amber-500 text-black"` to match the header button.

---

### M-09 · Sub-navigation items are 36px tall (below 44px minimum)
**Routes:** All routes with sub-nav (Housekeeping, Maintenance)  
**Screenshot:** `desktop-housekeeping.png`  
**Pillar:** Component Consistency

The sidebar sub-nav links (Room Board, Assignments, Inspection History, All Rooms, Work Orders, Assets, PM Schedules, Predictions) measure 190×36px. The WCAG touch target minimum is 44px. On mobile where the drawer nav is used with thumbs, these are too small.

**Fix:**
- Change sub-nav item height from `h-9` to `h-11` (44px) and add `py-1` to the inner padding.
- Keep the text size the same — only change the height/padding.

---

### M-10 · Reports page has excessive empty space below metrics
**Route:** `/reports`  
**Screenshot:** `desktop-reports.png`, `mobile-reports.png`  
**Pillar:** Spacing & Padding, Clutter & Flow

The Daily Summary tab shows: room status breakdown, then two large metric numbers, then 40% blank page. The Staff Performance, Maintenance, and AI Usage tabs exist but weren't loaded with data. The page is data-sparse.

**Fix:**
- Add a "Top Rooms by Clean Time" or "Housekeeping Efficiency" mini-chart below the metrics even if it's just a sorted list.
- Alternatively, stack all four report sections vertically on the Daily Summary tab instead of requiring tab switching for each.
- At minimum, show helpful guidance in the empty tabs: "Staff performance data is collected from completed tasks. Assign tasks and mark them complete to see data here."

---

### M-11 · "Assign Staff" schedule page shows date redundantly twice
**Route:** `/scheduling`  
**Screenshot:** `desktop-scheduling.png`  
**Pillar:** Clutter & Flow

"Week of May 18 – May 24, 2026" appears in both the week navigation bar (next to Prev/Next) AND as a large section heading inside the grid card. This uses vertical space and looks like a copy/paste artifact.

**Fix:**
- Remove the redundant `<h3>` inside the grid card. The navigation bar label is the authoritative date indicator.

---

### M-12 · Mobile Tasks tab bar clips the "Cancelled" tab
**Route:** `/tasks` (mobile)  
**Screenshot:** `mobile-tasks.png`  
**Pillar:** Layout & Alignment

At 390px, the tab bar shows All | Open | In Progress | Completed — the "Cancelled" tab is not visible. Users can't see or access cancelled tasks on mobile.

**Fix:**
- Add `overflow-x-auto` to the tab container with `flex-nowrap`.
- Or collapse to a compact dropdown on `sm:` screens: "Filter: All ▾" that reveals all status options.

---

## MINOR — Polish & Empty State Improvements

### P-01 · Housekeeping Board room cards have excessive vertical whitespace
**Route:** `/housekeeping`  
**Screenshot:** `desktop-housekeeping.png`  
**Pillar:** Spacing & Padding

Each room card shows: room number → status badge → large empty space → "Details" or "Reassign" link. The gap between the status badge and the link is disproportionate, making the card feel 40% taller than it needs to be.

**Fix:**
- Reduce card min-height. Add room type (e.g., "King Suite") or assigned housekeeper name in the empty middle zone.
- Change the card to use `justify-between` with the status at the top and the action link at the bottom with no forced gap.

---

### P-02 · "Details" and "Reassign" links in room cards are very low contrast
**Route:** `/housekeeping`  
**Screenshot:** `desktop-housekeeping.png`  
**Pillar:** Typography & Hierarchy

The action link text at the bottom of each room card is approximately `text-stone-400` — gray on a white background. It passes at large sizes but fails WCAG AA for small text links.

**Fix:**
- Change to `text-stone-600` (darker) or `text-amber-600` for a brand-consistent link color.
- Add an underline on hover to make it clearly tappable.

---

### P-03 · Mobile AI Copilot quick-action chips stack one-per-row
**Route:** `/ai` (mobile)  
**Screenshot:** `mobile-ai.png`  
**Pillar:** Spacing & Padding

"Show GM insights", "At-risk rooms today", and "Open work orders" are rendered as full-width stacked buttons. On desktop they appear as a horizontal chip row. The mobile stacked layout uses ~180px of vertical space for three chips that could fit in two rows of two.

**Fix:**
- Use `flex-wrap gap-2` on the chip container instead of `flex-col`.
- Chips will flow naturally to 2-per-row at 390px.

---

### P-04 · AI Copilot floating button conflicts with chat input on `/ai` mobile
**Route:** `/ai` (mobile)  
**Screenshot:** `mobile-ai.png`  
**Pillar:** Clutter & Flow

The orange AI bubble appears in the bottom-right even on the AI Copilot page itself. The chat input bar is also at the bottom. They compete for the same space and create visual clutter.

**Fix:**
- Add route-aware rendering: `pathname !== '/ai' && <AICopilotBubble />`.

---

### P-05 · Empty state pages lack actionable next steps
**Routes:** `/engineering/assets`, `/engineering/pm-schedules`, `/engineering/predictions`, `/logbook`  
**Screenshots:** `desktop-engineering-assets.png`, `desktop-engineering-pm-schedules.png`  
**Pillar:** Clutter & Flow

Empty states show an icon and a single line like "No assets found" but no guidance. A new hotel manager doesn't know what to do next.

**Fix — add one-sentence guidance + a relevant CTA to each:**
| Page | Guidance | CTA |
|------|----------|-----|
| Assets | "Add your hotel's equipment to track maintenance history." | + Add Asset |
| PM Schedules | "Create preventive maintenance schedules for your assets." | + Create Schedule |
| Predictions | "AI predictions generate automatically once assets are added." | View Assets |
| Logbook | "Record shift handoff notes so the next team is always informed." | + Add Entry |

---

### P-06 · Native date inputs on Reports and Inspections pages look off-brand
**Routes:** `/reports`, `/housekeeping/inspections`  
**Screenshots:** `desktop-reports.png`, `desktop-housekeeping-inspections.png`  
**Pillar:** Component Consistency

The browser-native `<input type="date">` renders with inconsistent styling across OS/browsers. On the Reports page the date field looks styled (has a border), but the calendar icon and spinner are browser-native and don't match the rest of the UI.

**Fix:**
- Wrap in a styled date picker component (shadcn `<Calendar>` + `<Popover>` pattern already used elsewhere).
- At minimum, add `className="border border-stone-200 rounded-lg px-3 py-2 text-sm"` to match text input styling.

---

### P-07 · Logbook "Today's AI Shift Summary" has no visible content on first load
**Route:** `/logbook`  
**Screenshot:** `desktop-logbook.png`  
**Pillar:** Clutter & Flow

The accordion shows the collapsed state. Users don't know if it contains a summary or if the AI hasn't run yet. There's no loading indicator and no hint of content until clicked.

**Fix:**
- Show a one-line preview: "Summary available — click to expand" when content exists, or "AI summary generates at shift end (7 AM, 3 PM, 11 PM)" when it hasn't run yet.

---

### P-08 · Room count discrepancy between Settings (114) and Housekeeping (117)
**Routes:** `/settings`, `/housekeeping`  
**Screenshots:** `desktop-settings.png`, `desktop-housekeeping.png`  
**Pillar:** Typography & Hierarchy

Settings shows "Room Count: 114" (from hotel profile) but the Housekeeping Board shows "117 rooms". The discrepancy is confusing — a GM setting a room count of 114 expects 114 rooms to appear in housekeeping.

**Fix:**
- Audit whether the room count in settings is the source of truth or just an informational field.
- If rooms are auto-counted from the `rooms` table, make the Settings field read-only with a note: "117 rooms imported via Import Rooms".
- If the field is editable and drives room management, reconcile the 3-room difference.

---

### P-09 · Staff list is populated with 28+ e2e AutoTest accounts in production
**Route:** `/staff`  
**Screenshot:** `desktop-staff.png`  
**Pillar:** Clutter & Flow

(See M-03 for the full fix). From a pure UX standpoint: the first impression of the Staff Management page for any new user is 28 fake accounts. The single real user "Miguel" is buried on row 5. This makes the page feel broken and erodes trust in the product.

**Immediate fix:** Delete all AutoTest accounts from the production Supabase `users`/`profiles` table directly.

---

### P-10 · Dashboard greeting uses hotel name, not manager name
**Route:** `/dashboard`  
**Screenshot:** `mobile-dashboard.png`  
**Pillar:** Clutter & Flow

"Good evening, Sonesta ES Suites Fossil Creek!" is the greeting. Using the hotel name instead of the user's name is impersonal and slightly odd for a logged-in product.

**Fix:**
- Change to "Good evening, Henil!" (or whatever the user's first name is from the auth profile).
- Show hotel name as subtitle: "Sonesta ES Suites Fossil Creek · GM".

---

## Summary Table

| ID | Route | Priority | Pillar | Effort |
|----|-------|----------|--------|--------|
| C-01 | /dashboard | Critical | Layout | M |
| C-02 | /engineering | Critical | Layout | S |
| C-03 | /scheduling | Critical | Layout | S |
| C-04 | /housekeeping/inspections | Critical | Typography | S |
| C-05 | /housekeeping (mobile) | Critical | Layout | S |
| C-06 | /scheduling (mobile) | Critical | Layout | XS |
| C-07 | All routes | Critical | Clutter | M |
| M-01 | /tasks, /guest-requests, /lost-found | Moderate | Consistency | M |
| M-02 | /tasks, /settings, modals | Moderate | Consistency | S |
| M-03 | /tasks, /lost-found, /staff | Moderate | Clutter | S (data) |
| M-04 | /guest-requests | Moderate | Spacing | XS |
| M-05 | /billing | Moderate | Typography | XS |
| M-06 | /billing | Moderate | Consistency | XS |
| M-07 | /logbook | Moderate | Consistency | XS |
| M-08 | /sop | Moderate | Consistency | XS |
| M-09 | Sidebar sub-nav | Moderate | Consistency | XS |
| M-10 | /reports | Moderate | Spacing | M |
| M-11 | /scheduling | Moderate | Clutter | XS |
| M-12 | /tasks (mobile) | Moderate | Layout | XS |
| P-01 | /housekeeping | Minor | Spacing | XS |
| P-02 | /housekeeping | Minor | Typography | XS |
| P-03 | /ai (mobile) | Minor | Spacing | XS |
| P-04 | /ai (mobile) | Minor | Clutter | XS |
| P-05 | /engineering/*, /logbook | Minor | Clutter | S |
| P-06 | /reports, /inspections | Minor | Consistency | S |
| P-07 | /logbook | Minor | Clutter | XS |
| P-08 | /settings, /housekeeping | Minor | Typography | S |
| P-09 | /staff | Minor | Clutter | XS (data) |
| P-10 | /dashboard | Minor | Clutter | XS |

**Effort key:** XS = < 30 min · S = 30–90 min · M = half day · L = full day+
