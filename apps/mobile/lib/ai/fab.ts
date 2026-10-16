/* ─── Where the floating assistant button lives ─────────────────────────────
   Pure rules (no React) so placement and visibility can be tested. The button is
   for housekeepers only: other roles keep the corner card they already have. It
   never covers a screen's own primary controls, so it is hidden wherever those
   sit at the bottom (room detail's sticky actions, the full assistant, the
   keyboard), and it never asks a model anything just by being on screen. */

/** Height of the bottom tab bar in app/(app)/_layout.tsx. */
export const TAB_BAR_HEIGHT = 76;
const GAP_ABOVE_TABS = 16;
const SIDE_GUTTER = 18;

/** Screens whose bottom edge belongs to their own controls (sticky actions) or to the assistant itself. */
const HIDDEN_ROUTES: RegExp[] = [/^\/my-rooms\/.+/, /^\/copilot(\/|$)/];

export interface FabVisibilityInput {
  pathname: string;
  role: string | null | undefined;
  authenticated: boolean;
  keyboardVisible: boolean;
  /** The compact assistant is already open. */
  sheetOpen: boolean;
}

export function isAssistantRole(role: string | null | undefined): boolean {
  return role === "housekeeper";
}

export function assistantFabVisible(input: FabVisibilityInput): boolean {
  if (!input.authenticated || !isAssistantRole(input.role)) return false;
  if (input.keyboardVisible || input.sheetOpen) return false;
  return !HIDDEN_ROUTES.some((route) => route.test(input.pathname));
}

export interface FabInsets {
  bottom: number;
  right: number;
}

/** Above the tab bar and the home indicator, clear of the side cut-out in landscape. */
export function assistantFabPlacement(insets: FabInsets): { bottom: number; right: number } {
  return {
    bottom: insets.bottom + TAB_BAR_HEIGHT + GAP_ABOVE_TABS,
    right: Math.max(SIDE_GUTTER, insets.right + 12),
  };
}
