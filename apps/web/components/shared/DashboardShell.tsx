'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'
import { PageTransition } from './PageTransition'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { density, theme } = useUIPreferencesStore()

  return (
    <div className={`flex h-screen bg-paper ${density === 'comfortable' ? 'density-comfortable' : density === 'dense' ? 'density-dense' : 'density-balanced'} ${theme === 'dark' ? 'theme-dark' : ''}`}>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMenuToggle={() => setSidebarOpen((prev) => !prev)} />
        <main className="flex-1 overflow-y-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-5 md:pb-20">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/* AICopilotBubble is position:fixed — must stay OUTSIDE PageTransition
          to avoid stacking context issues from the motion.div transform */}
      <AICopilotBubble />
    </div>
  )
}
