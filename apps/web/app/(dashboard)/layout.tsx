import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { AICopilotBubble } from '@/components/ai/AICopilotBubble'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-app-gradient">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
      <AICopilotBubble />
    </div>
  )
}
