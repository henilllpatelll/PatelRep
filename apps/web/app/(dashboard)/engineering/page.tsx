'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { WorkOrderList } from '@/components/engineering/WorkOrderList'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { FailurePredictionSidebar } from '@/components/engineering/FailurePredictionSidebar'
import { useRole } from '@/lib/hooks/useRole'
import type { WorkOrder } from '@/lib/api/engineering'

type Tab = 'open' | 'in_progress' | 'on_hold' | 'completed'

const TABS: { value: Tab; label: string; active: string; inactive: string }[] = [
  {
    value: 'open',
    label: 'Open',
    active: 'bg-blue-600 text-white border-blue-600',
    inactive: 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50',
  },
  {
    value: 'in_progress',
    label: 'In Progress',
    active: 'bg-purple-600 text-white border-purple-600',
    inactive: 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50',
  },
  {
    value: 'on_hold',
    label: 'On Hold',
    active: 'bg-orange-500 text-white border-orange-500',
    inactive: 'bg-white text-orange-700 border-orange-200 hover:bg-orange-50',
  },
  {
    value: 'completed',
    label: 'Completed',
    active: 'bg-green-600 text-white border-green-600',
    inactive: 'bg-white text-green-700 border-green-200 hover:bg-green-50',
  },
]

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'structural', label: 'Structural' },
  { value: 'safety', label: 'Safety' },
  { value: 'general', label: 'General' },
]

const PRIORITIES = [
  { value: '', label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

export default function EngineeringPage() {
  const { role, isGM } = useRole()
  const isChief = role === 'chief_engineer'
  const isEngineer = role === 'engineer'
  const canCreate = isGM || isChief || isEngineer

  const [activeTab, setActiveTab] = useState<Tab>('open')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('')
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── Main content ── */}
      <div className="flex-1 space-y-4 min-w-0">

        {/* Header row */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Engineering</h1>
          {canCreate && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Work Order
            </button>
          )}
        </div>

        {/* Tab + filter row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  activeTab === tab.value ? tab.active : tab.inactive
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Category filter */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Work order list */}
        <WorkOrderList
          status={activeTab}
          category={category || undefined}
          priority={priority || undefined}
          onSelect={(wo) => setSelectedWO(wo)}
        />
      </div>

      {/* ── Sidebar ── */}
      <FailurePredictionSidebar />

      {/* ── Detail drawer ── */}
      <WorkOrderDetailDrawer
        wo={selectedWO}
        isOpen={!!selectedWO}
        onClose={() => setSelectedWO(null)}
        onUpdate={() => {
          setSelectedWO(null)
        }}
      />

      {/* ── Create modal ── */}
      <CreateWorkOrderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(wo) => {
          setShowCreateModal(false)
          setSelectedWO(wo)
        }}
      />
    </div>
  )
}
