'use client'

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { designV2CssVars, type ModeV2 } from '@/lib/design/designV2Tokens'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import styles from './authV2.module.css'

export { styles as authV2Styles }

/** Page scope for the V2 sign-in. Sets the `--dv2-*` variables inline (the same single definition the
 *  shell uses) and follows the saved light/dark preference. Used only while the preview flag is on. */
export function AuthV2Scope({ children }: { children: ReactNode }) {
  const theme = useUIPreferencesStore((s) => s.theme)
  const mode: ModeV2 = theme === 'dark' ? 'dark' : 'light'
  const vars = useMemo(() => ({ ...designV2CssVars(mode), colorScheme: mode }) as CSSProperties, [mode])
  return (
    <div className={styles.page} style={vars} data-design-v2={mode} data-auth-v2="">
      {children}
    </div>
  )
}
