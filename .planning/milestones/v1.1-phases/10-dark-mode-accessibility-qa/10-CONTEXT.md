# Phase 10: Dark Mode & Accessibility QA - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable a persistent app-wide appearance preference after the Phase 7-9 primitive rollout, theme the Expo Router navigator chrome, verify WCAG AA contrast, complete an EAS Android production build, and prove that existing bilingual, offline-sync, and RBAC behavior did not regress.

This is a theme-enablement and quality-assurance phase. It does not add hotel workflows, change data contracts, alter routing/RBAC behavior, or redesign migrated screens. The intentionally dark AI Copilot presentation locked by Phase 9 D-11 remains a deliberate exception to light/dark content-surface switching; its surrounding navigator chrome must still follow the active app theme, and its dark presentation must pass the same accessibility audit.

</domain>

<decisions>
## Implementation Decisions

### Appearance control and persistence
- Profile exposes three choices: **System**, **Light**, and **Dark**.
- **System** is the default when no preference has been saved, including for existing users receiving the feature. It follows the phone's current appearance.
- While System is selected, an OS appearance change applies immediately even if PatelRep is already open.
- The explicit choice persists across app restarts on the device. Cross-device/account synchronization is not part of this phase.
- Use a directly visible, full-width three-option segmented control in Profile. Each option must have an accessible selected state and at least a 44pt touch target; EN and ES labels must fit without becoming ambiguous.
- Theme changes are immediate, with no crossfade or decorative animation.

### Dark visual treatment
- Use PatelRep's existing warm-charcoal **Evening Lobby** character: layered warm dark surfaces rather than neutral black or a generic blue-gray dark theme.
- Preserve forest green as the primary action family. Do not introduce accent customization.
- Preserve the universal operational status mapping across themes: green inspected/ready, blue clean/inspection-ready, purple in progress, red vacant dirty, striped red occupied, yellow pickup, and gray/stone out of order or out of service.
- Status hues may be adjusted in brightness or saturation where necessary to pass contrast, but their meaning must never change. Statuses continue to use label/icon/pattern cues so color is never the only signal.
- Navigator headers, tab bars, and status bar use a deeper warm-charcoal shell than content surfaces to make navigation boundaries clear. All chrome must resolve to the active theme on the first rendered frame, with no light/dark flash.
- Cards, sheets, modals, banners, and Toasts use layered theme surfaces and visible borders where needed; elevation must not depend on shadow alone in dark mode.
- Keep the Phase 9 D-11 Copilot dark lock and its dark-only tokens. Do not force it through light-theme surface tokens merely to make every route structurally identical.

### Accessibility acceptance bar
- Every migrated route and its meaningful loading, empty, error, modal/sheet, banner, badge, and Toast states must be checked in both light and dark mode.
- WCAG AA is the release bar: at least 4.5:1 for normal text and 3:1 for large text, essential icons, controls, focus/selection indicators, and meaningful non-text boundaries.
- Interactive controls must retain at least a 44x44pt target. Adjacent controls must remain distinguishable and operable without relying on precision taps.
- Theme controls, icon-only actions, status controls, and navigation expose meaningful accessibility labels, roles, selected/disabled/busy state, and a logical screen-reader order.
- Run a 200% text-scaling smoke pass across representative high-frequency workflows and every navigation shell. Fix clipped or hidden actions that block task completion; do not redesign content or add a separate density system.
- Theme switching itself uses no animation. Any existing motion encountered during QA must respect the OS reduced-motion preference where the platform exposes it.

### Verification and closeout evidence
- Add focused automated coverage for the appearance preference default, persistence, explicit Light/Dark overrides, live System-mode changes, and navigator/status-bar theme wiring.
- Add an automated contrast contract for shared theme tokens and semantic status combinations. Automated token checks supplement, but do not replace, rendered-screen inspection.
- Run the full mobile unit suite, type-check, lint/i18n gate, and production export/build checks after implementation.
- A successful full EAS **Android** production build is mandatory, with its build identifier/link recorded in the phase verification artifact. iOS build work remains outside v1.1.
- Complete a real Android device or emulator walkthrough covering all migrated routes in both light and dark mode. Exercise the distinct housekeeper, engineer, supervisor, front-desk, and GM navigation/RBAC shells.
- Exercise EN and ES in both themes, including narrow layouts and the Profile appearance control. No English fallback is acceptable in Spanish staff-facing UI except proper/brand names.
- Exercise offline-capable floor workflows while disconnected and after reconnect, confirming OfflineBanner/Toast layering, queued state, and synchronization behavior are unchanged.
- Record results, contrast findings/fixes, build evidence, and any accepted limitations in `10-VERIFICATION.md`. Phase 10 cannot be declared complete from static analysis or automated tests alone; the Android walkthrough is a human verification gate.

### Claude's Discretion
- Exact token values and the smallest contrast-safe adjustments, provided the locked visual identity and status semantics above are preserved.
- Test implementation details, fixture construction, screenshot organization, and the order of the verification matrix.
- Minor layout adjustments needed to preserve 44pt targets, Spanish fit, and 200% text-scale operability without changing workflows.

</decisions>

<specifics>
## Specific Ideas

- Dark mode should feel like PatelRep's warm **Evening Lobby**, not a generic near-black developer theme.
- The app should follow scheduled OS appearance changes live when System mode is selected.
- Floor work should not be interrupted by a theme transition animation.
- Navigator chrome should read as a deeper shell around warm layered content surfaces.

</specifics>

<deferred>
## Deferred Ideas

- EAS iOS build pipeline and iOS-specific walkthrough — future requirement IOS-01.
- Account-synchronized appearance preferences across multiple devices.
- Accent-color picker or density modes, both already excluded from the v1.1 milestone.

</deferred>

---

*Phase: 10-dark-mode-accessibility-qa*
*Context gathered: 2026-07-30*
