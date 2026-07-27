'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Plus } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { guestRequestsApi, type SlaPolicy } from '@/lib/api/guest_requests'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import {
  SlaPolicyCard,
  SlaPolicyFormCard,
  type SlaPolicyFormValues,
  EMPTY_SLA_POLICY_FORM,
} from '@/components/settings/SlaPolicyForm'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GuestRequestsSettingsPage() {
  const { hotel } = useHotelStore()
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'
  const toast = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<SlaPolicyFormValues>(EMPTY_SLA_POLICY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: slaPolicies = [],
    refetch: refetchPolicies,
  } = useQuery({
    queryKey: ['sla-policies', hotel?.id],
    queryFn: () => guestRequestsApi.listSlaPolicies(),
    enabled: !!hotel?.id,
    select: (res: any) => (res.data ?? []) as SlaPolicy[],
  })

  const savePolicy = useCallback(async () => {
    if (!hotel?.id) return
    setSaving(true)
    try {
      await guestRequestsApi.createSlaPolicy({
        category: form.category || undefined,
        priority: form.priority || undefined,
        guest_impact: form.guest_impact || undefined,
        sla_minutes: form.sla_minutes,
      })
      setFormOpen(false)
      setForm({ ...EMPTY_SLA_POLICY_FORM })
      await refetchPolicies()
      toast.success('SLA rule created.')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save SLA rule.')
    } finally {
      setSaving(false)
    }
  }, [hotel, form, refetchPolicies, toast])

  const deletePolicy = useCallback(async () => {
    if (!hotel?.id || !deleteTargetId) return
    setDeleting(true)
    try {
      await guestRequestsApi.deleteSlaPolicy(deleteTargetId)
      setDeleteTargetId(null)
      await refetchPolicies()
      toast.success('SLA rule deleted.')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete SLA rule.')
    } finally {
      setDeleting(false)
    }
  }, [hotel, deleteTargetId, refetchPolicies, toast])

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-ink">Guest Request SLA Rules</h2>
          <p className="text-[14px] text-ink3 mt-1">
            Response-time rules by category, priority, and guest impact. Requests with no matching rule use the 240-minute default.
          </p>
        </div>
        {canManage && !formOpen && (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setForm({ ...EMPTY_SLA_POLICY_FORM })
              setFormOpen(true)
            }}
          >
            <Plus size={14} className="inline mr-1.5 -mt-0.5" />
            New SLA Rule
          </Button>
        )}
      </div>

      {formOpen && (
        <SlaPolicyFormCard
          values={form}
          onChange={setForm}
          onSave={savePolicy}
          onCancel={() => setFormOpen(false)}
          saving={saving}
        />
      )}

      {slaPolicies.length === 0 && !formOpen && (
        <EmptyState
          icon={<Clock className="w-5 h-5" />}
          title="No SLA rules yet"
          body="Create a rule to override the default 240-minute response time by category, priority, and guest impact."
        />
      )}

      <div className="space-y-3">
        {slaPolicies.map(policy => (
          <SlaPolicyCard
            key={policy.id}
            policy={policy}
            canManage={canManage}
            onDelete={() => setDeleteTargetId(policy.id)}
          />
        ))}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTargetId}
        title="Delete this rule?"
        description="Guest requests in this category will fall back to the default SLA once removed."
        onConfirm={deletePolicy}
        onCancel={() => setDeleteTargetId(null)}
        loading={deleting}
      />
    </div>
  )
}
