'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { engineeringApi } from '@/lib/api/engineering'
import { EngineeringDrawer } from '@/components/engineering/EngineeringDrawer'
import { Button } from '@/components/ui/Button'

export function VendorEngagementDrawer({ open, workOrderId, onClose }: { open: boolean; workOrderId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [vendorId, setVendorId] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [emergency, setEmergency] = useState(false)
  const [eta, setEta] = useState('')
  const [notes, setNotes] = useState('')
  const vendors = useQuery({ queryKey: ['engineering-vendors'], queryFn: () => engineeringApi.listVendors(), enabled: open })
  const contact = useMutation({ mutationFn: () => engineeringApi.contactVendor(workOrderId, { vendor_id: vendorId, service_type: emergency ? 'emergency' : 'standard', expected_arrival_at: eta ? new Date(eta).toISOString() : undefined, notes: notes || undefined, mark_work_order_waiting: waiting }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['work-order-detail', workOrderId] }); queryClient.invalidateQueries({ queryKey: ['work-orders'] }); queryClient.invalidateQueries({ queryKey: ['engineering-vendors'] }); onClose() } })
  return <EngineeringDrawer open={open} title={t('vendors.contactVendor')} onClose={onClose} closeLabel={t('common.close')} footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!vendorId || contact.isPending} onClick={() => contact.mutate()}>{t('vendors.recordRequest')}</Button></div>}><div className="space-y-4"><label className="block text-sm font-medium text-ink">{t('vendors.title')}<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3"><option value="" />{(vendors.data?.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="block text-sm font-medium text-ink">{t('vendors.expectedArrival')}<input type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-line bg-surface px-3" /></label><label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />{t('vendors.aroundClock')}</label><label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" checked={waiting} onChange={(event) => setWaiting(event.target.checked)} />{t('vendors.setWaiting')}</label><label className="block text-sm font-medium text-ink">{t('common.notes')}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2" /></label>{contact.isError && <p className="text-sm text-[var(--alert)]">{t('common.saveError')}</p>}</div></EngineeringDrawer>
}
