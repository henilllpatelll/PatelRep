'use client'

// Engineering spare-parts inventory (migration 102) -- items, locations, and
// manual stock adjustments. Separate from housekeeping's linen/chemical/
// amenity par levels (components/programs/HousekeepingDepthPanels.tsx),
// which is a different table set entirely.

import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Boxes, MapPin, PackagePlus, PlusCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { StateBlock } from '@/components/ui/StateBlock'
import { useRole } from '@/lib/hooks/useRole'
import { inventoryApi, type CreatePartTransactionPayload } from '@/lib/api/inventory'

const LOCATIONS_KEY = ['engineering-part-locations']
const PARTS_KEY = ['engineering-parts']

export function PartsPanel({ redesigned }: { redesigned?: boolean }) {
  const { t } = useTranslation()
  const { canViewEngineering } = useRole()
  const isManager = canViewEngineering // matches routers/inventory.py's _MANAGER_ROLES (gm, engineer, chief_engineer)

  const queryClient = useQueryClient()
  const invalidateLocations = () => queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY })
  const invalidateParts = () => queryClient.invalidateQueries({ queryKey: PARTS_KEY })

  const locationsQuery = useQuery({
    queryKey: LOCATIONS_KEY,
    queryFn: () => inventoryApi.listLocations(),
    enabled: isManager,
  })
  const locations = locationsQuery.data?.data ?? []

  const partsQuery = useQuery({
    queryKey: PARTS_KEY,
    queryFn: () => inventoryApi.listParts(),
    enabled: isManager,
  })
  const parts = partsQuery.data?.data ?? []

  // ── Locations ────────────────────────────────────────────────────────────
  const [locationName, setLocationName] = useState('')
  const [locationParentId, setLocationParentId] = useState('')
  const createLocation = useMutation({
    mutationFn: inventoryApi.createLocation,
    onSuccess: () => {
      invalidateLocations()
      setLocationName('')
      setLocationParentId('')
    },
  })
  const submitLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!locationName.trim()) return
    createLocation.mutate({ name: locationName.trim(), parent_id: locationParentId || undefined })
  }

  // ── Parts ────────────────────────────────────────────────────────────────
  const [partForm, setPartForm] = useState({
    name: '', sku: '', category: '', unit: 'each', minimum_stock: 0, maximum_stock: '' as number | '',
  })
  const createPart = useMutation({
    mutationFn: inventoryApi.createPart,
    onSuccess: () => {
      invalidateParts()
      setPartForm({ name: '', sku: '', category: '', unit: 'each', minimum_stock: 0, maximum_stock: '' })
    },
  })
  const submitPart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!partForm.name.trim()) return
    createPart.mutate({
      name: partForm.name.trim(),
      sku: partForm.sku.trim() || undefined,
      category: partForm.category.trim() || undefined,
      unit: partForm.unit.trim() || 'each',
      minimum_stock: partForm.minimum_stock,
      maximum_stock: partForm.maximum_stock === '' ? undefined : Number(partForm.maximum_stock),
    })
  }

  // ── Stock adjustment ─────────────────────────────────────────────────────
  const [adjustForm, setAdjustForm] = useState({
    part_id: '', location_id: '', transaction_type: 'add' as CreatePartTransactionPayload['transaction_type'], quantity: 1,
  })
  const adjustStock = useMutation({
    mutationFn: () =>
      inventoryApi.createTransaction(adjustForm.part_id, {
        transaction_type: adjustForm.transaction_type,
        location_id: adjustForm.location_id,
        quantity: adjustForm.quantity,
      }),
    onSuccess: () => {
      invalidateParts()
      setAdjustForm((current) => ({ ...current, quantity: 1 }))
    },
  })
  const submitAdjust = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!adjustForm.part_id || !adjustForm.location_id || adjustForm.quantity < 0) return
    adjustStock.mutate()
  }

  // All hooks above must run unconditionally (Rules of Hooks) -- the
  // manager gate only affects what renders, never how many hooks fire.
  if (!isManager) return null

  const lowStockParts = parts.filter((part) => part.low_stock)

  return (
    <div className="space-y-4">
      {lowStockParts.length > 0 && (
        <Card className="border-alert-line bg-alert-soft p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-alert" />
            <div>
              <h2 className="font-semibold text-alert">{t('engineering.parts.lowStockTitle')}</h2>
              <div className="mt-2 space-y-1.5">
                {lowStockParts.map((part) => (
                  <div key={part.id} className="flex items-center justify-between gap-2 text-sm text-alert">
                    <span className="font-medium">{part.name}</span>
                    <span>{t('engineering.parts.onHandOfMin', { onHand: part.total_on_hand ?? 0, min: part.minimum_stock })}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 text-accent" />
            <div>
              <h2 className="font-semibold text-ink">{t('engineering.parts.locationsTitle')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('engineering.parts.locationsSubtitle')}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {locations.map((location) => (
              <div key={location.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
                <p className="font-medium text-ink">{location.name}</p>
                {location.parent_id ? (
                  <p className="text-ink3">{locations.find((l) => l.id === location.parent_id)?.name}</p>
                ) : null}
              </div>
            ))}
            {!locations.length && !locationsQuery.isLoading ? (
              redesigned ? (
                <StateBlock status="empty" empty={{ title: t('engineering.parts.noLocations') }} />
              ) : (
                <p className="text-sm text-ink3">{t('engineering.parts.noLocations')}</p>
              )
            ) : null}
          </div>
          <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitLocation}>
            <Input
              aria-label={t('engineering.parts.locationNamePlaceholder')}
              placeholder={t('engineering.parts.locationNamePlaceholder')}
              value={locationName}
              onChange={(event) => setLocationName(event.target.value)}
              className="min-h-11"
            />
            <select
              aria-label={t('engineering.parts.parentLocation')}
              value={locationParentId}
              onChange={(event) => setLocationParentId(event.target.value)}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">{t('engineering.parts.noParentLocation')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <Button type="submit" disabled={createLocation.isPending} className="min-h-11 sm:col-span-2">
              <MapPin className="h-4 w-4" /> {t('engineering.parts.addLocation')}
            </Button>
          </form>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Boxes className="mt-0.5 h-5 w-5 text-accent" />
            <div>
              <h2 className="font-semibold text-ink">{t('engineering.parts.partsTitle')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('engineering.parts.partsSubtitle')}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {parts.map((part) => (
              <div key={part.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-ink">{part.name}</p>
                  <p className="text-ink3">{t('engineering.parts.onHand', { qty: part.total_on_hand ?? 0, unit: part.unit })}</p>
                </div>
                {part.low_stock ? (
                  <span className="shrink-0 rounded-full bg-alert-soft px-2 py-0.5 text-xs font-medium text-alert">
                    {t('engineering.parts.lowStockBadge')}
                  </span>
                ) : null}
              </div>
            ))}
            {!parts.length && !partsQuery.isLoading ? (
              redesigned ? (
                <StateBlock status="empty" empty={{ title: t('engineering.parts.noParts') }} />
              ) : (
                <p className="text-sm text-ink3">{t('engineering.parts.noParts')}</p>
              )
            ) : null}
          </div>
          <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitPart}>
            <Input
              aria-label={t('engineering.parts.partNamePlaceholder')}
              placeholder={t('engineering.parts.partNamePlaceholder')}
              value={partForm.name}
              onChange={(event) => setPartForm((current) => ({ ...current, name: event.target.value }))}
              className="min-h-11 sm:col-span-2"
            />
            <Input
              aria-label={t('engineering.parts.skuPlaceholder')}
              placeholder={t('engineering.parts.skuPlaceholder')}
              value={partForm.sku}
              onChange={(event) => setPartForm((current) => ({ ...current, sku: event.target.value }))}
              className="min-h-11"
            />
            <Input
              aria-label={t('engineering.parts.unitPlaceholder')}
              placeholder={t('engineering.parts.unitPlaceholder')}
              value={partForm.unit}
              onChange={(event) => setPartForm((current) => ({ ...current, unit: event.target.value }))}
              className="min-h-11"
            />
            <label className="text-sm text-ink2">
              {t('engineering.parts.minimumStockLabel')}
              <Input
                type="number" min={0} value={partForm.minimum_stock}
                onChange={(event) => setPartForm((current) => ({ ...current, minimum_stock: Number(event.target.value) }))}
                className="mt-1 min-h-11"
              />
            </label>
            <label className="text-sm text-ink2">
              {t('engineering.parts.maximumStockLabel')}
              <Input
                type="number" min={0} value={partForm.maximum_stock}
                onChange={(event) => setPartForm((current) => ({ ...current, maximum_stock: event.target.value === '' ? '' : Number(event.target.value) }))}
                className="mt-1 min-h-11"
              />
            </label>
            <Button type="submit" disabled={createPart.isPending} className="min-h-11 sm:col-span-2">
              <PlusCircle className="h-4 w-4" /> {t('engineering.parts.addPart')}
            </Button>
          </form>
        </Card>
      </section>

      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <PackagePlus className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold text-ink">{t('engineering.parts.adjustStockTitle')}</h2>
            <p className="mt-1 text-sm text-ink3">{t('engineering.parts.adjustStockSubtitle')}</p>
          </div>
        </div>
        <form className="mt-4 grid gap-2 sm:grid-cols-4" onSubmit={submitAdjust}>
          <select
            aria-label={t('engineering.parts.partsTitle')}
            value={adjustForm.part_id}
            onChange={(event) => setAdjustForm((current) => ({ ...current, part_id: event.target.value }))}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="">{t('engineering.parts.choosePart')}</option>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>{part.name}</option>
            ))}
          </select>
          <select
            aria-label={t('engineering.parts.locationsTitle')}
            value={adjustForm.location_id}
            onChange={(event) => setAdjustForm((current) => ({ ...current, location_id: event.target.value }))}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="">{t('engineering.parts.chooseLocation')}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
          <select
            aria-label={t('engineering.parts.transactionType')}
            value={adjustForm.transaction_type}
            onChange={(event) => setAdjustForm((current) => ({ ...current, transaction_type: event.target.value as CreatePartTransactionPayload['transaction_type'] }))}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="add">{t('engineering.parts.txnAdd')}</option>
            <option value="remove">{t('engineering.parts.txnRemove')}</option>
            <option value="count">{t('engineering.parts.txnCount')}</option>
          </select>
          <Input
            aria-label={t('engineering.parts.quantityLabel')}
            type="number" min={0} value={adjustForm.quantity}
            onChange={(event) => setAdjustForm((current) => ({ ...current, quantity: Number(event.target.value) }))}
            className="min-h-11"
          />
          {adjustStock.isError && (
            <p className="text-sm text-alert sm:col-span-4">{t('engineering.parts.adjustError')}</p>
          )}
          <Button type="submit" disabled={adjustStock.isPending} className="min-h-11 sm:col-span-4">
            <PackagePlus className="h-4 w-4" /> {t('engineering.parts.applyAdjustment')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
