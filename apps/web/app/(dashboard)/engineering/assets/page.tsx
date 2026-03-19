'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle,
  X,
  Loader2,
  ChevronRight,
  Wrench,
} from 'lucide-react'
import { engineeringApi, Asset, PMSchedule } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ─── Constants ────────────────────────────────────────────────────────────────

const RISK_FILTERS = ['All', 'High Risk', 'Medium', 'Low'] as const
type RiskFilter = (typeof RISK_FILTERS)[number]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskBadge(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: 'HIGH', cls: 'bg-red-50 text-red-700 border border-red-200' }
  if (score >= 40) return { label: 'MEDIUM', cls: 'bg-amber-50 text-amber-700 border border-amber-200' }
  return { label: 'LOW', cls: 'bg-blue-50 text-blue-700 border border-blue-200' }
}

function getRiskBarColor(score: number): string {
  if (score >= 70) return 'bg-red-500'
  if (score >= 40) return 'bg-orange-400'
  return 'bg-green-500'
}

function getWarrantyLabel(warrantyExpires?: string): { text: string; cls: string } {
  if (!warrantyExpires) return { text: 'No warranty', cls: 'text-gray-400' }
  const expiry = new Date(warrantyExpires)
  const now = new Date()
  if (expiry < now) return { text: 'Expired', cls: 'text-red-600 font-medium' }
  return {
    text: `Expires ${format(expiry, 'MM/yyyy')}`,
    cls: 'text-green-700',
  }
}

function formatCurrency(value?: number): string {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-indigo-50/60">
      <td className="px-4 py-3">
        <div className="h-4 bg-gray-100 rounded w-3/4 mb-1.5" />
        <div className="h-3 bg-gray-100 rounded w-1/3" />
      </td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-28" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-7 bg-gray-100 rounded w-14" /></td>
    </tr>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'red' | 'green' | 'default'
}

