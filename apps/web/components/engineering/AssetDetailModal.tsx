'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Package, AlertTriangle, X, Loader2 } from 'lucide-react'
import { engineeringApi, type Asset, type PMSchedule } from '@/lib/api/engineering'
import { getRiskBadge, getWarrantyLabel } from '@/lib/utils/engineering'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'

function formatCurrency(value?: number): string {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
      <p className="text-xs text-ink3">{label}</p>
      <p className={`text-sm font-medium text-ink mt-0.5 ${mono ? 'font-mono' : ''} ${valueClass ?? ''}`}>
        {value}
      </p>
    </div>
  )
}

interface AssetDetailModalProps {
  assetId: string
  onClose: () => void
  canEdit: boolean
}

export function AssetDetailModal({ assetId, onClose, canEdit }: AssetDetailModalProps) {
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
              <h2 className="text-base font-bold text-ink">
                {isLoading ? t('engineering.assetsPage.detailLoading') : (data?.name ?? t('engineering.assetsPage.detailFallbackHeading'))}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && data && !editMode && (
                <Button variant="secondary" onClick={startEdit} className="px-3 py-1.5 text-sm">
                  {t('engineering.assetsPage.edit')}
                </Button>
              )}
              <IconButton variant="ghost" onClick={onClose} disabled={saving} aria-label={t('engineering.assetsPage.close')}>
                <X size={18} />
              </IconButton>
            </div>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton variant="text" className="h-6 w-24 rounded-full" />
                <Skeleton variant="text" className="h-6 w-20 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton variant="text" className="h-3 w-16" />
                    <Skeleton variant="text" className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </div>
          ) : !data ? (
            <div className="p-6 text-center text-sm text-ink3">{t('engineering.assetsPage.loadDetailError')}</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Risk + Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                {risk && (
                  <Pill tone={risk.tone} size="md">
                    <AlertTriangle size={12} />
                    {risk.label} {t('engineering.assetsPage.riskSuffix', { score: data.failure_risk_score })}
                  </Pill>
                )}
                <Pill tone={data.is_active ? 'ready' : 'neutral'} size="md">
                  {data.is_active ? t('engineering.assetsPage.active') : t('engineering.assetsPage.inactive')}
                </Pill>
                {data.asset_tag && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-surface-2 border border-line-2 text-ink3">
                    {data.asset_tag}
                  </span>
                )}
              </div>

              {editMode ? (
                /* ── Edit form ── */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`asset-edit-name-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.name')}</label>
                      <Input
                        id={`asset-edit-name-${assetId}`}
                        type="text"
                        value={editFields.name ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-location-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.location')}</label>
                      <Input
                        id={`asset-edit-location-${assetId}`}
                        type="text"
                        value={editFields.location_text ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, location_text: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-manufacturer-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.manufacturer')}</label>
                      <Input
                        id={`asset-edit-manufacturer-${assetId}`}
                        type="text"
                        value={editFields.manufacturer ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, manufacturer: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-model-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.model')}</label>
                      <Input
                        id={`asset-edit-model-${assetId}`}
                        type="text"
                        value={editFields.model ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, model: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-serial-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.serialNumber')}</label>
                      <Input
                        id={`asset-edit-serial-${assetId}`}
                        type="text"
                        value={editFields.serial_number ?? ''}
                        onChange={(e) => setEditFields((f) => ({ ...f, serial_number: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor={`asset-edit-replacement-cost-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.fieldReplacementCost')}</label>
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
                      <label htmlFor={`asset-edit-lifespan-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.fieldLifespan')}</label>
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
                    <label htmlFor={`asset-edit-notes-${assetId}`} className="block text-xs font-medium text-ink2 mb-1">{t('engineering.assetsPage.notes')}</label>
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
                    <Button variant="ghost" onClick={() => setEditMode(false)} disabled={saving}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" onClick={handleSave} disabled={saving}>
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
                      <p className="text-xs font-medium text-ink3 uppercase tracking-wide mb-1.5">{t('engineering.assetsPage.notes')}</p>
                      <p className="text-sm text-ink2 bg-[var(--caution-soft)]/40 rounded-lg px-4 py-3">{data.notes}</p>
                    </div>
                  )}
                </>
              )}

              {/* PM Schedules section */}
              {!editMode && (
                <div>
                  <p className="text-xs font-medium text-ink3 uppercase tracking-wide mb-2">
                    {t('engineering.assetsPage.pmSchedulesHeading', { count: pmSchedules.length })}
                  </p>
                  {pmSchedules.length === 0 ? (
                    <p className="text-sm text-ink3 italic">{t('engineering.assetsPage.noPmSchedules')}</p>
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
                              <p className="text-sm font-medium text-ink">{pm.name}</p>
                              <p className="text-xs text-ink3 mt-0.5 capitalize">
                                {pm.interval_type}
                                {pm.interval_days ? ` ${t('engineering.assetsPage.pmIntervalDays', { days: pm.interval_days })}` : ''} •{' '}
                                {t('engineering.assetsPage.pmMinutesSuffix', { minutes: pm.estimated_minutes })}
                              </p>
                            </div>
                            <div className="text-right shrink-0 ml-4">
                              <p className={`text-xs font-medium ${isOverdue ? 'text-[var(--alert)]' : 'text-ink2'}`}>
                                {isOverdue ? t('engineering.assetsPage.pmOverdue') : t('engineering.assetsPage.pmDue')}{' '}
                                {format(new Date(pm.next_due_at), 'MMM d, yyyy')}
                              </p>
                              <p className="text-xs text-ink3 mt-0.5">
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
