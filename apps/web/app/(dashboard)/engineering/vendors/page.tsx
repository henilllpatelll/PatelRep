'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Phone, Plus, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { engineeringApi, type VendorTrade } from '@/lib/api/engineering'
import { Button } from '@/components/ui/Button'
import { EngineeringDrawer } from '@/components/engineering/EngineeringDrawer'
import { StateBlock } from '@/components/ui/StateBlock'

const TRADES: VendorTrade[] = ['hvac', 'plumbing', 'electrical', 'elevator', 'fire_life_safety', 'pool', 'roofing', 'locksmith_doors', 'appliance', 'laundry_equipment', 'refrigeration', 'general_contractor', 'landscaping', 'pest_control', 'other']
const formatTrade = (trade: string) => trade.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export default function VendorsPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [trade, setTrade] = useState<VendorTrade | ''>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState({ name: '', trade: 'hvac' as VendorTrade, contact_name: '', phone: '', email: '', emergency_phone: '', insurance_expires_at: '', offers_24h_service: false, notes: '' })
  const vendors = useQuery({ queryKey: ['engineering-vendors', search, trade], queryFn: () => engineeringApi.listVendors({ q: search || undefined, trade: trade || undefined }) })
  const create = useMutation({
    mutationFn: () => engineeringApi.createVendor({ name: form.name.trim(), trades: [form.trade], contact_name: form.contact_name || undefined, phone: form.phone || undefined, email: form.email || undefined, emergency_phone: form.emergency_phone || undefined, insurance_expires_at: form.insurance_expires_at || undefined, offers_24h_service: form.offers_24h_service, notes: form.notes || undefined }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['engineering-vendors'] }); setDrawerOpen(false); setForm({ name: '', trade: 'hvac', contact_name: '', phone: '', email: '', emergency_phone: '', insurance_expires_at: '', offers_24h_service: false, notes: '' }) },
  })
  const list = vendors.data?.data ?? []
  const today = new Date().toISOString().slice(0, 10)
  const closeLabel = t('common.close')

  return <div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div><p className="text-xs font-semibold tracking-[0.08em] text-ink3">{t('engineering.workOrdersPage.heading')}</p><h1 className="mt-1 font-display text-3xl text-ink">{t('vendors.title')}</h1><p className="mt-1 max-w-xl text-sm text-ink2">{t('vendors.subtitle')}</p></div>
      <Button variant="primary" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" />{t('vendors.add')}</Button>
    </header>
    <div className="flex flex-col gap-3 sm:flex-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('vendors.search')} aria-label={t('vendors.search')} className="min-h-11 flex-1 rounded-[var(--r-sm)] border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50" /><select value={trade} onChange={(event) => setTrade(event.target.value as VendorTrade | '')} aria-label={t('vendors.trades')} className="min-h-11 rounded-[var(--r-sm)] border border-line bg-surface px-3 text-base text-ink"><option value="">{t('vendors.allTrades')}</option>{TRADES.map((item) => <option key={item} value={item}>{formatTrade(item)}</option>)}</select></div>
    {vendors.isLoading ? <div className="grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-[var(--r-md)] bg-surface-2" />)}</div> : vendors.isError ? <StateBlock status="error" error={{ message: t('vendors.noVendors'), onRetry: () => vendors.refetch() }} /> : list.length === 0 ? <StateBlock status="empty" empty={{ title: t('vendors.noVendors'), body: t('vendors.noVendorsHelp') }} /> : <div className="grid gap-3 md:grid-cols-2">{list.map((vendor) => {
      const insuranceExpired = Boolean(vendor.insurance_expires_at && vendor.insurance_expires_at < today)
      return <article key={vendor.id} className="rounded-[var(--r-md)] border border-line bg-surface p-4 transition-colors hover:bg-surface-2"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-ink3" /><h2 className="font-semibold text-ink">{vendor.name}</h2></div><p className="mt-1 text-sm text-ink2">{vendor.trades.map(formatTrade).join(', ')}</p></div>{vendor.offers_24h_service && <span className="rounded bg-[var(--alert-soft)] px-2 py-1 text-xs font-medium text-[var(--alert)]">24/7</span>}</div><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink2">{vendor.phone && <a className="inline-flex min-h-11 items-center gap-1 hover:text-ink" href={`tel:${vendor.phone}`}><Phone className="h-3.5 w-3.5" />{vendor.phone}</a>}<span>{t('vendors.activeJobs', { count: vendor.performance?.jobs ?? 0 })}</span><span>{t('vendors.spend', { value: `$${(vendor.performance?.spend ?? 0).toLocaleString()}` })}</span></div>{vendor.insurance_expires_at && <p className={`mt-3 flex items-center gap-1.5 text-xs ${insuranceExpired ? 'text-[var(--alert)]' : 'text-[var(--ready)]'}`}><ShieldCheck className="h-3.5 w-3.5" />{insuranceExpired ? t('vendors.insuranceExpired') : t('vendors.insuranceValid', { date: new Date(`${vendor.insurance_expires_at}T00:00:00`).toLocaleDateString() })}</p>}</article>
    })}</div>}
    <EngineeringDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('vendors.add')} closeLabel={closeLabel} footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => create.mutate()} disabled={!form.name.trim() || create.isPending}>{t('vendors.save')}</Button></div>}><div className="space-y-4"><label className="block text-sm font-medium text-ink">{t('vendors.company')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3" /></label><label className="block text-sm font-medium text-ink">{t('vendors.trades')}<select value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value as VendorTrade })} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3">{TRADES.map((item) => <option key={item} value={item}>{formatTrade(item)}</option>)}</select></label>{(['contact_name', 'phone', 'email', 'emergency_phone'] as const).map((field) => <label key={field} className="block text-sm font-medium text-ink">{t(`vendors.${field === 'contact_name' ? 'contact' : field === 'emergency_phone' ? 'emergencyPhone' : field}`)}<input type={field === 'email' ? 'email' : 'text'} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3" /></label>)}<label className="block text-sm font-medium text-ink">{t('vendors.insurance')}<input type="date" value={form.insurance_expires_at} onChange={(event) => setForm({ ...form, insurance_expires_at: event.target.value })} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3" /></label><label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.offers_24h_service} onChange={(event) => setForm({ ...form, offers_24h_service: event.target.checked })} />{t('vendors.aroundClock')}</label></div></EngineeringDrawer>
  </div>
}
