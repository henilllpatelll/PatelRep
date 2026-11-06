'use client'

import { useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'
import { PageTransition } from './PageTransition'
import { TweaksPanel } from './TweaksPanel'
import { FeedbackButton } from './FeedbackButton'
import { CommandPalette } from './CommandPalette'
import { MobileFloorNav } from './MobileFloorNav'
import { Toaster } from '@/components/ui/Toast'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { useDesignV2 } from '@/lib/design/designV2'
import { ShellV2 } from '@/components/design-v2/shell/ShellV2'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { density, theme, accent } = useUIPreferencesStore()
  const hotel = useHotelStore((s) => s.hotel)
  const shellV2 = isSectionRedesigned('shell', hotel)
  const designV2 = useDesignV2()

  const themeClasses = [
    density === 'comfortable' ? 'density-comfortable' : density === 'dense' ? 'density-dense' : 'density-balanced',
    theme === 'dark' ? 'theme-dark' : '',
    `accent-${accent}`,
  ].filter(Boolean)

  // Any component that escapes this div via createPortal(..., document.body)
  // (RoomDetailDrawer and other full-screen drawers) sits outside this
  // element's subtree, so it never inherited these theme/density/accent
  // CSS-variable classes -- it silently rendered as if dark mode/density/accent
  // were never set. Mirroring the same classes onto body keeps portaled
  // content in sync without changing this div's own className.
  useEffect(() => {
    document.body.classList.add(...themeClasses)
    return () => {
      document.body.classList.remove(...themeClasses)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, theme, accent])

  // Design System V2: the V2 management shell replaces this chrome when this hotel's `design_v2` flag is on
  // (or on a development preview build). Flag off, missing, loading or unknown -> the legacy shell below renders
  // exactly as before. The two branches are different trees, so a flag change re-mounts every page below and each
  // one re-reads the decision (see lib/design/designV2.ts).
  if (designV2) {
    return (
      <ShellV2 themeClasses={themeClasses} legacyRedesigned={shellV2}>
        {children}
      </ShellV2>
    )
  }

  return (
    <div className={`flex h-screen bg-paper ${themeClasses.join(' ')}`}>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Tooltip.Provider delayDuration={200}>
        <Sidebar redesigned={shellV2} mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Header redesigned={shellV2} onMenuToggle={() => setSidebarOpen((prev) => !prev)} />
          <main className="flex-1 overflow-y-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-5 md:pb-20">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>

        <AICopilotBubble />
        <FeedbackButton />
        <TweaksPanel />
        <Toaster />
        <CommandPalette redesigned={shellV2} />
        <MobileFloorNav />
      </Tooltip.Provider>
    </div>
  )
}
