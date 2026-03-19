import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'
import { PageTransition } from '@/components/shared/PageTransition'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#FEFAF4]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-5">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      {/* AICopilotBubble is position:fixed — must stay OUTSIDE PageTransition
          to avoid stacking context issues from the motion.div transform */}
      <AICopilotBubble />
    </div>
  )
}
