'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Search, ChevronRight, Plus } from 'lucide-react'
import { engineeringApi, type Asset } from '@/lib/api/engineering'
import { getRiskBadge, getRiskTone, getWarrantyLabel } from '@/lib/utils/engineering'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { Pill, Bar, Stat } from '@/components/ui/primitives'
import { AssetDetailModal } from '@/components/engineering/AssetDetailModal'
import { CreateAssetModal } from '@/components/engineering/CreateAssetModal'

type RiskFilter = 'all' | 'highRisk' | 'medium' | 'low'

function getRiskFilters(t: TFunction): { key: RiskFilter; label: string }[] {
  return [
    { key: 'all', label: t('engineering.assetsPage.filterAll') },
    { key: 'highRisk', label: t('engineering.assetsPage.filterHighRisk') },
    { key: 'medium', label: t('engineering.assetsPage.filterMedium') },
    { key: 'low', label: t('engineering.assetsPage.filterLow') },
  ]
}

function formatCurrency(value?: number): string {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function SkeletonRow() {
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

interface AssetsTabProps {
  canEdit: boolean
  showCreateModal: boolean
  onCloseCreateModal: () => void
  onRequestCreate: () => void
}

export function AssetsTab({ canEdit, showCreateModal, onCloseCreateModal, onRequestCreate }: AssetsTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const RISK_FILTERS = getRiskFilters(t)

  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  const { data: assetsData, isLoading, isError } = useQuery({
    queryKey: ['assets'],
    queryFn: () => engineeringApi.listAssets(),
    select: (res) => res.data as Asset[],
  })

  const assets = assetsData ?? []

  const activeAssets = assets.filter((a) => a.is_active)
  const highRiskCount = assets.filter((a) => a.failure_risk_score >= 70).length
  const underWarrantyCount = assets.filter(
    (a) => a.warranty_expires && new Date(a.warranty_expires) > new Date(),
  ).length
  const totalValue = assets.reduce((sum, a) => sum + (a.replacement_cost ?? 0), 0)

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
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('engineering.assetsPage.statTotalAssets')} value={activeAssets.length} hint={t('engineering.assetsPage.statActive')} />
        <Stat
          label={t('engineering.assetsPage.statHighRisk')}
          value={<span className={highRiskCount > 0 ? 'text-[var(--alert)]' : undefined}>{highRiskCount}</span>}
          hint={t('engineering.assetsPage.statHighRiskSub')}
        />
        <Stat
          label={t('engineering.assetsPage.statUnderWarranty')}
          value={underWarrantyCount}
          hint={t('engineering.assetsPage.statUnderWarrantySub')}
        />
        <Stat
          label={t('engineering.assetsPage.statTotalValue')}
          value={formatCurrency(totalValue)}
          hint={t('engineering.assetsPage.statTotalValueSub')}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
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
                  : 'bg-surface/70 border border-[var(--caution-line)]/40 backdrop-blur-sm text-ink2 hover:bg-[var(--caution-soft)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          <StateBlock
            status="error"
            error={{
              message: t('engineering.assetsPage.loadError'),
              onRetry: () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 bg-[var(--caution-soft)]/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.colAsset')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.category')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.location')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.colRiskScore')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.warranty')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                    {t('engineering.assetsPage.colStatus')}
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-14 text-sm text-ink3">
                      {assets.length === 0 ? (
                        <div className="mx-auto max-w-2xl">
                          <p className="text-[14px] font-medium text-ink">
                            {t('engineering.assetsPage.emptyHeading')}
                          </p>
                          <p className="mt-1 text-[13px] leading-relaxed text-ink3">
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
                            <Button variant="primary" onClick={onRequestCreate} className="mt-5">
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
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink leading-tight">{asset.name}</p>
                          {asset.asset_tag && (
                            <p className="text-xs font-mono text-ink3 mt-0.5">{asset.asset_tag}</p>
                          )}
                        </td>

                        <td className="px-4 py-3 text-ink2">
                          {asset.asset_categories?.name ?? <span className="text-ink4">—</span>}
                        </td>

                        <td className="px-4 py-3 text-ink2 max-w-[160px] truncate">
                          {location}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Bar value={asset.failure_risk_score} tone={getRiskTone(asset.failure_risk_score)} className="w-20 shrink-0" />
                            <Pill tone={risk.tone} size="sm">{risk.label}</Pill>
                          </div>
                        </td>

                        <td className={`px-4 py-3 text-xs ${warranty.cls}`}>
                          {warranty.text}
                        </td>

                        <td className="px-4 py-3">
                          <Pill tone={asset.is_active ? 'ready' : 'neutral'} size="sm">
                            {asset.is_active ? t('engineering.assetsPage.active') : t('engineering.assetsPage.inactive')}
                          </Pill>
                        </td>

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

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-[var(--caution-line)] bg-[var(--caution-soft)]/40">
            <p className="text-xs text-ink3">
              {t('engineering.assetsPage.footerCount', { filtered: filtered.length, total: assets.length })}
            </p>
          </div>
        )}
      </Card>

      {/* Modals */}
      {selectedAssetId && (
        <AssetDetailModal
          assetId={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
          canEdit={canEdit}
        />
      )}

      <CreateAssetModal
        isOpen={showCreateModal}
        onClose={onCloseCreateModal}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}
