# Sidebar Simplification Plan

## Context
The user finds the current sidebar navigation overwhelming due to too many items being visible at once (~20+ navigation items). They want to keep the current sidebar structure (not replace it with tabs or other navigation patterns) but simplify it by grouping navigation items into collapsible sections. This will reduce visual clutter while maintaining all existing functionality.

## Requirements
1. Keep the existing sidebar component structure intact
2. Group navigation items into logical sections (Operations, Intelligence, People, Settings)  
3. Make section headers clickable to toggle visibility of items within each section
4. Add visual indicators (chevron icons) to show open/closed state
5. Preserve all existing functionality: tooltips, active item highlighting, role-based filtering, hotel switching, user identity display
6. Set reasonable default states for which sections should be open/closed

## Implementation Details

### Files to Modify
- `apps/web/components/shared/Sidebar.tsx` - Main sidebar component

### Key Changes
1. **Add State Variables**: 
   - `opsOpen`, `intelOpen`, `peopleOpen`, `settingsOpen` to track section states
   - Initialize with sensible defaults (Operations and Intelligence open by default as they're most frequently used)

2. **Transform Section Headers**:
   - Change `<p>` elements for section headers to `<button>` elements
   - Add `onClick` handlers to toggle corresponding state variables
   - Add chevron icons (ChevronDown/ChevronUp) that rotate based on open/closed state

3. **Conditional Rendering**:
   - Wrap each section's navigation items in `{sectionOpen && <div>...</div>}` 
   - Only render items when the section is open

4. **Visual Styling**:
   - Style section headers to be clearly clickable
   - Maintain existing indentation and spacing for nested items
   - Preserve tooltip functionality for collapsed sidebar mode

### Section Groupings (based on existing code)
- **Operations**: Dashboard, Housekeeping, Engineering, Programs, Lost & Found, Guest Requests, Tasks
- **Intelligence**: AI Copilot, SOP Library, Evidence, Safety, Reports, Management ROI  
- **People**: Staff, Scheduling, Logbook
- **Settings**: General, Departments, Front Desk, Roles, Inspections, Guest Requests (settings), Housekeeping (settings), Rooms, Billing, Integrations, Feedback

Note: Settings section only appears for GM role (bottomItems in current code)

### Default States
- Operations: Open by default (most frequently accessed)
- Intelligence: Open by default (frequently accessed for reporting/AI)
- People: Closed by default (less frequent access)
- Settings: Closed by default (configuration changes less frequent)

## Verification
To verify the implementation works correctly:

1. **Visual Verification**:
   - Sidebar should load with Operations and Intelligence sections open, People and Settings closed
   - Section headers should be clearly clickable with visual feedback
   - Chevron icons should rotate correctly when sections toggle
   - Clicking a section header should smoothly show/hide its items

2. **Functional Verification**:
   - All navigation links should still work correctly
   - Active item highlighting should persist
   - Role-based filtering should still restrict access appropriately  
   - Hotel switching functionality should remain intact
   - User identity display should work as before
   - Tooltips should still appear when sidebar is collapsed
   - Mobile responsiveness should be preserved

3. **Edge Cases**:
   - Sections with no accessible items (due to role restrictions) should handle gracefully
   - Deep linking to URLs in collapsed sections should work (section should auto-open or navigation should still function)
   - Sidebar collapsed/expanded state should work correctly with the new section toggling

## Benefits
- Reduces initial visual load from ~20+ items to just 4 section headers
- Maintains immediate access to most frequently used items (Operations & Intelligence open by default)
- Preserves familiar vertical navigation layout within sections
- Requires minimal retraining for existing users
- Follows progressive disclosure principles
- Keeps all existing functionality intact