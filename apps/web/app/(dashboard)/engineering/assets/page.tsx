'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  X,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { engineeringApi, Asset, PMSchedule } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/shared/PageHeader'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'

// ─── Constants ────────────────────────────────────────────────────────────────

type RiskFilter = 'all' | 'highRisk' | 'medium' | 'low'

function getRiskFilters(t: TFunction): { key: RiskFilter; label: string }[] {
  return [
    { key: 'all', label: t('engineering.assetsPage.filterAll') },
    { key: 'highRisk', label: t('engineering.assetsPage.filterHighRisk') },
    { key: 'medium', label: t('engineering.assetsPage.filterMedium') },
    { key: 'low', label: t('engineering.assetsPage.filterLow') },
  ]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskBadge(score: number, t: TFunction): { label: string; cls: string } {
  if (score >= 70) return { label: t('engineering.failurePrediction.riskHigh'), cls: 'bg-[var(--alert-soft)] text-red-700 border border-red-200' }
  if (score >= 40) return { label: t('engineering.failurePrediction.riskMedium'), cls: 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]' }
  return { label: t('engineering.failurePrediction.riskLow'), cls: 'bg-blue-50 text-blue-700 border border-blue-200' }
}

function getRiskBarColor(score: number): string {
  if (score >= 70) return 'bg-[var(--alert)]'
  if (score >= 40) return 'bg-orange-400'
  return 'bg-[var(--ready)]'
}

function getWarrantyLabel(warrantyExpires: string | undefined, t: TFunction): { text: string; cls: string } {
  if (!warrantyExpires) return { text: t('engineering.assetsPage.noWarranty'), cls: 'text-gray-400' }
  const expiry = new Date(warrantyExpires)
  const now = new Date()
  if (expiry < now) return { text: t('engineering.assetsPage.warrantyExpired'), cls: 'text-[var(--alert)] font-medium' }
  return {
    text: t('engineering.assetsPage.warrantyExpires', { date: format(expiry, 'MM/yyyy') }),
    cls: 'text-green-700',
  }
}

function formatCurrency(value?: number): string {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ v2 }: { v2: boolean }) {
  if (v2) {
    return (
      <tr className="animate-pulse border-b border-[var(--caution-line)]">
        <td className="px-4 py-3">
          <Skeleton variant="text" className="h-4 w-3/4 mb-1.5" />
          <Skeleton variant="text" className="h-3 w-1/3" />
        </td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-4 w-20" /></td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-4 w-24" /></td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-4 w-28" /></td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-4 w-24" /></td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-5 w-16" /></td>
        <td className="px-4 py-3"><Skeleton variant="text" className="h-7 w-14" /></td>
      </tr>
    )
  }
  return (
    <tr className="animate-pulse border-b border-[var(--caution-line)]">
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
      ? 'text-[var(--alert)]'
      : accent === 'green'
        ? 'text-[var(--ready)]'
        : 'text-gray-900'
  return (
    <Card className={`px-5 py-4${accent === 'red' ? ' border-red-200 bg-[var(--alert-soft)]' : ''}`}>
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
  const { t } = useTranslation()
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
      setSaveError(err instanceof Error ? err.message : t('engineering.assetsPage.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const risk = data ? getRiskBadge(data.failure_risk_score, t) : null
  const warranty = data ? getWarrantyLabel(data.warranty_expires, t) : null
  const pmSchedules: PMSchedule[] = (data as (Asset & { pm_schedules?: PMSchedule[] }) | undefined)?.pm_schedules ?? []

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-surface/[0.88] backdrop-blur-2xl border-b border-white/60 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--caution-soft)] flex items-center justify-center shrink-0">
                <Package size={16} className="text-[var(--caution)]" />
              </div>
              <h2 className="text-base font-bold text-gray-900">
                {isLoading ? t('engineering.assetsPage.detailLoading') : (data?.name ?? t('engineering.assetsPage.detailFallbackHeading'))}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && data && !editMode && (
                <Button
                  variant="secondary"
                  onClick={startEdit}
                  className="px-3 py-1.5 text-sm"
                >
                  {t('engineering.assetsPage.edit')}
                </Button>
              )}
              <IconButton
                variant="ghost"
                onClick={onClose}
                disabled={saving}
                aria-label={t('engineering.assetsPage.close')}
              >
                <X size={18} />
              </IconButton>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : !data ? (
            <div className="p-6 text-center text-sm text-gray-500">{t('engineering.assetsPage.loadDetailError')}</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Risk + Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                {risk && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${risk.cls}`}>
                    <AlertTriangle size={12} />
                    {risk.label} {t('engineering.assetsPage.riskSuffix', { score: data.failure_risk_score })}
                  </span>
                )}
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                    data.is_active
                      ? 'bg-[var(--ready-soft)] text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {data.is_active ? t('engineering.assetsPage.active') : t('engineering.assetsPage.inactive')}
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
                      <label htmlFor={`asset-edit-name-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.name')}</label>
                      <Input
                        id={`asset-edit-name-${assetId}`}
                        type="text"
                        value={editFields.name ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-location-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.location')}</label>
                      <Input
                        id={`asset-edit-location-${assetId}`}
                        type="text"
                        value={editFields.location_text ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, location_text: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-manufacturer-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.manufacturer')}</label>
                      <Input
                        id={`asset-edit-manufacturer-${assetId}`}
                        type="text"
                        value={editFields.manufacturer ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, manufacturer: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-model-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.model')}</label>
                      <Input
                        id={`asset-edit-model-${assetId}`}
                        type="text"
                        value={editFields.model ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, model: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-serial-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.serialNumber')}</label>
                      <Input
                        id={`asset-edit-serial-${assetId}`}
                        type="text"
                        value={editFields.serial_number ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, serial_number: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-replacement-cost-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.fieldReplacementCost')}</label>
                      <Input
                        id={`asset-edit-replacement-cost-${assetId}`}
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
                      <label htmlFor={`asset-edit-lifespan-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.fieldLifespan')}</label>
                      <Input
                        id={`asset-edit-lifespan-${assetId}`}
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
                    <label htmlFor={`asset-edit-notes-${assetId}`} className="block text-xs font-medium text-gray-600 mb-1">{t('engineering.assetsPage.notes')}</label>
                    <textarea
                      id={`asset-edit-notes-${assetId}`}
                      rows={3}
                      value={editFields.notes ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors resize-none"
                    />
                  </div>
                  {saveError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-red-200 text-sm text-red-700">
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
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          {t('engineering.assetsPage.saving')}
                        </>
                      ) : (
                        t('engineering.assetsPage.saveChanges')
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Read-only detail ── */
                <>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <DetailRow label={t('engineering.assetsPage.category')} value={data.asset_categories?.name ?? '—'} />
                    <DetailRow
                      label={t('engineering.assetsPage.location')}
                      value={data.rooms?.room_number ? `${t('engineering.workOrderCard.room')} ${data.rooms.room_number}` : (data.location_text ?? '—')}
                    />
                    <DetailRow label={t('engineering.assetsPage.manufacturer')} value={data.manufacturer ?? '—'} />
                    <DetailRow label={t('engineering.assetsPage.model')} value={data.model ?? '—'} />
                    <DetailRow label={t('engineering.assetsPage.serialNumber')} value={data.serial_number ?? '—'} mono />
                    <DetailRow
                      label={t('engineering.assetsPage.purchaseDate')}
                      value={data.purchase_date ? format(new Date(data.purchase_date), 'MMM d, yyyy') : '—'}
                    />
                    <DetailRow
                      label={t('engineering.assetsPage.installationDate')}
                      value={data.installation_date ? format(new Date(data.installation_date), 'MMM d, yyyy') : '—'}
                    />
                    <DetailRow
                      label={t('engineering.assetsPage.warranty')}
                      value={warranty?.text ?? '—'}
                      valueClass={warranty?.cls}
                    />
                    <DetailRow
                      label={t('engineering.assetsPage.detailLifespan')}
                      value={data.expected_lifespan_years != null ? t('engineering.assetsPage.detailLifespanValue', { years: data.expected_lifespan_years }) : '—'}
                    />
                    <DetailRow label={t('engineering.assetsPage.detailReplacementCost')} value={formatCurrency(data.replacement_cost)} />
                  </div>

                  {data.notes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">{t('engineering.assetsPage.notes')}</p>
                      <p className="text-sm text-gray-700 bg-[var(--caution-soft)]/40 rounded-lg px-4 py-3">{data.notes}</p>
                    </div>
                  )}
                </>
              )}

              {/* PM Schedules section */}
              {!editMode && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    {t('engineering.assetsPage.pmSchedulesHeading', { count: pmSchedules.length })}
                  </p>
                  {pmSchedules.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">{t('engineering.assetsPage.noPmSchedules')}</p>
                  ) : (
                    <div className="space-y-2">
                      {pmSchedules.map((pm) => {
                        const isOverdue = new Date(pm.next_due_at) < new Date()
                        return (
                          <div
                            key={pm.id}
                            className="flex items-center justify-between px-4 py-3 bg-[var(--caution-soft)]/40 rounded-lg border border-amber-100/60"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">{pm.name}</p>
                              <p className="text-xs text-gray-500 mt-0.5 capitalize">
                                {pm.interval_type}
                                {pm.interval_days ? ` ${t('engineering.assetsPage.pmIntervalDays', { days: pm.interval_days })}` : ''} •{' '}
                                {t('engineering.assetsPage.pmMinutesSuffix', { minutes: pm.estimated_minutes })}
                              </p>
                            </div>
                            <div className="text-right shrink-0 ml-4">
                              <p
                                className={`text-xs font-medium ${
                                  isOverdue ? 'text-[var(--alert)]' : 'text-gray-600'
                                }`}
                              >
                                {isOverdue ? t('engineering.assetsPage.pmOverdue') : t('engineering.assetsPage.pmDue')}{' '}
                                {format(new Date(pm.next_due_at), 'MMM d, yyyy')}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {pm.last_completed_at
                                  ? t('engineering.assetsPage.pmLastDone', { date: format(new Date(pm.last_completed_at), 'MMM d, yyyy') })
                                  : t('engineering.assetsPage.pmNeverCompleted')}
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
  const { t } = useTranslation()
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
      setError(t('engineering.assetsPage.createNameRequired'))
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
      setError(err instanceof Error ? err.message : t('engineering.assetsPage.createError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('engineering.assetsPage.createAriaLabel')}
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--caution)] flex items-center justify-center shrink-0">
                <Plus size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">{t('engineering.assetsPage.addAsset')}</h2>
            </div>
            {!saving && (
              <IconButton
                variant="ghost"
                onClick={onClose}
                aria-label={t('engineering.assetsPage.close')}
              >
                <X size={18} />
              </IconButton>
            )}
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="asset-create-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('engineering.assetsPage.createNameLabel')} <span className="text-[var(--alert)]">*</span>
              </label>
              <Input
                id="asset-create-name"
                type="text"
                value={fields.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('engineering.assetsPage.createNamePlaceholder')}
              />
            </div>

            {/* Category ID */}
            <div>
              <label htmlFor="asset-create-category-id" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('engineering.assetsPage.createCategoryIdLabel')}{' '}
                <span className="text-gray-400 font-normal">{t('engineering.assetsPage.createCategoryIdHint')}</span>
              </label>
              <Input
                id="asset-create-category-id"
                type="text"
                value={fields.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                placeholder={t('engineering.assetsPage.createCategoryIdPlaceholder')}
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                {t('engineering.assetsPage.createCategoryIdHelp')}
              </p>
            </div>

            {/* Location */}
            <div>
              <label htmlFor="asset-create-location" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('engineering.assetsPage.createLocationLabel')}{' '}
                <span className="text-gray-400 font-normal">{t('engineering.assetsPage.optional')}</span>
              </label>
              <Input
                id="asset-create-location"
                type="text"
                value={fields.location_text}
                onChange={(e) => set('location_text', e.target.value)}
                placeholder={t('engineering.assetsPage.createLocationPlaceholder')}
              />
            </div>

            {/* Manufacturer + Model */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="asset-create-manufacturer" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.manufacturer')}</label>
                <Input
                  id="asset-create-manufacturer"
                  type="text"
                  value={fields.manufacturer}
                  onChange={(e) => set('manufacturer', e.target.value)}
                  placeholder={t('engineering.assetsPage.createManufacturerPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="asset-create-model" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.model')}</label>
                <Input
                  id="asset-create-model"
                  type="text"
                  value={fields.model}
                  onChange={(e) => set('model', e.target.value)}
                  placeholder={t('engineering.assetsPage.createModelPlaceholder')}
                />
              </div>
            </div>

            {/* Serial */}
            <div>
              <label htmlFor="asset-create-serial" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.serialNumber')}</label>
              <Input
                id="asset-create-serial"
                type="text"
                value={fields.serial_number}
                onChange={(e) => set('serial_number', e.target.value)}
                placeholder={t('engineering.assetsPage.createSerialPlaceholder')}
                className="font-mono"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="asset-create-purchase-date" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.purchaseDate')}</label>
                <Input
                  id="asset-create-purchase-date"
                  type="date"
                  value={fields.purchase_date}
                  onChange={(e) => set('purchase_date', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="asset-create-warranty-expires" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.createWarrantyExpiresLabel')}</label>
                <Input
                  id="asset-create-warranty-expires"
                  type="date"
                  value={fields.warranty_expires}
                  onChange={(e) => set('warranty_expires', e.target.value)}
                />
              </div>
            </div>

            {/* Lifespan + Cost */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="asset-create-lifespan" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.fieldLifespan')}</label>
                <Input
                  id="asset-create-lifespan"
                  type="number"
                  min={0}
                  value={fields.expected_lifespan_years}
                  onChange={(e) => set('expected_lifespan_years', e.target.value)}
                  placeholder={t('engineering.assetsPage.createLifespanPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="asset-create-replacement-cost" className="block text-sm font-medium text-gray-700 mb-1.5">{t('engineering.assetsPage.fieldReplacementCost')}</label>
                <Input
                  id="asset-create-replacement-cost"
                  type="number"
                  min={0}
                  value={fields.replacement_cost}
                  onChange={(e) => set('replacement_cost', e.target.value)}
                  placeholder={t('engineering.assetsPage.createCostPlaceholder')}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-red-200 text-sm text-red-700">
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
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={saving || !fields.name.trim()}
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {t('engineering.assetsPage.creating')}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {t('engineering.assetsPage.addAsset')}
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
  const { t } = useTranslation()
  const { isGM, role } = useRole()
  const canEdit = isGM || role === 'engineer'
  const queryClient = useQueryClient()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)

  const RISK_FILTERS = getRiskFilters(t)

  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
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
      riskFilter === 'all' ||
      (riskFilter === 'highRisk' && a.failure_risk_score >= 70) ||
      (riskFilter === 'medium' && a.failure_risk_score >= 40 && a.failure_risk_score < 70) ||
      (riskFilter === 'low' && a.failure_risk_score < 40)

    return matchesSearch && matchesRisk
  })

  function handleCreateSuccess() {
    queryClient.invalidateQueries({ queryKey: ['assets'] })
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        eyebrow="Engineering"
        title={t('engineering.assetsPage.heading')}
        subtitle={t('engineering.assetsPage.subtitle')}
        dataI18nSkip={v2}
        actions={canEdit && (
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            className="shrink-0"
          >
            <Plus size={15} />
            {t('engineering.assetsPage.addAsset')}
          </Button>
        )}
      />

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('engineering.assetsPage.statTotalAssets')} value={activeAssets.length} sub={t('engineering.assetsPage.statActive')} />
        <StatCard
          label={t('engineering.assetsPage.statHighRisk')}
          value={highRiskCount}
          sub={t('engineering.assetsPage.statHighRiskSub')}
          accent={highRiskCount > 0 ? 'red' : 'default'}
        />
        <StatCard
          label={t('engineering.assetsPage.statUnderWarranty')}
          value={underWarrantyCount}
          sub={t('engineering.assetsPage.statUnderWarrantySub')}
          accent="green"
        />
        <StatCard
          label={t('engineering.assetsPage.statTotalValue')}
          value={formatCurrency(totalValue)}
          sub={t('engineering.assetsPage.statTotalValueSub')}
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
            aria-label={t('engineering.assetsPage.searchAriaLabel')}
            placeholder={t('engineering.assetsPage.searchPlaceholder')}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {RISK_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setRiskFilter(f.key)}
              aria-pressed={riskFilter === f.key}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                riskFilter === f.key
                  ? 'bg-[var(--caution)] text-white'
                  : 'bg-surface/70 border border-[var(--caution-line)]/40 backdrop-blur-sm text-gray-700 hover:bg-[var(--caution-soft)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          v2 ? (
            <StateBlock
              status="error"
              error={{
                message: t('engineering.assetsPage.loadError'),
                onRetry: () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center p-6">
              <AlertTriangle size={28} className="text-red-400 mb-3" />
              <p className="text-sm font-medium text-gray-700 mb-1">{t('engineering.assetsPage.loadError')}</p>
              <Button
                variant="primary"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['assets'] })}
                className="mt-2"
              >
                {t('engineering.assetsPage.retry')}
              </Button>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 bg-[var(--caution-soft)]/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.colAsset')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.category')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.location')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.colRiskScore')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.warranty')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('engineering.assetsPage.colStatus')}
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} v2={v2} />)
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-14 text-sm text-gray-400">
                      {assets.length === 0 ? (
                        <div className="mx-auto max-w-2xl">
                          <p className="text-sm font-semibold text-gray-700">{t('engineering.assetsPage.emptyHeading')}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {t('engineering.assetsPage.emptyHelp')}
                          </p>
                          <div className="mt-5 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
                            {[
                              t('engineering.assetsPage.emptySampleHvac'),
                              t('engineering.assetsPage.emptySampleLaundry'),
                              t('engineering.assetsPage.emptySampleElevators'),
                            ].map((item) => (
                              <div key={item} className="rounded-xl border border-amber-100 bg-[var(--caution-soft)]/50 px-4 py-3">
                                <p className="text-sm font-semibold text-ink">{item}</p>
                                <p className="mt-1 text-xs text-ink3">{t('engineering.assetsPage.emptySampleSub')}</p>
                              </div>
                            ))}
                          </div>
                          {canEdit && (
                            <Button variant="primary" onClick={() => setShowCreateModal(true)} className="mt-5">
                              <Plus size={14} />
                              {t('engineering.assetsPage.addAsset')}
                            </Button>
                          )}
                        </div>
                      ) : (
                        t('engineering.assetsPage.noMatchFilters')
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map((asset) => {
                    const risk = getRiskBadge(asset.failure_risk_score, t)
                    const barColor = getRiskBarColor(asset.failure_risk_score)
                    const warranty = getWarrantyLabel(asset.warranty_expires, t)
                    const location = asset.rooms?.room_number
                      ? `${t('engineering.workOrderCard.room')} ${asset.rooms.room_number}`
                      : (asset.location_text ?? '—')
                    return (
                      <tr
                        key={asset.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedAssetId(asset.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedAssetId(asset.id)
                          }
                        }}
                        className="border-b border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400"
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
                                ? 'bg-[var(--ready-soft)] text-green-700 border border-green-200'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {asset.is_active ? t('engineering.assetsPage.active') : t('engineering.assetsPage.inactive')}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <Button
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedAssetId(asset.id)
                            }}
                            className="text-xs px-3 py-1.5"
                          >
                            {t('engineering.assetsPage.viewButton')}
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
          <div className="px-4 py-2.5 border-t border-[var(--caution-line)] bg-[var(--caution-soft)]/40">
            <p className="text-xs text-gray-400">
              {t('engineering.assetsPage.footerCount', { filtered: filtered.length, total: assets.length })}
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
