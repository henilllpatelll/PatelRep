'use client'

import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { FeedbackButton } from '@/components/shared/FeedbackButton'
import { Header } from '@/components/shared/Header'
import { MobileFloorNav } from '@/components/shared/MobileFloorNav'
import { PageTransition } from '@/components/shared/PageTransition'
import { TweaksPanel } from '@/components/shared/TweaksPanel'
import { Toaster } from '@/components/ui/Toast'
import { applyContentScopeV2 } from '@/lib/design/contentScopeV2'
import { designV2CssVars, type ModeV2 } from '@/lib/design/designV2Tokens'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { HeaderLeadingV2 } from './HeaderLeadingV2'
import { SidebarContent } from './SidebarV2'
import '../content/contentRemapV2.css'
import styles from './shellV2.module.css'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/** Viewports narrower than this force the icon rail (medium widths); below 1024 the sidebar is a drawer. */
export const RAIL_BREAKPOINT_PX = 1280
export const DRAWER_BREAKPOINT_PX = 1024

function useMaxWidth(px: number): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia(`(max-width: ${px - 1}px)`)
    const update = () => setMatches(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [px])
  return matches
}

interface ShellV2Props {
  children: ReactNode
  /** Density / accent classes from the legacy shell, so portaled legacy content stays in sync. */
  themeClasses?: string[]
  /** Legacy per-hotel `shell` redesign flag, forwarded to widgets that still read it. */
  legacyRedesigned?: boolean
}

/** Design System V2 management shell: dark sidebar (collapsible; icon rail at medium widths;
 *  focus-trapped drawer on small screens), light header and a bounded content column.
 *
 *  Rendered by DashboardShell ONLY when NEXT_PUBLIC_DESIGN_V2_PREVIEW is on (never in production).
 *  Routes, permissions and page bodies' behavior are untouched: navigation comes from
 *  `getAllowedNavItems`, the header is the existing Header with a V2 leading area, and `children`
 *  receive the V2 palette through the body-scoped token remap (Phase 7, contentRemapV2.css). */
export function ShellV2({ children, themeClasses = [], legacyRedesigned }: ShellV2Props) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const theme = useUIPreferencesStore((s) => s.theme)
  const prefCollapsed = useUIPreferencesStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = useUIPreferencesStore((s) => s.toggleSidebarCollapsed)
  const mode: ModeV2 = theme === 'dark' ? 'dark' : 'light'
  const vars = useMemo(() => ({ ...designV2CssVars(mode), colorScheme: mode }) as CSSProperties, [mode])

  // Phase 7: remap the legacy token names to V2 for page bodies and portaled drawers/dialogs.
  useEffect(() => applyContentScopeV2(document.body, mode, vars as Record<string, string>), [mode, vars])

  // `theme-dark` / `accent-*` re-declare the legacy tokens on THIS element, which is closer to the page
  // bodies than <body> and would shadow the body-scoped V2 remap (warm dark palette, terracotta accent).
  // They stay on <body> (DashboardShell mirrors them there) so legacy portals are unaffected; only the
  // density classes are kept on the V2 root.
  const rootThemeClasses = useMemo(() => themeClasses.filter((c) => c.startsWith('density-')), [themeClasses])

  const railForced = useMaxWidth(RAIL_BREAKPOINT_PX)
  const rail = railForced || prefCollapsed
  const [navOpen, setNavOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const closeNav = useCallback(() => setNavOpen(false), [])

  // A route change always closes the drawer (links also close it on click).
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // Growing past the drawer breakpoint while it is open would leave a modal over a visible sidebar.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= DRAWER_BREAKPOINT_PX) setNavOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className={cx(styles.root, ...rootThemeClasses)} style={vars} data-design-v2={mode} data-shell-v2="">
      <a href="#main-content" className={styles.skipLink}>
        {t('shellV2.skipToContent')}
      </a>
      <Tooltip.Provider delayDuration={150}>
        <div className={cx(styles.shell, rail && styles.shellRail)}>
          <aside className={styles.sidebar} aria-label={t('shellV2.sidebar')} data-testid="shell-v2-sidebar" data-rail={rail ? 'true' : 'false'}>
            <SidebarContent rail={rail} themeVars={vars} onToggleRail={toggleCollapsed} railForced={railForced} />
          </aside>

          <div className={styles.main}>
            <div className={cx(styles.headerWrap, styles.chromeLight)}>
              <Header redesigned={legacyRedesigned} v2Leading={<HeaderLeadingV2 ref={menuRef} onOpenMenu={() => setNavOpen(true)} />} />
            </div>
            <main id="main-content" tabIndex={-1} className={styles.content}>
              <div className={styles.contentInner}>
                <PageTransition>{children}</PageTransition>
              </div>
            </main>
          </div>
        </div>

        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} style={vars} />
            <Dialog.Content
              className={styles.drawerNav}
              style={vars}
              aria-describedby={undefined}
              data-testid="shell-v2-drawer"
              onCloseAutoFocus={(event) => {
                // Return focus to the menu button that opened the drawer.
                event.preventDefault()
                menuRef.current?.focus()
              }}
            >
              <div className={styles.drawerHead}>
                <Dialog.Title className={styles.srOnly}>{t('shellV2.navigationMenu')}</Dialog.Title>
                <span />
                <Dialog.Close className={styles.drawerClose} aria-label={t('common.close')}>
                  <X size={22} aria-hidden />
                </Dialog.Close>
              </div>
              <SidebarContent rail={false} themeVars={vars} onNavigate={closeNav} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <AICopilotBubble />
        {/* The legacy report-an-issue pill is fixed bottom-left; keep it clear of the sidebar. */}
        <div className={cx(styles.feedbackSlot, rail && styles.feedbackSlotRail)}>
          <FeedbackButton />
        </div>
        <TweaksPanel />
        <Toaster />
        <CommandPalette redesigned={legacyRedesigned} />
        <MobileFloorNav />
      </Tooltip.Provider>
    </div>
  )
}
