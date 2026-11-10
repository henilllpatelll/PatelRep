import { createContext, useContext, useMemo } from "react";
import type { ThemeMode } from "@/components/shared/tokens";

type ScopeValue = { mode?: ThemeMode };

const DesignV2Context = createContext<ScopeValue>({});

/** Design System V2 is the one PatelRep design for every hotel and role; there is no flag, preview variable or
 *  per-tenant switch. The scope exists only to PIN light/dark for a subtree (`mode`); omit it to follow the app's
 *  system/light/dark preference. Without a provider the default context is already V2, so a surface mounted outside
 *  any scope (a modal, a toast, a sheet) can never fall back to a legacy look. */
export function DesignV2Scope({ mode, children }: { mode?: ThemeMode; children: React.ReactNode }) {
  const value = useMemo<ScopeValue>(() => ({ mode }), [mode]);
  return <DesignV2Context.Provider value={value}>{children}</DesignV2Context.Provider>;
}

export function useDesignV2Scope(): { active: true; mode?: ThemeMode } {
  const ctx = useContext(DesignV2Context);
  return { active: true, mode: ctx.mode };
}

/** Always true. Kept so components can branch their remaining non-color styling through one name. */
export function useIsDesignV2(): true {
  return true;
}
