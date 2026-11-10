'use client'

import { useEffect } from 'react'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { ShellV2 } from '@/components/design-v2/shell/ShellV2'

export function DashboardShell({ children }: { children: React.ReactNode }) {
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

  // Design System V2 is the one management shell for every hotel and role.
  return (
    <ShellV2 themeClasses={themeClasses} legacyRedesigned={shellV2}>
      {children}
    </ShellV2>
  )
}
