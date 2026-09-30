'use client'

import { FileText, ImageIcon, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { evidenceApi } from '@/lib/api/evidence'
import { logbookApi } from '@/lib/api/logbook'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

interface LogbookAttachmentsProps {
  entryId: string
  canRemove: boolean
}

export function LogbookAttachments({ entryId, canRemove }: LogbookAttachmentsProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const client = useQueryClient()
  const attachments = useQuery({
    queryKey: ['logbook-attachments', entryId],
    queryFn: async () => (await logbookApi.listAttachments(entryId)).data,
  })
  const remove = useMutation({
    mutationFn: (attachmentId: string) => logbookApi.removeAttachment(entryId, attachmentId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['logbook-attachments', entryId] }),
    onError: () => toast.error(t('logbook.attachmentRemoveFailed')),
  })

  if (attachments.isLoading) return <div className="h-14 animate-pulse rounded-[var(--r-md)] bg-surface-2" aria-label={t('logbook.attachmentsLoading')} />
  if (attachments.isError || !attachments.data?.length) return null

  async function openAttachment(recordId: string) {
    try {
      const { data } = await evidenceApi.getRecordFileUrl(recordId)
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error(t('logbook.attachmentOpenFailed'))
    }
  }

  return (
    <section aria-labelledby="logbook-attachments-heading">
      <div className="mb-2 flex items-center justify-between">
        <p id="logbook-attachments-heading" className="text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.attachments')}</p>
        <span className="text-xs text-ink3">{attachments.data.length}</span>
      </div>
      <ul className="space-y-2">
        {attachments.data.map((attachment) => {
          const isImage = attachment.file_content_type?.startsWith('image/')
          return <li key={attachment.id} className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-2.5">
            {isImage ? <ImageIcon size={18} className="text-accent" aria-hidden="true" /> : <FileText size={18} className="text-ink3" aria-hidden="true" />}
            <button type="button" onClick={() => openAttachment(attachment.id)} className="min-w-0 flex-1 text-left text-sm text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              <span className="block truncate font-medium">{attachment.file_name || attachment.label}</span>
              <span className="block text-xs text-ink3">{attachment.collector_name || t('logbook.teamMember')}</span>
            </button>
            {canRemove && <Button type="button" variant="ghost" size="sm" aria-label={t('logbook.removeAttachment', { name: attachment.file_name || attachment.label })} loading={remove.isPending && remove.variables === attachment.id} onClick={() => { if (window.confirm(t('logbook.removeAttachmentConfirm', { name: attachment.file_name || attachment.label }))) remove.mutate(attachment.id) }}><Trash2 size={15} /></Button>}
          </li>
        })}
      </ul>
    </section>
  )
}