function StatCard({ label, value, sub, accent = 'default' }: StatCardProps) {
  const valueColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'green'
        ? 'text-green-600'
        : 'text-gray-900'
  return (
    <Card className={`px-5 py-4${accent === 'red' ? ' border-red-200 bg-red-50' : ''}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  )
}

// ─── Asset Detail Modal ────────────────────────────────────────────────────────

interface AssetDetailModalProps {
  assetId: string
  onClose: () => void
  canEdit: boolean
}

function AssetDetailModal({ assetId, onClose, canEdit }: AssetDetailModalProps) {
  const queryClient = useQueryClient()
  const [editMode, setEditMode] = useState(false)
  const [editFields, setEditFields] = useState<Partial<Asset>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => engineeringApi.getAsset(assetId),
    select: (res) => res.data as Asset & { pm_schedules?: PMSchedule[] },
  })

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  function startEdit() {
    if (!data) return
    setEditFields({
      name: data.name,
      location_text: data.location_text,
      manufacturer: data.manufacturer,
      model: data.model,
      serial_number: data.serial_number,
      notes: data.notes,
      replacement_cost: data.replacement_cost,
      expected_lifespan_years: data.expected_lifespan_years,
    })
    setSaveError(null)
    setEditMode(true)
  }

  async function handleSave() {
    if (!data) return
    setSaving(true)
    setSaveError(null)
    try {
      await engineeringApi.updateAsset(assetId, editFields)
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] })
      setEditMode(false)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  const risk = data ? getRiskBadge(data.failure_risk_score) : null
  const warranty = data ? getWarrantyLabel(data.warranty_expires) : null
  const pmSchedules: PMSchedule[] = (data as (Asset & { pm_schedules?: PMSchedule[] }) | undefined)?.pm_schedules ?? []

  return (
    <>
      <div
        className="fixed inset-0 bg-indigo-950/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white/[0.88] backdrop-blur-2xl border-b border-white/60 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                <Package size={16} className="text-indigo-600" />
              </div>
              <h2 className="text-base font-bold text-gray-900">
                {isLoading ? 'Loading…' : (data?.name ?? 'Asset Detail')}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && data && !editMode && (
                <Button
                  variant="secondary"
                  onClick={startEdit}
                  className="px-3 py-1.5 text-sm"
                >
                  Edit
                </Button>
              )}
              <button
                onClick={onClose}
                disabled={saving}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : !data ? (
            <div className="p-6 text-center text-sm text-gray-500">Failed to load asset.</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Risk + Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                {risk && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${risk.cls}`}>
                    <AlertTriangle size={12} />
                    {risk.label} RISK — {data.failure_risk_score}%
                  </span>
                )}
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                    data.is_active
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {data.is_active ? 'Active' : 'Inactive'}
                </span>
                {data.asset_tag && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-slate-50 text-slate-600 border border-slate-200">
                    {data.asset_tag}
                  </span>
                )}
              </div>

              {editMode ? (
                /* ── Edit form ── */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                      <Input
                        type="text"
                        value={editFields.name ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                      <Input
                        type="text"
                        value={editFields.location_text ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, location_text: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                      <Input
                        type="text"
                        value={editFields.manufacturer ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, manufacturer: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                      <Input
                        type="text"
                        value={editFields.model ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, model: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Serial Number</label>
                      <Input
                        type="text"
                        value={editFields.serial_number ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, serial_number: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Replacement Cost ($)</label>
                      <Input
                        type="number"
                        min={0}
                        value={editFields.replacement_cost ?? ''}
                        onChange={(e) =>
                          setEditFields((f) => ({
                            ...f,
                            replacement_cost: e.target.value ? Number(e.target.value) : undefined,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Expected Lifespan (years)</label>
                      <Input
                        type="number"
                        min={0}
                        value={editFields.expected_lifespan_years ?? ''}
                        onChange={(e) =>
                          setEditFields((f) => ({
                            ...f,
                            expected_lifespan_years: e.target.value ? Number(e.target.value) : undefined,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <textarea
                      rows={3}
                      value={editFields.notes ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-indigo-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors resize-none"
                    />
                  </div>
                  {saveError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                      <AlertTriangle size={14} className="shrink-0" />
                      {saveError}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/60">
                    <Button
                      variant="ghost"
                      onClick={() => setEditMode(false)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          Saving…
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Read-only detail ── */
                <>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <DetailRow label="Category" value={data.asset_categories?.name ?? '—'} />
                    <DetailRow
                      label="Location"
                      value={data.rooms?.room_number ? `Room ${data.rooms.room_number}` : (data.location_text ?? '—')}
                    />
                    <DetailRow label="Manufacturer" value={data.manufacturer ?? '—'} />
                    <DetailRow label="Model" value={data.model ?? '—'} />
                    <DetailRow label="Serial Number" value={data.serial_number ?? '—'} mono />
                    <DetailRow
                      label="Purchase Date"
                      value={data.purchase_date ? format(new Date(data.purchase_date), 'MMM d, yyyy') : '—'}
                    />
                    <DetailRow
                      label="Installation Date"
                      value={data.installation_date ? format(new Date(data.installation_date), 'MMM d, yyyy') : '—'}
                    />
                    <DetailRow
                      label="Warranty"
                      value={warranty?.text ?? '—'}
                      valueClass={warranty?.cls}
                    />
                    <DetailRow
                      label="Expected Lifespan"
                      value={data.expected_lifespan_years != null ? `${data.expected_lifespan_years} years` : '—'}
                    />
                    <DetailRow label="Replacement Cost" value={formatCurrency(data.replacement_cost)} />
                  </div>

                  {data.notes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Notes</p>
                      <p className="text-sm text-gray-700 bg-indigo-50/40 rounded-lg px-4 py-3">{data.notes}</p>
                    </div>
                  )}
                </>
              )}

              {/* PM Schedules section */}
              {!editMode && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    PM Schedules ({pmSchedules.length})
                  </p>
                  {pmSchedules.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No PM schedules linked to this asset.</p>
                  ) : (
                    <div className="space-y-2">
                      {pmSchedules.map((pm) => {
                        const isOverdue = new Date(pm.next_due_at) < new Date()
                        return (
                          <div
                            key={pm.id}
                            className="flex items-center justify-between px-4 py-3 bg-indigo-50/40 rounded-lg border border-indigo-100/60"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">{pm.name}</p>
                              <p className="text-xs text-gray-500 mt-0.5 capitalize">
                                {pm.interval_type}
                                {pm.interval_days ? ` (${pm.interval_days} days)` : ''} •{' '}
                                {pm.estimated_minutes} min
                              </p>
                            </div>
                            <div className="text-right shrink-0 ml-4">
                              <p
                                className={`text-xs font-medium ${
                                  isOverdue ? 'text-red-600' : 'text-gray-600'
                                }`}
                              >
                                {isOverdue ? 'Overdue' : 'Due'}{' '}
                                {format(new Date(pm.next_due_at), 'MMM d, yyyy')}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {pm.last_completed_at
                                  ? `Last done ${format(new Date(pm.last_completed_at), 'MMM d, yyyy')}`
                                  : 'Never completed'}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function DetailRow({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
}) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium text-gray-900 mt-0.5 ${mono ? 'font-mono' : ''} ${valueClass ?? ''}`}>
        {value}
      </p>
    </div>
  )
}

// ─── Create Asset Modal ────────────────────────────────────────────────────────

interface CreateAssetModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateAssetModal({ isOpen, onClose, onSuccess }: CreateAssetModalProps) {
  const [fields, setFields] = useState({
    name: '',
    category_id: '',
    location_text: '',
    manufacturer: '',
    model: '',
    serial_number: '',
    purchase_date: '',
    warranty_expires: '',
    expected_lifespan_years: '',
    replacement_cost: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, saving, onClose])

  useEffect(() => {
    if (isOpen) {
      setFields({
        name: '',
        category_id: '',
        location_text: '',
        manufacturer: '',
        model: '',
        serial_number: '',
        purchase_date: '',
        warranty_expires: '',
        expected_lifespan_years: '',
        replacement_cost: '',
      })
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  function set(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreate() {
    if (!fields.name.trim()) {
      setError('Asset name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await engineeringApi.createAsset({
        name: fields.name.trim(),
        category_id: fields.category_id.trim(),
        location_text: fields.location_text.trim() || undefined,
        manufacturer: fields.manufacturer.trim() || undefined,
        model: fields.model.trim() || undefined,
        serial_number: fields.serial_number.trim() || undefined,
        purchase_date: fields.purchase_date || undefined,
        expected_lifespan_years: fields.expected_lifespan_years
          ? Number(fields.expected_lifespan_years)
          : undefined,
        replacement_cost: fields.replacement_cost
          ? Number(fields.replacement_cost)
          : undefined,
      })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create asset.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-indigo-950/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add asset"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
                <Plus size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Add Asset</h2>
            </div>
            {!saving && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Asset Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={fields.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Rooftop HVAC Unit A"
              />
            </div>

            {/* Category ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Category ID{' '}
                <span className="text-gray-400 font-normal">(UUID from system)</span>
              </label>
              <Input
                type="text"
                value={fields.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Obtain from Settings or leave blank if not yet categorised.
              </p>
            </div>

            {/* Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Location / Description{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <Input
                type="text"
                value={fields.location_text}
                onChange={(e) => set('location_text', e.target.value)}
                placeholder="e.g. Boiler Room, Floor 3 North Wing"
              />
            </div>

            {/* Manufacturer + Model */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Manufacturer</label>
                <Input
                  type="text"
                  value={fields.manufacturer}
                  onChange={(e) => set('manufacturer', e.target.value)}
                  placeholder="e.g. Carrier"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Model</label>
                <Input
                  type="text"
                  value={fields.model}
                  onChange={(e) => set('model', e.target.value)}
                  placeholder="e.g. 38CKC036"
                />
              </div>
            </div>

            {/* Serial */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Serial Number</label>
              <Input
                type="text"
                value={fields.serial_number}
                onChange={(e) => set('serial_number', e.target.value)}
                placeholder="e.g. SN-20241001-001"
                className="font-mono"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Purchase Date</label>
                <Input
                  type="date"
                  value={fields.purchase_date}
                  onChange={(e) => set('purchase_date', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Warranty Expires</label>
                <Input
                  type="date"
                  value={fields.warranty_expires}
                  onChange={(e) => set('warranty_expires', e.target.value)}
                />
              </div>
            </div>

            {/* Lifespan + Cost */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Expected Lifespan (years)</label>
                <Input
                  type="number"
                  min={0}
                  value={fields.expected_lifespan_years}
                  onChange={(e) => set('expected_lifespan_years', e.target.value)}
                  placeholder="e.g. 15"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Replacement Cost ($)</label>
                <Input
                  type="number"
                  min={0}
                  value={fields.replacement_cost}
                  onChange={(e) => set('replacement_cost', e.target.value)}
                  placeholder="e.g. 8500"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-white/60">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={saving || !fields.name.trim()}
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add Asset
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssetRegisterPage() {
  const { isGM, role } = useRole()
  const canEdit = isGM || role === 'chief_engineer'
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('All')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data: assetsData, isLoading, isError } = useQuery({
    queryKey: ['assets'],
    queryFn: () => engineeringApi.listAssets(),
    select: (res) => res.data as Asset[],
  })

  const assets = assetsData ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeAssets = assets.filter((a) => a.is_active)
  const highRiskCount = assets.filter((a) => a.failure_risk_score >= 70).length
  const underWarrantyCount = assets.filter(
    (a) => a.warranty_expires && new Date(a.warranty_expires) > new Date(),
  ).length
  const totalValue = assets.reduce((sum, a) => sum + (a.replacement_cost ?? 0), 0)

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase()
    const matchesSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.location_text ?? '').toLowerCase().includes(q) ||
      (a.asset_tag ?? '').toLowerCase().includes(q) ||
      (a.rooms?.room_number ?? '').toLowerCase().includes(q)

    const matchesRisk =
      riskFilter === 'All' ||
      (riskFilter === 'High Risk' && a.failure_risk_score >= 70) ||
      (riskFilter === 'Medium' && a.failure_risk_score >= 40 && a.failure_risk_score < 70) ||
      (riskFilter === 'Low' && a.failure_risk_score < 40)

    return matchesSearch && matchesRisk
  })

  function handleCreateSuccess() {
    queryClient.invalidateQueries({ queryKey: ['assets'] })
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Package size={22} className="text-indigo-600 shrink-0" />
            Asset Register
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track all hotel equipment, warranties, and maintenance history
          </p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            className="shrink-0"
          >
            <Plus size={15} />
            Add Asset
          </Button>
        )}
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Assets" value={activeAssets.length} sub="active" />
        <StatCard
          label="High Risk"
          value={highRiskCount}
          sub="score >= 70"
          accent={highRiskCount > 0 ? 'red' : 'default'}
        />
        <StatCard
          label="Under Warranty"
          value={underWarrantyCount}
          sub="active warranties"
          accent="green"
        />
        <StatCard
          label="Total Value"
          value={formatCurrency(totalValue)}
          sub="replacement cost"
        />
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, tag, location…"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {RISK_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setRiskFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                riskFilter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/70 border border-indigo-200/40 backdrop-blur-sm text-gray-700 hover:bg-indigo-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center p-6">
            <AlertTriangle size={28} className="text-red-400 mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">Failed to load assets</p>
            <Button
              variant="primary"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['assets'] })}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-100 bg-indigo-50/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Asset
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Location
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Risk Score
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Warranty
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-14 text-sm text-gray-400">
                      {assets.length === 0
                        ? 'No assets registered yet. Click "Add Asset" to get started.'
                        : 'No assets match your current filters.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((asset) => {
                    const risk = getRiskBadge(asset.failure_risk_score)
                    const barColor = getRiskBarColor(asset.failure_risk_score)
                    const warranty = getWarrantyLabel(asset.warranty_expires)
                    const location = asset.rooms?.room_number
                      ? `Room ${asset.rooms.room_number}`
                      : (asset.location_text ?? '—')
                    return (
                      <tr
                        key={asset.id}
                        className="border-b border-indigo-50/60 hover:bg-indigo-50/40 transition-colors"
                      >
                        {/* Asset name + tag */}
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 leading-tight">{asset.name}</p>
                          {asset.asset_tag && (
                            <p className="text-xs font-mono text-gray-400 mt-0.5">{asset.asset_tag}</p>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-4 py-3 text-gray-600">
                          {asset.asset_categories?.name ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* Location */}
                        <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">
                          {location}
                        </td>

                        {/* Risk score */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${asset.failure_risk_score}%` }}
                              />
                            </div>
                            <span
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded ${risk.cls}`}
                            >
                              {risk.label}
                            </span>
                          </div>
                        </td>

                        {/* Warranty */}
                        <td className={`px-4 py-3 text-xs ${warranty.cls}`}>
                          {warranty.text}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              asset.is_active
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {asset.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <Button
                            variant="secondary"
                            onClick={() => setSelectedAssetId(asset.id)}
                            className="text-xs px-3 py-1.5"
                          >
                            View
                            <ChevronRight size={13} />
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-indigo-50/60 bg-indigo-50/40">
            <p className="text-xs text-gray-400">
              Showing {filtered.length} of {assets.length} assets
            </p>
          </div>
        )}
      </Card>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {selectedAssetId && (
        <AssetDetailModal
          assetId={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
          canEdit={canEdit}
        />
      )}

      <CreateAssetModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}
