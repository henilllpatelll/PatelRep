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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { density, theme, accent } = useUIPreferencesStore()
  const hotel = useHotelStore((s) => s.hotel)
  const shellV2 = isSectionRedesigned('shell', hotel)

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
