import { createContext, useContext, useMemo } from "react";
import type { ThemeMode } from "@/components/shared/tokens";
import { isDesignV2Enabled } from "./designV2";

type ScopeValue = { mode?: ThemeMode };

const DesignV2Context = createContext<ScopeValue | null>(null);

/** Renders its subtree with the V2 theme — but only when the preview flag is on. With the flag off
 *  it is a transparent pass-through, so a stray usage can never change production appearance.
 *  `mode` optionally pins light/dark inside the scope (the preview's own toggle); omit it to follow
 *  the app's normal system/light/dark appearance preference. */
export function DesignV2Scope({
  mode,
  enabled = true,
  children,
}: {
  mode?: ThemeMode;
  /** Role gate: `false` makes the scope an inert pass-through (used to scope V2 to one role's surface). */
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<ScopeValue | null>(
    () => (enabled && isDesignV2Enabled() ? { mode } : null),
    [mode, enabled],
  );
  return <DesignV2Context.Provider value={value}>{children}</DesignV2Context.Provider>;
}

export function useDesignV2Scope(): { active: boolean; mode?: ThemeMode } {
  const ctx = useContext(DesignV2Context);
  return ctx ? { active: true, mode: ctx.mode } : { active: false };
}

/** True only inside an active `<DesignV2Scope>`. Components use it for non-color V2 styling. */
export function useIsDesignV2(): boolean {
  return useContext(DesignV2Context) !== null;
}
