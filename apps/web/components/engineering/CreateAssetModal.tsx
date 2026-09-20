'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, AlertTriangle, X, Loader2 } from 'lucide-react'
import { engineeringApi } from '@/lib/api/engineering'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface CreateAssetModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreateAssetModal({ isOpen, onClose, onSuccess }: CreateAssetModalProps) {
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
              <h2 className="text-base font-bold text-ink">{t('engineering.assetsPage.addAsset')}</h2>
            </div>
            {!saving && (
              <IconButton variant="ghost" onClick={onClose} aria-label={t('engineering.assetsPage.close')}>
                <X size={18} />
              </IconButton>
            )}
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="asset-create-name" className="block text-sm font-medium text-ink2 mb-1.5">
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
              <label htmlFor="asset-create-category-id" className="block text-sm font-medium text-ink2 mb-1.5">
                {t('engineering.assetsPage.createCategoryIdLabel')}{' '}
                <span className="text-ink3 font-normal">{t('engineering.assetsPage.createCategoryIdHint')}</span>
              </label>
              <Input
                id="asset-create-category-id"
                type="text"
                value={fields.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                placeholder={t('engineering.assetsPage.createCategoryIdPlaceholder')}
                className="font-mono"
              />
              <p className="text-xs text-ink3 mt-1">
                {t('engineering.assetsPage.createCategoryIdHelp')}
              </p>
            </div>

            {/* Location */}
            <div>
              <label htmlFor="asset-create-location" className="block text-sm font-medium text-ink2 mb-1.5">
                {t('engineering.assetsPage.createLocationLabel')}{' '}
                <span className="text-ink3 font-normal">{t('engineering.assetsPage.optional')}</span>
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
                <label htmlFor="asset-create-manufacturer" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.manufacturer')}</label>
                <Input
                  id="asset-create-manufacturer"
                  type="text"
                  value={fields.manufacturer}
                  onChange={(e) => set('manufacturer', e.target.value)}
                  placeholder={t('engineering.assetsPage.createManufacturerPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="asset-create-model" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.model')}</label>
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
              <label htmlFor="asset-create-serial" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.serialNumber')}</label>
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
                <label htmlFor="asset-create-purchase-date" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.purchaseDate')}</label>
                <Input
                  id="asset-create-purchase-date"
                  type="date"
                  value={fields.purchase_date}
                  onChange={(e) => set('purchase_date', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="asset-create-warranty-expires" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.createWarrantyExpiresLabel')}</label>
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
                <label htmlFor="asset-create-lifespan" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.fieldLifespan')}</label>
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
                <label htmlFor="asset-create-replacement-cost" className="block text-sm font-medium text-ink2 mb-1.5">{t('engineering.assetsPage.fieldReplacementCost')}</label>
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
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={saving || !fields.name.trim()}>
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
